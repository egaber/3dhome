import traced from '../assets/traced-walls.json';
import groundImage from '../assets/ground-plan.png';
import firstImage from '../assets/first-plan.png';
import basementImage from '../assets/basement-plan.png';
import sheetImage from '../assets/sheet-preview.png';
import northImage from '../assets/north-detail.png';
import type { BuildingSettings, FloorId, FurnitureKind, FurnitureSpec, OpeningSpec, PlanWall, Room, SimulationState, UnitId, Vec2 } from './types';
import { FLOOR_NAMES, UNIT_NAMES } from './types';
import { normalizeRotation, rotatePlanPoint } from './rotation';

export const PARTY_Z = 6.84;
export const BASE_WIDTH = 11.89;
export const BASE_DEPTH: Record<UnitId, number> = { north: PARTY_Z, south: 16.16 - PARTY_Z };
export const SLAB = 0.24;
export const PDF_SCALE = traced.pointsPerMetre;
export const PDF_ORIGIN: Vec2 = [1873.864990234375, 605.254150390625];
export const SITE = { left: 0, right: 15.40, back: -12, front: 22.015 };
export const PLAN_IMAGES = {
  ground: { url: groundImage, crop: [1300, 130, 2440, 1350], origin: PDF_ORIGIN },
  first: { url: firstImage, crop: [155, 145, 1220, 1320], origin: [667.77, 605.254150390625] },
  basement: { url: basementImage, crop: [2510, 160, 3625, 1320], origin: [3049.70166015625, 618.6416015625] },
} as const;
export { sheetImage, northImage };

/** Outermost occupied floor outlines, digitized from the three separate plans. */
export const FOOTPRINTS: Record<FloorId, Record<UnitId, Vec2[]>> = {
  ground: {
    north: [[0, 0], [11.89, 0], [11.89, 4.44], [10.49, 4.44], [10.49, PARTY_Z], [0, PARTY_Z]],
    south: [[0, PARTY_Z], [11.89, PARTY_Z], [11.89, 10.09], [9.49, 10.09], [9.49, 12.54], [5.59, 12.54], [5.59, 16.16], [0, 16.16]],
  },
  first: {
    north: [[0, 0], [12.39, 0], [12.39, PARTY_Z], [0, PARTY_Z]],
    south: [[0, PARTY_Z], [12.39, PARTY_Z], [12.39, 13.26], [6.34, 13.26], [6.34, 16.16], [0, 16.16]],
  },
  basement: {
    north: [[0, 0], [11.85, 0], [11.85, PARTY_Z], [0, PARTY_Z]],
    south: [[0, PARTY_Z], [11.85, PARTY_Z], [11.85, 12.50], [5.55, 12.50], [5.55, 16.12], [0, 16.12]],
  },
};

export const BALCONIES: Record<UnitId, Vec2[][]> = {
  north: [[[0.0, 0], [3.63, 0], [3.63, 2.31], [0, 2.31]]],
  south: [
    [[0, PARTY_Z], [4.0, PARTY_Z], [4.0, 8.46], [0, 8.46]],
    [[6.34, 13.26], [12.39, 13.26], [12.39, 16.16], [6.34, 16.16]],
  ],
};
export const STAIR_HOLES: Record<UnitId, Vec2[]> = {
  north: [[3.68, 3.55], [5.92, 3.55], [5.92, 6.62], [3.68, 6.62]],
  south: [[4.06, 7.04], [6.32, 7.04], [6.32, 10.00], [4.06, 10.00]],
};
export const LIGHT_WELLS: Record<UnitId, Vec2[][]> = {
  north: [
    [[0, -1.5], [11.85, -1.5], [11.85, 0], [0, 0]],
    [[11.85, 0], [13.85, 0], [13.85, 4.40], [11.85, 4.40]],
  ],
  south: [
    [[11.85, PARTY_Z], [13.85, PARTY_Z], [13.85, 9.92], [11.85, 9.92]],
    [[0, 16.12], [2.05, 16.12], [2.05, 17.32], [0, 17.32]],
    [[9.27, 12.50], [11.85, 12.50], [11.85, 13.90], [9.27, 13.90]],
  ],
};

type RawWall = { id: string; a: number[]; b: number[]; thickness: number; gaps: { center: number; width: number }[] };
const lengthOf = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function traceWalls(): PlanWall[] {
  const result: PlanWall[] = [];
  for (const floor of ['ground', 'first', 'basement'] as FloorId[]) {
    for (const raw of traced.levels[floor].walls as RawWall[]) {
      const a = raw.a as Vec2;
      const b = raw.b as Vec2;
      // Vertical walls spanning the party line are split per dwelling. The
      // original party wall is shared; duplicating it gives independent editing.
      const units: UnitId[] = a[1] < PARTY_Z - .015 && b[1] > PARTY_Z + .015
        ? ['north', 'south']
        : Math.abs(a[1] - PARTY_Z) < .03 && Math.abs(b[1] - PARTY_Z) < .03
          ? ['north', 'south']
          : [(a[1] + b[1]) / 2 < PARTY_Z ? 'north' : 'south'];
      for (const unit of units) {
        const from: Vec2 = [...a];
        const to: Vec2 = [...b];
        if (Math.abs(a[0] - b[0]) < .01) {
          if (unit === 'north') to[1] = Math.min(to[1], PARTY_Z);
          else from[1] = Math.max(from[1], PARTY_Z);
        }
        const length = lengthOf(from, to);
        if (length < .02) continue;
        const id = `${raw.id}-${unit}`;
        const horizontal = Math.abs(to[1] - from[1]) < .01;
        const retaining = floor === 'basement' && (
          Math.min(a[1], b[1]) < -.2 || Math.max(a[0], b[0]) > 12 || Math.min(a[1], b[1]) > 16.15
          || (Math.min(a[1], b[1]) > 12.7 && Math.min(a[0], b[0]) > 8)
        );
        const exterior = raw.thickness >= .19 && !(horizontal && Math.abs(a[1] - PARTY_Z) < .035);
        const offset = lengthOf(a, from);
        const openings: OpeningSpec[] = raw.gaps.flatMap((gap, index) => {
          if (gap.center < offset || gap.center > offset + length) return [];
          let kind: OpeningSpec['kind'] = exterior ? (floor === 'ground' && gap.width > 1.8 ? 'glazing' : 'window') : 'door';
          if (floor === 'ground' && ['ground-wall-11', 'ground-wall-14'].includes(raw.id)) kind = 'door';
          if (floor === 'first' && raw.id === 'first-wall-1' && index === 0) return []; // Open balcony, not a 3.4m bedroom window.
          if (floor === 'first' && ['first-wall-18', 'first-wall-19', 'first-wall-20'].includes(raw.id) && gap.width < 1) kind = 'door';
          const label = `${kind === 'glazing' ? 'ויטרינה' : kind === 'window' ? 'חלון' : 'דלת'} ${index + 1} · ${FLOOR_NAMES[floor]}`;
          return [{
            id: `${id}-opening-${index}`, wallId: id, label, unit, floor, kind,
            position: (gap.center - offset) / length, width: gap.width,
            height: kind === 'door' ? 2.15 : kind === 'glazing' ? 2.5 : floor === 'basement' ? .9 : 1.35,
            sill: kind === 'door' || kind === 'glazing' ? 0 : floor === 'basement' ? 1.65 : .95,
            open: kind === 'door' && !exterior, shutter: false, overhang: 0, source: 'plan',
          } satisfies OpeningSpec];
        });
        const wall: PlanWall = { id, sourceId: raw.id, unit, floor, a: from, b: to, thickness: raw.thickness, exterior, retaining, openings };
        if (floor === 'first' && raw.id === 'first-wall-12') wall.low = 1.05;
        // The open edge of the rear balcony must not become a full-height wall.
        if (floor === 'first' && raw.id === 'first-wall-1') {
          result.push({ ...wall, id: `${id}-balcony`, b: [3.63, .11], openings: [], low: 1.05 });
          wall.a = [3.63, .11];
          wall.openings = openings.map(o => ({ ...o, position: (o.position * length - 3.63) / (length - 3.63) }));
        }
        result.push(wall);
      }
    }
  }
  // The PDF depicts a railing at the front roof terrace, rather than an enclosed wall.
  result.push({ id: 'first-front-railing-south', sourceId: 'railing', unit: 'south', floor: 'first', a: [6.34, 16.06], b: [12.39, 16.06], thickness: .10, exterior: true, retaining: false, low: 1.05, openings: [] });
  return result;
}

export const WALLS = traceWalls();
export const BASE_OPENINGS = WALLS.flatMap(w => w.openings);

// Stable counterparts of the formerly anonymous north-first concept facade.
// WALLS/BASE_OPENINGS remain the immutable PDF catalog, including all original IDs.
const conceptSegments: [string, Vec2, Vec2, boolean?][] = [
  ['west', [0, 0], [0, PARTY_Z]], ['south', [0, PARTY_Z], [11.9, PARTY_Z]],
  ['north-pier-1', [0, 0], [.45, 0]], ['north-glass-1', [.45, 0], [4, 0], true],
  ['north-pier-2', [4, 0], [4.3, 0]], ['north-glass-2', [4.3, 0], [8.1, 0], true],
  ['north-pier-3', [8.1, 0], [8.4, 0]], ['north-glass-3', [8.4, 0], [11.9, 0], true],
  ['east-pier-1', [11.9, 0], [11.9, .45]], ['east-glass', [11.9, .45], [11.9, 5.8], true],
  ['east-pier-2', [11.9, 5.8], [11.9, PARTY_Z]],
  ['service-north', [0, 4.55], [2.8, 4.55]], ['service-east', [2.8, 4.55], [2.8, PARTY_Z]],
  ['wc-north', [9.25, 5.05], [11.9, 5.05]], ['wc-west', [9.25, 5.05], [9.25, PARTY_Z]],
];
export const EDITABLE_WALLS: PlanWall[] = [...WALLS, ...conceptSegments.map(([name, a, b, glazing]): PlanWall => {
  const id = `concept-first-north-${name}`;
  return {
    id, sourceId: 'open-plan-concept', provenance: 'concept', unit: 'north', floor: 'first',
    a, b, thickness: .18, exterior: !name.startsWith('service') && !name.startsWith('wc'), retaining: false,
    openings: glazing ? [{ id: `${id}-opening`, wallId: id, label: 'ויטרינה · חלופת קונספט',
      unit: 'north', floor: 'first', kind: 'glazing', position: .5, width: lengthOf(a, b),
      height: 2.55, sill: 0, open: false, shutter: false, overhang: 0, source: 'plan' }] : [],
  };
})];
export const EDITABLE_OPENINGS = EDITABLE_WALLS.flatMap(wall => wall.openings);

export function isFloorAvailable(floor: FloorId, building: BuildingSettings): boolean {
  return building.enabled === true && (building.storeys === 1 || building.storeys === 2)
    && (floor === 'basement' || floor === 'ground' || (floor === 'first' && building.storeys === 2));
}

const room = (id: string, name: string, unit: UnitId, floor: FloorId, x: number, z: number, width: number, depth: number, kind: Room['kind']): Room => ({ id, name, unit, floor, center: [x, z], width, depth, kind });
export const ROOMS: Room[] = [
  room('a-living', 'סלון', 'north', 'ground', 9.6, 2.05, 3.7, 3.5, 'living'),
  room('a-dining', 'פינת אוכל', 'north', 'ground', 5.85, 1.9, 3.25, 3.1, 'dining'),
  room('a-kitchen', 'מטבח', 'north', 'ground', 1.9, 3.65, 3.1, 5.2, 'kitchen'),
  room('a-entry', 'מבואה', 'north', 'ground', 8.85, 5.95, 2.45, 1.4, 'hall'),
  room('a-wc', 'שירותי אורחים', 'north', 'ground', 7.03, 4.85, 1.75, 1.05, 'bath'),
  room('b-living', 'סלון', 'south', 'ground', 2.70, 14.4, 4.7, 2.9, 'living'),
  room('b-dining', 'פינת אוכל', 'south', 'ground', 2.1, 11.25, 3.5, 2.5, 'dining'),
  room('b-kitchen', 'מטבח', 'south', 'ground', 2.0, 8.45, 3.35, 2.65, 'kitchen'),
  room('b-safe', 'ממ״ד', 'south', 'ground', 10.1, 8.36, 2.7, 2.6, 'bedroom'),
  room('b-bath', 'חדר רחצה', 'south', 'ground', 7.53, 7.86, 1.75, 1.45, 'bath'),
  room('b-entry', 'מבואה', 'south', 'ground', 7.35, 11.28, 3.2, 1.9, 'hall'),
  room('a-bed-west', 'חדר שינה מערבי', 'north', 'first', 1.88, 4.51, 3.1, 4.15, 'bedroom'),
  room('a-bed-ne', 'חדר שינה עורפי', 'north', 'first', 10.25, 1.82, 3.55, 2.95, 'bedroom'),
  room('a-bed-se', 'חדר שינה מזרחי', 'north', 'first', 10.25, 5.08, 3.55, 2.97, 'bedroom'),
  room('a-family', 'פינת משפחה', 'north', 'first', 7.1, 4.66, 1.95, 3.65, 'hall'),
  room('a-bath-upper', 'חדר רחצה', 'north', 'first', 7.05, 1.22, 2.05, 1.75, 'bath'),
  room('a-laundry', 'כביסה', 'north', 'first', 4.74, 1.22, 1.95, 1.75, 'hall'),
  room('b-bed-front-w', 'חדר שינה קדמי 1', 'south', 'first', 1.72, 13.65, 2.65, 4.4, 'bedroom'),
  room('b-bed-front-e', 'חדר שינה קדמי 2', 'south', 'first', 4.73, 14.55, 2.6, 2.55, 'bedroom'),
  room('b-bed-east', 'חדר שינה מזרחי', 'south', 'first', 9.33, 8.46, 5.35, 2.72, 'bedroom'),
  room('b-bed-terrace', 'חדר שינה · מרפסת', 'south', 'first', 9.9, 11.58, 4.25, 2.72, 'bedroom'),
  room('b-family', 'מבואת חדרים', 'south', 'first', 5.35, 11.33, 3.25, 2.28, 'hall'),
  room('b-bath-upper', 'רחצה וכביסה', 'south', 'first', 1.95, 9.63, 3.0, 2.25, 'bath'),
  room('a-basement', 'חלל מרתף א׳', 'north', 'basement', 8.4, 3.1, 5.5, 4.6, 'basement'),
  room('a-basement-room', 'חדר במרתף א׳', 'north', 'basement', 1.8, 1.85, 2.9, 2.7, 'basement'),
  room('b-basement', 'חלל מרתף ב׳', 'south', 'basement', 2.8, 13.4, 4.5, 4.5, 'basement'),
];

/** Illustrative furniture/appliance seeds, not surveyed dimensions or placements.
 * Room-relative defaults intentionally follow room moves/resizes until overridden. */
function roomFurniture(room: Room): FurnitureSpec[] {
  const items: FurnitureSpec[] = [];
  const add = (suffix: string, kind: FurnitureKind, x: number, z: number, width: number, depth: number, height: number, rotation = 0) => {
    items.push({ id: `${room.id}-${suffix}`, unit: room.unit, floor: room.floor, kind,
      center: rotatePlanPoint([room.center[0] + x, room.center[1] + z], room.center, room.rotation ?? 0),
      width, depth, height, rotation: room.rotation ? normalizeRotation(rotation + room.rotation) : rotation, source: 'plan' });
  };
  if (room.kind === 'bedroom') add('bed', 'bed', 0, .14, 1.55, 1.95, .87);
  if (room.kind === 'living') {
    add('sofa', 'sofa', 0, .9, 2.15, .82, .77);
    add('coffee-table', 'coffee-table', 0, -.15, 1, .52, .34);
  }
  if (room.kind === 'dining') {
    add('table', 'dining-table', 0, 0, 1.6, .85, .82);
    for (const [i, x] of [-.55, .55].entries()) for (const [j, z] of [-.68, .68].entries()) {
      add(`chair-${i}-${j}`, 'chair', x, z, .42, .4, .79, z < 0 ? 0 : 180);
    }
  }
  if (room.kind === 'kitchen') {
    const x = -room.width / 2 + .38;
    const depth = Math.max(.2, Math.min(2.7, room.depth - .3));
    add('run', 'kitchen-unit', x, 0, .68, depth + .04, .935);
    // Each appliance is a separate logical item, not a child of the cabinet ID.
    add('sink', 'sink', x, -depth * .24, .54, .54, .96);
    add('cooktop', 'cooktop', x, depth * .24, .56, .54, .97);
    add('fridge', 'fridge', x + .72, -depth / 2 + .32, .64, .65, 1.85);
    add('dishwasher', 'dishwasher', x + .72, depth / 2 - .3, .6, .6, .9);
  }
  if (room.kind === 'bath') {
    add('toilet', 'toilet', -.35, 0, .42, .65, .78);
    add('basin', 'basin', .42, 0, .5, .4, .85);
  }
  return items;
}

const CONCEPT_FURNITURE: FurnitureSpec[] = ([
  ['island', 'kitchen-island', 1.75, 2.25, 1.2, 4, .92],
  ['table', 'dining-table', 5, 2.25, 1.15, 2.35, .81],
  ['sofa-west', 'sofa', 8, 2, 2.1, .85, .72],
  ['sofa-east', 'sofa', 10.25, 2, 2.1, .85, .72],
  ['sink', 'sink', 1.75, 1.2, .6, .55, .95],
  ['cooktop', 'cooktop', 1.75, 3.2, .6, .6, .95],
  ['fridge', 'fridge', .5, 5.4, .65, .65, 1.85],
  ['dishwasher', 'dishwasher', 2.1, 5.4, .6, .6, .9],
  ['toilet', 'toilet', 10.1, 6.1, .42, .65, .78],
  ['basin', 'basin', 11.1, 5.5, .5, .4, .85],
] satisfies [string, FurnitureKind, number, number, number, number, number][]).map(([id, kind, x, z, width, depth, height]) => ({
  id: `concept-first-north-${id}`, unit: 'north', floor: 'first', kind, center: [x, z],
  rotation: 0, width, depth, height, source: 'plan',
}));

export const BASE_FURNITURE: FurnitureSpec[] = [...ROOMS.flatMap(roomFurniture), ...CONCEPT_FURNITURE];

/** Fresh resolved logical objects shared by SVG and Three; decorations share the item ID. */
export function resolvedFurniture(state: SimulationState): FurnitureSpec[] {
  const concept = state.buildings.north.firstFloorVariant === 'open-plan' ? CONCEPT_FURNITURE : [];
  return [...resolvedRooms(state).flatMap(roomFurniture), ...concept, ...state.design.addedFurniture].flatMap(item => {
    if (!isFloorAvailable(item.floor, state.buildings[item.unit])) return [];
    const edit = Object.hasOwn(state.design.furnitureEdits, item.id) ? state.design.furnitureEdits[item.id] : undefined;
    if (edit?.deleted) return [];
    return [{ ...item, center: [...(edit?.center ?? item.center)] as Vec2, rotation: edit?.rotation ?? item.rotation,
      width: edit?.width ?? item.width, depth: edit?.depth ?? item.depth, height: edit?.height ?? item.height }];
  });
}

export function defaultState(): SimulationState {
  const unit = (id: UnitId): BuildingSettings => ({
    enabled: true, width: BASE_WIDTH, depth: BASE_DEPTH[id], x: 0, z: 0, rotation: 0,
    groundHeight: 3.4, upperHeight: 3.1, basementDepth: 2.95, parapet: .6,
    roofEnabled: true, roofFloorHeight: 2.5, roofPeakHeight: 10.5,
    firstFloorVariant: 'original', storeys: 2, stairLayout: 'u-shaped',
  });
  return {
    version: 1, date: '2026-12-21', minutes: 12 * 60,
    // Geocoder returned the STREET, not a rooftop at no.50. Approximate and editable.
    location: { latitude: 32.1796381, longitude: 34.8615166, elevation: 65 },
    northBearing: 14.7,
    buildings: { north: unit('north'), south: unit('south') },
    neighbors: [
      { id: 'west', name: 'בית קיים בתוכנית', enabled: true, x: -5.15, z: 8.0, width: 10.3, depth: 17.0, height: 9, roofRise: 1.8, rotation: 0 },
      { id: 'east', name: 'שכן ממזרח · מיקום משוער', enabled: true, x: 23.35, z: 7.65, width: 9.9, depth: 16.0, height: 9, roofRise: 1.8, rotation: 0 },
    ],
    vehicles: { southZ: 17, northZ: 12.8 },
    openings: {}, addedOpenings: [], design: { wallEdits: {}, roomEdits: {}, furnitureEdits: {}, addedFurniture: [] },
    view: { mode: 'orbit', cutaway: 'none', planVisible: true, planOpacity: .32, planFloor: 'ground', grid: false, labels: false, path: true, dimensions: true, directOnly: false, quality: 'high', eyeHeight: 1.62, isolateFloor: 'none', renderMode: 'model' },
    reference: { image: null, width: 52, depth: 43, x: 3, z: 5, rotation: -14.7, opacity: .65, visible: false },
  };
}

export function floorElevation(floor: FloorId, building: BuildingSettings) {
  return floor === 'basement' ? -building.basementDepth : floor === 'first' ? building.groundHeight : 0;
}
export function wallHeight(wall: PlanWall, building: BuildingSettings) {
  if (wall.low !== undefined) return wall.low;
  if (wall.retaining) return building.basementDepth;
  return (wall.floor === 'basement' ? building.basementDepth : wall.floor === 'ground' ? building.groundHeight : building.upperHeight) - SLAB;
}
export function wallScale(wall: PlanWall, state: SimulationState) {
  const unit = state.buildings[wall.unit];
  const dx = (wall.b[0] - wall.a[0]) * unit.width / BASE_WIDTH;
  const dz = (wall.b[1] - wall.a[1]) * unit.depth / BASE_DEPTH[wall.unit];
  return Math.hypot(dx, dz) / lengthOf(wall.a, wall.b);
}
export function resolvedWalls(state: SimulationState): PlanWall[] {
  return EDITABLE_WALLS.flatMap(wall => {
    const building = state.buildings[wall.unit];
    if (!isFloorAvailable(wall.floor, building)) return [];
    if (wall.unit === 'north' && wall.floor === 'first'
      && (wall.provenance === 'concept') !== (building.firstFloorVariant === 'open-plan')) return [];
    const edit = state.design.wallEdits[wall.id];
    if (edit?.deleted) return [];
    return [{ ...wall, a: edit ? [...edit.a] : [...wall.a], b: edit ? [...edit.b] : [...wall.b], openings: wall.openings.map(opening => ({ ...opening })) }];
  });
}
export function resolvedRooms(state: SimulationState): Room[] {
  return ROOMS.flatMap(room => {
    const building = state.buildings[room.unit];
    if (!isFloorAvailable(room.floor, building)
      || (room.unit === 'north' && room.floor === 'first' && building.firstFloorVariant === 'open-plan')) return [];
    const edit = state.design.roomEdits[room.id];
    if (edit?.deleted) return [];
    return [{ ...room, center: edit ? [...edit.center] : [...room.center], width: edit?.width ?? room.width, depth: edit?.depth ?? room.depth,
      ...(edit?.rotation !== undefined ? { rotation: edit.rotation } : {}) }];
  });
}
export function resolvedOpenings(state: SimulationState): OpeningSpec[] {
  return resolvedWalls(state).flatMap(wall => [...wall.openings, ...state.addedOpenings.filter(o => o.wallId === wall.id)].map(base => ({
    ...base, width: base.source === 'plan' ? base.width * wallScale(wall, state) : base.width, ...state.openings[base.id],
    id: base.id, wallId: base.wallId, unit: base.unit, floor: base.floor, source: base.source,
  })));
}
export function planPoint(point: Vec2, unit: UnitId, state: SimulationState): Vec2 {
  const settings = state.buildings[unit];
  const x = point[0] * settings.width / BASE_WIDTH;
  const z = (point[1] - PARTY_Z) * settings.depth / BASE_DEPTH[unit];
  const r = -settings.rotation * Math.PI / 180;
  return [x * Math.cos(r) + z * Math.sin(r) + settings.x, -x * Math.sin(r) + z * Math.cos(r) + PARTY_Z + settings.z];
}
export function trueWorldPoint(point: Vec2, state: SimulationState): Vec2 {
  const r = -state.northBearing * Math.PI / 180;
  return [point[0] * Math.cos(r) + point[1] * Math.sin(r), -point[0] * Math.sin(r) + point[1] * Math.cos(r)];
}
export function areaOf(polygon: Vec2[]) {
  return Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
}
export function buildingArea(unit: UnitId, state: SimulationState) {
  return areaOf(FOOTPRINTS.ground[unit]) * state.buildings[unit].width / BASE_WIDTH * state.buildings[unit].depth / BASE_DEPTH[unit];
}

export interface FloorAreaRow {
  id: FloorId | 'roof';
  label: string;
  gross: number;
  net: number;
  terraces: number;
}

/**
 * Model-area schedule. Gross follows the scaled floor envelope; estimated net
 * deducts modeled wall footprints. It is deliberately not a statutory area
 * calculation: shared walls, shafts and local planning rules need a surveyor.
 */
export function floorAreaSchedule(unit: UnitId, state: SimulationState): FloorAreaRow[] {
  const settings = state.buildings[unit];
  const sx = settings.width / BASE_WIDTH;
  const sz = settings.depth / BASE_DEPTH[unit];
  const rows: FloorAreaRow[] = (['basement', 'ground', 'first'] as FloorId[]).flatMap(floor => {
    if (floor === 'first' && settings.storeys === 1) return [];
    const gross = areaOf(FOOTPRINTS[floor][unit]) * sx * sz;
    const wallFootprint = resolvedWalls(state).filter(wall => wall.unit === unit && wall.floor === floor)
      .reduce((sum, wall) => {
        const length = lengthOf(wall.a, wall.b) * wallScale(wall, state);
        const perpendicularScale = Math.abs(wall.b[0] - wall.a[0]) > Math.abs(wall.b[1] - wall.a[1]) ? sz : sx;
        return sum + length * wall.thickness * perpendicularScale;
      }, 0);
    const openPlanAdjustment = floor === 'first' && unit === 'north' && settings.firstFloorVariant === 'open-plan'
      ? gross * .075 : 0;
    const terraces = floor === 'first'
      ? BALCONIES[unit].reduce((sum, balcony) => sum + areaOf(balcony) * sx * sz, 0)
      : 0;
    return [{ id: floor, label: FLOOR_NAMES[floor], gross, net: Math.max(0, gross - (openPlanAdjustment || wallFootprint)), terraces }];
  });
  if (settings.roofEnabled && settings.storeys === 2) {
    const grossBase = unit === 'north' ? 7.6 * 3.1 : 7.3 * 5;
    const perimeter = unit === 'north' ? 2 * (7.6 + 3.1) : 2 * (7.3 + 5);
    const partition = unit === 'north' ? 3.1 : 5;
    const terracesBase = unit === 'north'
      ? 11.8 * 2.15 + (11.8 - 9.15) * 3.1
      : 11.8 * (7.9 - PARTY_Z) + (11.8 - 8.55) * 5 + 11.8 * (16.12 - 13.05);
    const gross = grossBase * sx * sz;
    const walls = (perimeter + partition) * .18 * Math.sqrt(sx * sz);
    rows.push({ id: 'roof', label: 'עליית גג', gross, net: Math.max(0, gross - walls), terraces: terracesBase * sx * sz });
  }
  return rows;
}
export function siteWarnings(state: SimulationState): string[] {
  const warnings: string[] = [];
  for (const unit of ['north', 'south'] as UnitId[]) {
    if (!state.buildings[unit].enabled) continue;
    if (state.buildings[unit].stairLayout === 'straight') warnings.push(`${UNIT_NAMES[unit]}: גרם ישר ארוך עשוי לחצות חדרים וקירות. המידות רעיוניות; אין כאן בדיקת תקן או מרווח ראש.`);
    const floor: FloorId = state.buildings[unit].storeys === 2 ? 'first' : 'ground';
    const vertices = FOOTPRINTS[floor][unit].map(p => planPoint(p, unit, state));
    if (vertices.some(([x, z]) => x < SITE.left - .1 || x > SITE.right || z < SITE.back || z > SITE.front)) {
      warnings.push(`${UNIT_NAMES[unit]} חורגת מתחום העבודה המשוער.`);
    }
    if (state.buildings[unit].storeys < 2 && state.view.cutaway === 'first') warnings.push(`${UNIT_NAMES[unit]} מוגדרת עם קומת קרקע בלבד.`);
  }
  return warnings;
}