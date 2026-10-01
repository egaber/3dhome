import { BASE_FURNITURE, EDITABLE_OPENINGS, EDITABLE_WALLS, ROOMS, defaultState } from '../model/plans';
import type { BuildingSettings, NeighborSettings, OpeningSpec, SimulationState } from '../model/types';
import { invalid, hasOwn, childPath, record, list, fields, number, boolean, choice, text, point, identifier, editRecords, wallEdit, roomEdit, furnitureEdit, furnitureSpec, openingPatch, OPENING_PATCH_KEYS } from '../model/cadValidation';
import { resolveLocalDateTime } from './solar';
import { parseAppearance, surfaceTarget } from '../model/appearance';
import { CATALOG_IDS } from '../model/modelCatalog';

export const PROJECT_STORAGE_KEY = 'dori-solar-studio-v1';

const MAX_IMAGE_LENGTH = 6_000_000;
// Bound allocation before JSON.parse, while leaving room for a full image and edits.
const MAX_JSON_LENGTH = 8_000_000;
const MAX_ADDED_OPENINGS = 200;
const OPENING_KEYS = [
  'id', 'wallId', 'label', 'unit', 'floor', 'kind', 'position', 'width',
  'height', 'sill', 'open', 'shutter', 'overhang', 'source',
] as const satisfies readonly (keyof OpeningSpec)[];
const WALL_BY_ID = new Map(EDITABLE_WALLS.map(wall => [wall.id, wall] as const));
const BASE_BY_ID = new Map(EDITABLE_OPENINGS.map(opening => [opening.id, opening] as const));

function fixed<T extends string>(value: unknown, path: string, expected: T): T {
  if (value !== expected) invalid(path, `אין לשנות את שיוך הפתח או את מקורו; יש להשתמש בערך ${expected}.`);
  return expected;
}

function building(value: unknown, defaults: BuildingSettings, path: string): BuildingSettings {
  const input = record(value, path, [...Object.keys(defaults), 'stairRotation', 'stairPosition', 'stairScale', 'stairEnabled']);
  const get = (key: keyof BuildingSettings): unknown => hasOwn(input, key) ? input[key] : defaults[key];
  return {
    enabled: boolean(get('enabled'), `${path}.enabled`),
    width: number(get('width'), `${path}.width`, 5, 18),
    depth: number(get('depth'), `${path}.depth`, 3, 20),
    x: number(get('x'), `${path}.x`, -60, 60),
    z: number(get('z'), `${path}.z`, -60, 60),
    rotation: number(get('rotation'), `${path}.rotation`, -180, 180),
    groundHeight: number(get('groundHeight'), `${path}.groundHeight`, 2.3, 6),
    upperHeight: number(get('upperHeight'), `${path}.upperHeight`, 2.3, 6),
    basementDepth: number(get('basementDepth'), `${path}.basementDepth`, 1, 6),
    parapet: number(get('parapet'), `${path}.parapet`, 0, 3),
    roofEnabled: boolean(get('roofEnabled'), `${path}.roofEnabled`),
    roofFloorHeight: number(get('roofFloorHeight'), `${path}.roofFloorHeight`, 2.2, 4.5),
    roofPeakHeight: number(get('roofPeakHeight'), `${path}.roofPeakHeight`, 7, 15),
    firstFloorVariant: choice(get('firstFloorVariant'), `${path}.firstFloorVariant`, ['original', 'open-plan'] as const),
    storeys: choice(get('storeys'), `${path}.storeys`, [1, 2] as const),
    stairLayout: choice(get('stairLayout'), `${path}.stairLayout`, ['straight', 'u-shaped'] as const),
    ...(hasOwn(input, 'stairRotation') ? { stairRotation: number(input.stairRotation, `${path}.stairRotation`, -180, 180) } : {}),
    ...(hasOwn(input, 'stairPosition') ? { stairPosition: point(input.stairPosition, `${path}.stairPosition`) } : {}),
    ...(hasOwn(input, 'stairScale') ? { stairScale: number(input.stairScale, `${path}.stairScale`, .5, 2) } : {}),
    ...(hasOwn(input, 'stairEnabled') ? { stairEnabled: boolean(input.stairEnabled, `${path}.stairEnabled`) } : {}),
  };
}

function neighbors(value: unknown, defaults: NeighborSettings[]): NeighborSettings[] {
  const input = list(value, 'neighbors', 2);
  if (input.length !== 2) invalid('neighbors', 'נדרשים בדיוק שני שכנים, עם המזהים west ו־east, כל אחד פעם אחת.');
  const seen = new Set<NeighborSettings['id']>();
  return input.map((item, index) => {
    const path = `neighbors[${index}]`;
    const data = record(item, path, Object.keys(defaults[0]));
    const id = choice(data.id, `${path}.id`, ['west', 'east'] as const);
    if (seen.has(id)) invalid(`${path}.id`, 'מזהה שכן כפול; יש לכלול west ו־east פעם אחת בלבד.');
    seen.add(id);
    const get = fields(data, defaults.find(neighbor => neighbor.id === id)!, path);
    const height = number(get('height'), `${path}.height`, 1, 30);
    return {
      id,
      name: text(get('name'), `${path}.name`),
      enabled: boolean(get('enabled'), `${path}.enabled`),
      x: number(get('x'), `${path}.x`, -80, 80),
      z: number(get('z'), `${path}.z`, -80, 80),
      width: number(get('width'), `${path}.width`, 1, 45),
      depth: number(get('depth'), `${path}.depth`, 1, 45),
      height,
      // Inspector permits height - 0.1; the scene clamps its eave to 0.5 m.
      // Preserve that valid requested value instead of silently changing the import.
      roofRise: number(get('roofRise'), `${path}.roofRise`, 0, Math.min(10, height - 0.1)),
      rotation: number(get('rotation'), `${path}.rotation`, -180, 180),
    };
  });
}

function addedOpening(value: unknown, path: string): OpeningSpec {
  const input = record(value, path, OPENING_KEYS);
  for (const key of OPENING_KEYS) {
    if (!hasOwn(input, key)) invalid(`${path}.${key}`, 'השדה נדרש בפתח חדש; יש להשלים אותו או להסיר את הפתח.');
  }
  const id = identifier(input.id, `${path}.id`);
  const wallId = identifier(input.wallId, `${path}.wallId`);
  const wall = WALL_BY_ID.get(wallId);
  if (!wall) invalid(`${path}.wallId`, 'הקיר אינו קיים בתוכנית; יש לבחור מזהה קיר קיים של היחידה והקומה.');
  return {
    id, wallId,
    label: text(input.label, `${path}.label`),
    unit: fixed(input.unit, `${path}.unit`, wall.unit),
    floor: fixed(input.floor, `${path}.floor`, wall.floor),
    kind: choice(input.kind, `${path}.kind`, ['window', 'glazing', 'door', 'void'] as const),
    position: number(input.position, `${path}.position`, 0, 1),
    width: number(input.width, `${path}.width`, 0, 45),
    height: number(input.height, `${path}.height`, 0, 6),
    sill: number(input.sill, `${path}.sill`, 0, 6),
    open: boolean(input.open, `${path}.open`),
    shutter: boolean(input.shutter, `${path}.shutter`),
    overhang: number(input.overhang, `${path}.overhang`, 0, 3),
    source: fixed(input.source, `${path}.source`, 'added'),
  };
}

function openingOverride(value: unknown, base: OpeningSpec, path: string): Partial<OpeningSpec> {
  const input = record(value, path, OPENING_KEYS);
  const output: Partial<OpeningSpec> = {};
  if (hasOwn(input, 'id')) output.id = fixed(input.id, `${path}.id`, base.id);
  if (hasOwn(input, 'wallId')) output.wallId = fixed(input.wallId, `${path}.wallId`, base.wallId);
  if (hasOwn(input, 'unit')) output.unit = fixed(input.unit, `${path}.unit`, base.unit);
  if (hasOwn(input, 'floor')) output.floor = fixed(input.floor, `${path}.floor`, base.floor);
  if (hasOwn(input, 'source')) output.source = fixed(input.source, `${path}.source`, base.source);
  const patch = Object.fromEntries(OPENING_PATCH_KEYS.filter(key => hasOwn(input, key)).map(key => [key, input[key]]));
  return { ...output, ...openingPatch(patch, path) };
}

function referenceImage(value: unknown): string | null {
  const path = 'reference.image';
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_IMAGE_LENGTH) {
    invalid(path, 'יש לבחור תמונת PNG, JPEG או WebP מקומית עד 6,000,000 תווים מקודדים, או null להסרתה.');
  }
  const header = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
  if (!header) invalid(path, 'מותרת רק תמונת PNG, JPEG או WebP מקומית בקידוד data:image/...;base64,. אין להשתמש ב־SVG או בכתובת רשת.');
  const encoded = value.slice(header[0].length);
  // A single character-class repetition stays linear even for multi-megabyte images.
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    invalid(path, 'קידוד base64 של התמונה אינו תקין; יש לבחור שוב את קובץ התמונה המקומי.');
  }
  // Inspect only the small raster signature; never decode the entire image here.
  // This also rejects SVG/HTML disguised under a raster MIME type.
  const prefix = atob(encoded.slice(0, 16));
  const matches = header[1] === 'png' ? prefix.startsWith('\x89PNG\r\n\x1a\n')
    : header[1] === 'jpeg' ? prefix.startsWith('\xff\xd8\xff')
      : prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP';
  if (!matches) invalid(path, 'תוכן התמונה אינו תואם לסוג PNG, JPEG או WebP שהוצהר; יש לבחור קובץ תמונה מקורי, לא SVG.');
  return value;
}

function validateProject(value: unknown): SimulationState {
  const defaults = defaultState();
  const input = record(value, 'project', [...Object.keys(defaults), 'appearance']);
  if (input.version !== 1) invalid('version', 'נדרש פרויקט בגרסה 1; יש לייצא מחדש קובץ תואם מהסימולטור.');
  const get = (key: keyof SimulationState): unknown => hasOwn(input, key) ? input[key] : defaults[key];
  const date = get('date');
  if (typeof date !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date)) {
    invalid('date', 'יש להזין תאריך תקין בפורמט YYYY-MM-DD, בשנים 0001–9999.');
  }
  const minutes = number(get('minutes'), 'minutes', 0, 1439, true);
  try {
    resolveLocalDateTime(date, minutes);
  } catch {
    invalid('date/minutes', 'התאריך או השעה אינם תקינים, או שהשעה אינה קיימת במעבר לשעון קיץ בירושלים. יש לתקן את התאריך או לבחור שעה אחרת.');
  }

  const location = fields(get('location'), defaults.location, 'location');
  const buildings = fields(get('buildings'), defaults.buildings, 'buildings');
  const view = fields(get('view'), defaults.view, 'view');
  const reference = fields(get('reference'), defaults.reference, 'reference');
  const vehicles = fields(get('vehicles'), defaults.vehicles, 'vehicles');
  const design = fields(get('design'), defaults.design, 'design');
  const knownFurniture = new Set(BASE_FURNITURE.map(item => item.id));
  const addedFurniture = list(design('addedFurniture'), 'design.addedFurniture', 200).map((item, index) => {
    const parsed = furnitureSpec(item, `design.addedFurniture[${index}]`);
    if (knownFurniture.has(parsed.id)) invalid(`design.addedFurniture[${index}].id`, 'יש לבחור מזהה ריהוט ייחודי; המזהה כבר קיים.');
    knownFurniture.add(parsed.id);
    return parsed;
  });
  const knownOpenings = new Map(BASE_BY_ID);
  const addedOpenings = list(get('addedOpenings'), 'addedOpenings', MAX_ADDED_OPENINGS).map((item, index) => {
    const opening = addedOpening(item, `addedOpenings[${index}]`);
    if (knownOpenings.has(opening.id)) invalid(`addedOpenings[${index}].id`, 'מזהה הפתח כבר קיים; יש לבחור מזהה ייחודי שאינו מזהה של פתח מקור.');
    knownOpenings.set(opening.id, opening);
    return opening;
  });
  const overrides = record(get('openings'), 'openings');
  const overrideIds = Object.getOwnPropertyNames(overrides);
  if (overrideIds.length > knownOpenings.size) invalid('openings', 'מספר העריכות גדול ממספר הפתחים; יש להסיר מזהי פתחים שאינם קיימים.');
  const openings: SimulationState['openings'] = {};
  for (const key of overrideIds) {
    const path = childPath('openings', key);
    const id = identifier(key, path);
    const base = knownOpenings.get(id);
    if (!base) invalid(path, 'מזהה הפתח אינו קיים; יש לבחור פתח מהתוכנית או להוסיף אותו לרשימת addedOpenings.');
    // The ID is validated, forbidden property names are rejected, and Map lookups
    // cannot inherit Object.prototype entries. No untrusted object is merged.
    openings[id] = openingOverride(overrides[id], base, path);
  }

  const targets = new Set([
    ...EDITABLE_WALLS.map(w => `wall-${w.id}`), ...[...knownFurniture].map(id => `furniture-${id}`),
    ...[...knownOpenings.keys()].map(id => `opening-${id}`), 'building-north', 'building-south', 'neighbor-east', 'neighbor-west',
  ]);
  for (const unit of ['north', 'south'] as const) {
    for (const floor of ['basement', 'ground', 'first', 'roof'] as const) {
      targets.add(surfaceTarget('floor', unit, floor)); targets.add(surfaceTarget('ceiling', unit, floor));
    }
    for (const floor of ['basement', 'ground']) targets.add(`stair-stair-${unit}-${floor}`);
  }
  return {
    version: 1, date, minutes,
    ...(hasOwn(input, 'appearance') ? { appearance: parseAppearance(input.appearance, targets, knownFurniture, CATALOG_IDS) } : {}),
    location: {
      latitude: number(location('latitude'), 'location.latitude', -89, 89),
      longitude: number(location('longitude'), 'location.longitude', -180, 180),
      elevation: number(location('elevation'), 'location.elevation', -450, 4000),
    },
    northBearing: number(get('northBearing'), 'northBearing', -180, 180),
    buildings: {
      north: building(buildings('north'), defaults.buildings.north, 'buildings.north'),
      south: building(buildings('south'), defaults.buildings.south, 'buildings.south'),
    },
    neighbors: neighbors(get('neighbors'), defaults.neighbors),
    vehicles: {
      southZ: number(vehicles('southZ'), 'vehicles.southZ', -20, 35),
      northZ: number(vehicles('northZ'), 'vehicles.northZ', -20, 35),
    },
    openings, addedOpenings,
    design: {
      wallEdits: editRecords(design('wallEdits'), 'design.wallEdits', new Set(EDITABLE_WALLS.map(wall => wall.id)), wallEdit),
      roomEdits: editRecords(design('roomEdits'), 'design.roomEdits', new Set(ROOMS.map(room => room.id)), roomEdit),
      furnitureEdits: editRecords(design('furnitureEdits'), 'design.furnitureEdits', knownFurniture,
        (value, path) => furnitureEdit(value, path, addedFurniture.some(item => path === `design.furnitureEdits.${item.id}`) ? 100 : 150)),
      addedFurniture,
    },
    view: {
      mode: choice(view('mode'), 'view.mode', ['orbit', 'plan', 'walk'] as const),
      cutaway: choice(view('cutaway'), 'view.cutaway', ['none', 'basement', 'ground', 'first'] as const),
      planVisible: boolean(view('planVisible'), 'view.planVisible'),
      planOpacity: number(view('planOpacity'), 'view.planOpacity', 0, 1),
      planFloor: choice(view('planFloor'), 'view.planFloor', ['basement', 'ground', 'first'] as const),
      grid: boolean(view('grid'), 'view.grid'),
      labels: boolean(view('labels'), 'view.labels'),
      path: boolean(view('path'), 'view.path'),
      dimensions: boolean(view('dimensions'), 'view.dimensions'),
      directOnly: boolean(view('directOnly'), 'view.directOnly'),
      quality: choice(view('quality'), 'view.quality', ['standard', 'high'] as const),
      eyeHeight: number(view('eyeHeight'), 'view.eyeHeight', 0.5, 2.2),
      isolateFloor: choice(view('isolateFloor'), 'view.isolateFloor', ['none', 'basement', 'ground', 'first', 'roof'] as const),
      renderMode: choice(view('renderMode'), 'view.renderMode', ['model', 'realistic'] as const),
    },
    reference: {
      image: referenceImage(reference('image')),
      width: number(reference('width'), 'reference.width', 10, 150),
      depth: number(reference('depth'), 'reference.depth', 10, 150),
      x: number(reference('x'), 'reference.x', -60, 60),
      z: number(reference('z'), 'reference.z', -60, 60),
      rotation: number(reference('rotation'), 'reference.rotation', -180, 180),
      opacity: number(reference('opacity'), 'reference.opacity', 0, 1),
      visible: boolean(reference('visible'), 'reference.visible'),
    },
  };
}

/** Read a version-1 state, default absent fields, reject unknown fields, and copy every record. */
export function parseProject(json: string): SimulationState {
  if (typeof json !== 'string' || json.length > MAX_JSON_LENGTH) {
    invalid('JSON', 'יש לבחור קובץ פרויקט JSON שאורכו עד 8,000,000 תווים; מומלץ להקטין את תמונת הייחוס.');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    invalid('JSON', 'הקובץ אינו JSON תקין; יש לבחור קובץ פרויקט שיוצא מהסימולטור.');
  }
  return validateProject(value);
}

/** Validate before stringification, so NaN, accessors and toJSON cannot hide bad state. */
export function serializeProject(state: SimulationState): string {
  const json = JSON.stringify(validateProject(state), null, 2);
  if (json.length > MAX_JSON_LENGTH) invalid('JSON', 'הפרויקט גדול מדי; יש להקטין את תמונת הייחוס או להסיר עריכות עודפות.');
  return json;
}

/** SSR, unavailable storage, and corrupt projects all behave like an empty stash. */
export function loadProject(): SimulationState | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.localStorage;
    if (!storage) return null;
    const json = storage.getItem(PROJECT_STORAGE_KEY);
    return json === null ? null : parseProject(json);
  } catch {
    return null;
  }
}

/** Store the complete local project, including its image; quota failures leave it untouched. */
export function saveProject(state: SimulationState): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const storage = window.localStorage;
    if (!storage) return false;
    storage.setItem(PROJECT_STORAGE_KEY, serializeProject(state));
    return true;
  } catch {
    return false;
  }
}