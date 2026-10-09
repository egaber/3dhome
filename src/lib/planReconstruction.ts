import { BASE_DEPTH, BASE_WIDTH, defaultState } from '../model/plans';
import { serializeProject } from './project';
import type { SimulationState, UnitId, Vec2 } from '../model/types';

export interface PlanSegment { a: Vec2; b: Vec2 }
export interface PlanSource { name: string; width: number; height: number; image: string | null; segments: PlanSegment[]; warnings: string[] }
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const transform = (point: Vec2, m: Matrix): Vec2 => [m[0] * point[0] + m[2] * point[1] + m[4], m[1] * point[0] + m[3] * point[1] + m[5]];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

/** Reads straight painted PDF paths only. Unsupported image/form/object streams fail explicitly. */
export function vectorPaths(content: string): PlanSegment[] {
  if (/\b(?:Do|BI)\b/.test(content)) throw new Error('עמוד PDF זה כולל תמונות או טפסים מקוננים שאינם נתמכים. יצאו את העמוד ל־JPEG או PNG וייבאו כתמונה.');
  const cleaned = content.replace(/BT[\s\S]*?ET/g, '').replace(/%[^\r\n]*/g, '');
  const tokens = cleaned.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z*]+/g) ?? [];
  if (tokens.length > 500_000) throw new Error('עמוד PDF מורכב מדי. ייבאו עמוד או אזור קטן יותר.');
  let matrix: Matrix = [...IDENTITY], stack: Matrix[] = [], values: number[] = [], paths: PlanSegment[] = [];
  let point: Vec2 | null = null, start: Vec2 | null = null;
  const result: PlanSegment[] = [];
  const line = (end: Vec2) => { if (point) paths.push({ a: point, b: end }); point = end; };
  for (const token of tokens) {
    const numeric = Number(token);
    if (Number.isFinite(numeric)) { values.push(numeric); if (values.length > 64) values.shift(); continue; }
    const take = (count: number) => {
      if (values.length < count) throw new Error('פקודת נתיב PDF אינה תקינה.');
      return values.slice(-count);
    };
    if (token === 'q') { if (stack.length > 64) throw new Error('PDF nesting limit exceeded'); stack.push([...matrix]); }
    else if (token === 'Q') { const saved = stack.pop(); if (!saved) throw new Error('PDF transform stack is invalid'); matrix = saved; }
    else if (token === 'cm') { const v = take(6); matrix = multiply(matrix, [v[0], v[1], v[2], v[3], v[4], v[5]]); }
    else if (token === 'm') { const v = take(2); point = transform([v[0], v[1]], matrix); start = point; }
    else if (token === 'l') { const v = take(2); line(transform([v[0], v[1]], matrix)); }
    else if (token === 're') {
      const [x, y, w, h] = take(4);
      const corners: Vec2[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      point = transform(corners[0], matrix); start = point;
      [...corners.slice(1), corners[0]].forEach(p => line(transform(p, matrix)));
    } else if (token === 'h') { if (start) line(start); }
    else if (['c', 'v', 'y'].includes(token)) { point = null; start = null; }
    else if (['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(token)) {
      if (['s', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(token) && start) line(start);
      result.push(...paths); paths = []; point = start = null;
      if (result.length > 12_000) throw new Error('יותר מדי נתיבים בעמוד. חתכו את תוכנית הקומה בלבד.');
    } else if (token === 'n') { paths = []; point = start = null; }
    values = [];
  }
  return result.filter(segment => [...segment.a, ...segment.b].every(Number.isFinite)
    && Math.hypot(segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]) > .01);
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader(), decoder = new TextDecoder(), chunks: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.length;
      if (size > 8_000_000) { await reader.cancel(); throw new Error('תוכן PDF פרוס גדול מדי.'); }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    return chunks.join('') + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function extractVectorPdf(bytes: Uint8Array, pageNumber = 1): Promise<PlanSource & { pageCount: number }> {
  if (bytes.length > 12_000_000) throw new Error('מותר PDF עד 12 MB.');
  const source = new TextDecoder('latin1').decode(bytes);
  if (!source.startsWith('%PDF-')) throw new Error('חתימת PDF לא תקינה.');
  if (/\/Encrypt\b|\/ObjStm\b/.test(source)) throw new Error('PDF מוצפן או עם אובייקטים דחוסים אינו נתמך. יצאו עמוד לתמונה או ל־PDF וקטורי פשוט.');
  const objects = new Map<string, { content: string; offset: number }>();
  const pattern = /(?:^|[\r\n])(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g;
  for (const match of source.matchAll(pattern)) {
    if (objects.size > 20_000) throw new Error('יותר מדי אובייקטים ב־PDF.');
    objects.set(match[1], { content: match[2], offset: match.index! + match[0].indexOf(match[2]) });
  }
  const pages: { content: string; media: string }[] = [], visited = new Set<string>();
  const catalog = [...objects.values()].find(object => /\/Type\s*\/Catalog\b/.test(object.content));
  const root = catalog?.content.match(/\/Pages\s+(\d+)\s+\d+\s+R/)?.[1];
  const visit = (id: string, inherited: string, depth: number) => {
    if (depth > 32 || visited.has(id)) throw new Error('עץ עמודי PDF אינו תקין.');
    visited.add(id);
    const object = objects.get(id); if (!object) throw new Error('אובייקט עמוד PDF חסר.');
    const media = object.content.match(/\/(?:CropBox|MediaBox)\s*(\[[^\]]+\])/)?.[1] ?? inherited;
    const rotation = Number(object.content.match(/\/Rotate\s+(-?\d+)/)?.[1] ?? 0);
    if (rotation % 360 !== 0) throw new Error('נא לסובב את עמוד ה־PDF למצב ישר לפני ייבוא.');
    if (/\/Type\s*\/Page\b/.test(object.content)) { pages.push({ content: object.content, media }); return; }
    const kids = object.content.match(/\/Kids\s*\[([^\]]+)\]/)?.[1];
    if (!kids) throw new Error('רשימת עמודי PDF חסרה.');
    for (const ref of kids.matchAll(/(\d+)\s+\d+\s+R/g)) visit(ref[1], media, depth + 1);
  };
  if (!root) throw new Error('מבנה PDF זה אינו נתמך. יצאו את התוכנית לתמונה.');
  visit(root, '', 0);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length) throw new Error(`בחרו עמוד בין 1 ל־${pages.length}.`);
  const page = pages[pageNumber - 1];
  const box = page.media.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g)?.map(Number);
  if (!box || box.length !== 4 || box.some(value => !Number.isFinite(value)) || box[2] <= box[0] || box[3] <= box[1]) throw new Error('מידות העמוד חסרות או לא תקינות.');
  const references = page.content.match(/\/Contents\s*(\[[^\]]+\]|\d+\s+\d+\s+R)/)?.[1];
  if (!references) throw new Error('לא נמצאו נתיבים בעמוד.');
  const contents: string[] = [];
  for (const ref of references.matchAll(/(\d+)\s+\d+\s+R/g)) {
    if (contents.length >= 64) throw new Error('יותר מדי מקטעי PDF בעמוד.');
    const object = objects.get(ref[1]); if (!object) throw new Error('מקטע PDF חסר.');
    const start = object.content.match(/\bstream\r?\n/);
    if (!start || start.index === undefined) throw new Error('מקטע PDF אינו תקין.');
    const dict = object.content.slice(0, start.index), from = start.index + start[0].length;
    const length = dict.match(/\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/);
    const declared = length?.[2] ? Number(objects.get(length[1])?.content.trim()) : length ? Number(length[1]) : null;
    if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0)) throw new Error('אורך מקטע PDF חסר או אינו תקין.');
    const end = declared === null ? object.content.lastIndexOf('endstream') : from + declared;
    if (end < from || end > object.content.length) throw new Error('אורך מקטע PDF אינו תקין.');
    const payload = bytes.slice(object.offset + from, object.offset + end);
    if (/\/Filter\b/.test(dict) && !/\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/.test(dict)) throw new Error('דחיסת PDF אינה נתמכת. השתמשו ב־FlateDecode או בתמונה.');
    contents.push(/\/Filter\b/.test(dict) ? await inflate(payload) : new TextDecoder().decode(payload));
    if (contents.reduce((total, content) => total + content.length, 0) > 8_000_000) throw new Error('תוכן העמוד הפרוס גדול מדי.');
  }
  const segments = vectorPaths(contents.join('\n')).map(({ a, b }) => ({ a: [a[0] - box[0], box[3] - a[1]] as Vec2, b: [b[0] - box[0], box[3] - b[1]] as Vec2 }));
  if (!segments.length) throw new Error('לא נמצאו קווים וקטוריים ישרים. לתוכנית סרוקה השתמשו ב־JPEG או PNG.');
  return { name: `PDF · עמוד ${pageNumber}`, width: box[2] - box[0], height: box[3] - box[1], image: null, segments, pageCount: pages.length,
    warnings: ['אלה קווי ציור מקוריים, לא קירות מזוהים. טקסט וקשתות אינם מיובאים. סננו, כיילו ובדקו כל קיר לפני יצירה.'] };
}

export function detectImageLines(data: Uint8ClampedArray, width: number, height: number, minimumLength: number): PlanSegment[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 4_000_000 || data.length !== width * height * 4) throw new Error('מידות תמונה אינן תקינות.');
  if (!Number.isFinite(minimumLength) || minimumLength < 5) throw new Error('אורך קו מינימלי אינו תקין.');
  const dark = (x: number, y: number) => { const i = (y * width + x) * 4; return data[i + 3] > 128 && data[i] * .21 + data[i + 1] * .72 + data[i + 2] * .07 < 95; };
  const candidates: PlanSegment[] = [];
  for (const vertical of [false, true]) {
    const outer = vertical ? width : height, inner = vertical ? height : width;
    for (let cross = 0; cross < outer; cross += 2) {
      let start = -1;
      for (let along = 0; along <= inner; along++) {
        const hit = along < inner && dark(vertical ? cross : along, vertical ? along : cross);
        if (hit && start < 0) start = along;
        if (!hit && start >= 0) {
          if (along - start >= minimumLength) {
            const candidate = { a: (vertical ? [cross, start] : [start, cross]) as Vec2, b: (vertical ? [cross, along - 1] : [along - 1, cross]) as Vec2 };
            if (!candidates.some(line => Math.hypot(line.a[0] - candidate.a[0], line.a[1] - candidate.a[1]) < 8 && Math.hypot(line.b[0] - candidate.b[0], line.b[1] - candidate.b[1]) < 8)) candidates.push(candidate);
            if (candidates.length > 4000) throw new Error('התמונה עמוסה מדי לזיהוי. חתכו את התוכנית בלבד או שרטטו ידנית.');
          }
          start = -1;
        }
      }
    }
  }
  return candidates;
}

export function calibratedScale(a: Vec2, b: Vec2, metres: number): number {
  const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (![...a, ...b, metres, distance].every(Number.isFinite) || distance < 5 || metres <= 0 || metres > 100) throw new Error('בחרו שתי נקודות מרוחקות לפחות 5 פיקסלים והזינו מידה ידועה בין 0 ל־100 מטרים.');
  return metres / distance;
}

export function reconstructPlan(source: PlanSource, segments: PlanSegment[], scale: number, thickness: number, unit: UnitId = 'north'): SimulationState {
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(thickness) || thickness < .05 || thickness > 1) throw new Error('קנה המידה או עובי הקיר אינם תקינים.');
  if (!segments.length || segments.length > 200) throw new Error('בחרו בין 1 ל־200 קירות לאישור.');
  if (segments.some(line => [...line.a, ...line.b].some(n => !Number.isFinite(n)) || Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]) * scale < .05)) throw new Error('קיר קצר מדי או קואורדינטה לא תקינה.');
  const points = segments.flatMap(segment => [segment.a, segment.b]), xs = points.map(p => p[0] * scale), ys = points.map(p => p[1] * scale);
  if (Math.max(...xs) - Math.min(...xs) > 80 || Math.max(...ys) - Math.min(...ys) > 80) throw new Error('התוכנית גדולה מ־80 מטרים. בדקו את הכיול.');
  const state = defaultState(), other = unit === 'north' ? 'south' : 'north';
  state.buildings[other].enabled = false;
  state.buildings[unit] = { ...state.buildings[unit], storeys: 1, roofEnabled: false, stairEnabled: false, width: BASE_WIDTH, depth: BASE_DEPTH[unit] };
  state.neighbors = state.neighbors.map(neighbor => ({ ...neighbor, enabled: false }));
  state.northBearing = 0;
  const x0 = Math.min(...xs) - thickness / 2, x1 = Math.max(...xs) + thickness / 2;
  const z0 = Math.min(...ys) - thickness / 2, z1 = Math.max(...ys) + thickness / 2;
  state.design.addedWalls = segments.map((segment, index) => ({
    id: `import-wall-${index + 1}`, sourceId: 'custom', unit, floor: 'ground', a: [segment.a[0] * scale, segment.a[1] * scale],
    b: [segment.b[0] * scale, segment.b[1] * scale], thickness, exterior: false, retaining: false, openings: [],
  }));
  state.design.importedPlan = { unit, sourceName: source.name.slice(0, 200), outline: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
    image: source.image, imageWidth: source.width * scale, imageDepth: source.height * scale };
  state.view = { ...state.view, renderMode: 'realistic', mode: 'orbit', planVisible: false, path: false, dimensions: false };
  serializeProject(state);
  return state;
}
