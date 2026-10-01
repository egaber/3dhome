/** Shared persistence/command boundary. Never invoke accessors or copy unknown keys. */
import { FURNITURE_KINDS, type FurnitureEdit, type FurnitureSpec, type OpeningSpec, type RoomEdit, type Vec2, type WallEdit } from './types';

export type OpeningPatch = Partial<Pick<OpeningSpec, 'label' | 'kind' | 'position' | 'width' | 'height' | 'sill' | 'open' | 'shutter' | 'overhang'>>;
export const OPENING_PATCH_KEYS = ['label', 'kind', 'position', 'width', 'height', 'sill', 'open', 'shutter', 'overhang'] as const;
export function openingPatch(value: unknown, path: string): OpeningPatch {
  const input = record(value, path, OPENING_PATCH_KEYS);
  const output: OpeningPatch = {};
  if (hasOwn(input, 'label')) output.label = text(input.label, `${path}.label`);
  if (hasOwn(input, 'kind')) output.kind = choice(input.kind, `${path}.kind`, ['window', 'glazing', 'door', 'void'] as const);
  for (const [key, maximum] of [['position', 1], ['width', 45], ['height', 6], ['sill', 6], ['overhang', 3]] as const) {
    if (hasOwn(input, key)) output[key] = number(input[key], `${path}.${key}`, 0, maximum);
  }
  if (hasOwn(input, 'open')) output.open = boolean(input.open, `${path}.open`);
  if (hasOwn(input, 'shutter')) output.shutter = boolean(input.shutter, `${path}.shutter`);
  return output;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function invalid(path: string, instruction: string): never {
  throw new Error(`פרויקט לא תקין (${path}): ${instruction}`);
}
export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
export function childPath(path: string, key: string): string {
  return `${path}.${key.length > 150 ? `${key.slice(0, 150)}…` : key}`;
}
function dataKeys(value: object, path: string): string[] {
  return Reflect.ownKeys(value).map(key => {
    if (typeof key !== 'string') invalid(path, 'מותרות רק מחרוזות כשמות שדות; יש להסיר את השדה הלא תקין.');
    if (FORBIDDEN_KEYS.has(key)) invalid(childPath(path, key), 'שם שדה אסור; יש להסיר אותו מהפרויקט.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!hasOwn(descriptor, 'value')) invalid(childPath(path, key), 'יש לספק ערך JSON רגיל, ללא פונקציית קריאה או כתיבה.');
    return key;
  });
}
export function record(value: unknown, path: string, allowed?: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'יש לספק אובייקט JSON, לא מערך, ערך ריק או ערך בודד.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, 'יש לספק אובייקט נתונים רגיל ללא אב־טיפוס מותאם.');
  for (const key of dataKeys(value, path)) {
    if (allowed && !allowed.includes(key)) invalid(childPath(path, key), 'השדה אינו מוכר בגרסה 1; יש להסיר אותו ולייבא שוב.');
  }
  return value as Record<string, unknown>;
}
export function list(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid(path, 'יש לספק מערך JSON רגיל.');
  if (value.length > maximum) invalid(path, `מותרות לכל היותר ${maximum} רשומות; יש להסיר רשומות עודפות.`);
  const allowed = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
  for (const key of dataKeys(value, path)) if (!allowed.has(key)) invalid(childPath(path, key), 'אין להוסיף שדות למערך; יש להשאיר רק רשומות.');
  for (let index = 0; index < value.length; index++) if (!hasOwn(value, index)) invalid(`${path}[${index}]`, 'חסרה רשומה במערך; יש להשלים או להסיר אותה.');
  return value;
}
export function fields<T extends object>(value: unknown, defaults: T, path: string) {
  const input = record(value, path, Object.keys(defaults));
  return (key: keyof T): unknown => hasOwn(input, key) ? input[String(key)] : defaults[key];
}
export function number(value: unknown, path: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    invalid(path, `יש להזין מספר ${integer ? 'שלם ' : ''}סופי בין ${minimum} ל־${maximum}.`);
  }
  return value;
}
export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'יש להזין true או false, ללא מירכאות.');
  return value;
}
export function choice<T extends string | number>(value: unknown, path: string, allowed: readonly T[]): T {
  for (const option of allowed) if (value === option) return option;
  return invalid(path, `יש לבחור אחד מהערכים: ${allowed.join(', ')}.`);
}
export function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 200) invalid(path, 'יש להזין טקסט באורך של עד 200 תווים.');
  return value;
}
export function point(value: unknown, path: string, bound = 100): Vec2 {
  const values = list(value, path, 2);
  if (values.length !== 2) invalid(path, 'נדרשות בדיוק שתי קואורדינטות X ו־Z.');
  return [number(values[0], `${path}[0]`, -bound, bound), number(values[1], `${path}[1]`, -bound, bound)];
}
export function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 150 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || FORBIDDEN_KEYS.has(value)) {
    invalid(path, 'יש להזין מזהה בטוח באורך 1–150 תווים: אותיות לטיניות, ספרות, מקף או קו תחתון, עם אות או ספרה בתחילתו.');
  }
  return value;
}
export function editRecords<T>(value: unknown, path: string, knownIds: Set<string>, parse: (item: unknown, itemPath: string) => T): Record<string, T> {
  const input = record(value, path);
  const output: Record<string, T> = {};
  const keys = Object.getOwnPropertyNames(input);
  if (keys.length > 500) invalid(path, 'מותרות עד 500 עריכות תכנון.');
  for (const key of keys) {
    const id = identifier(key, childPath(path, key));
    if (!knownIds.has(id)) invalid(childPath(path, key), 'יש לבחור מזהה שקיים בתוכנית המקור.');
    output[id] = parse(input[id], childPath(path, id));
  }
  return output;
}
export function wallEdit(value: unknown, path: string): WallEdit {
  const input = record(value, path, ['a', 'b', 'deleted']);
  const a = point(input.a, `${path}.a`), b = point(input.b, `${path}.b`);
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < .05) invalid(path, 'יש להגדיר אורך קיר של לפחות 5 ס״מ.');
  return { a, b, deleted: boolean(input.deleted, `${path}.deleted`) };
}
export function roomEdit(value: unknown, path: string): RoomEdit {
  const input = record(value, path, ['center', 'width', 'depth', 'rotation', 'deleted']);
  return { center: point(input.center, `${path}.center`), width: number(input.width, `${path}.width`, .4, 30),
    depth: number(input.depth, `${path}.depth`, .4, 30), deleted: boolean(input.deleted, `${path}.deleted`),
    ...(hasOwn(input, 'rotation') ? { rotation: number(input.rotation, `${path}.rotation`, -180, 180) } : {}) };
}
export function furnitureSpec(value: unknown, path: string): FurnitureSpec {
  const input = record(value, path, ['id', 'unit', 'floor', 'kind', 'center', 'rotation', 'width', 'depth', 'height', 'source']);
  return { id: identifier(input.id, `${path}.id`), unit: choice(input.unit, `${path}.unit`, ['north', 'south']),
    floor: choice(input.floor, `${path}.floor`, ['basement', 'ground', 'first']),
    kind: choice(input.kind, `${path}.kind`, FURNITURE_KINDS), center: point(input.center, `${path}.center`),
    rotation: number(input.rotation, `${path}.rotation`, -180, 180), width: number(input.width, `${path}.width`, .2, 10),
    depth: number(input.depth, `${path}.depth`, .2, 10), height: number(input.height, `${path}.height`, .1, 3),
    source: choice(input.source, `${path}.source`, ['added']) };
}
export function furnitureEdit(value: unknown, path: string, centerBound: 100 | 150 = 150): FurnitureEdit {
  const input = record(value, path, ['center', 'rotation', 'deleted', 'width', 'depth', 'height']);
  // Legal room centres reach ±100 and rotated kitchen seeds can extend another
  // 15m. Overrides must accommodate every seed, including no-op and deletion.
  // New furniture, rooms, walls and stair positions retain their ±100 boundary.
  const output: FurnitureEdit = { center: point(input.center, `${path}.center`, centerBound), rotation: number(input.rotation, `${path}.rotation`, -180, 180), deleted: boolean(input.deleted, `${path}.deleted`) };
  for (const key of ['width', 'depth', 'height'] as const) if (hasOwn(input, key)) {
    output[key] = number(input[key], `${path}.${key}`, key === 'height' ? .1 : .2, key === 'height' ? 3 : 10);
  }
  return output;
}