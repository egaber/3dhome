import { normalizeRotation, rotatePlanPoint } from './rotation';
import type { FurnitureSpec, OpeningKind, PlanWall, Room, SimulationState, Vec2 } from './types';

export function northBedroomProposal(state: SimulationState): SimulationState {
  return { ...state, buildings: { ...state.buildings, north: { ...state.buildings.north, enabled: true, storeys: 2, firstFloorVariant: 'bedrooms' } } };
}

export const NORTH_BEDROOM_FIRST_FOOTPRINT: Vec2[] = [[0, 0], [12.39, 0], [12.39, 9.24], [6.34, 9.24], [6.34, 6.84], [0, 6.84]];
export const NORTH_BEDROOM_SOUTH_FIRST_FOOTPRINT: Vec2[] = [[0, 6.84], [6.34, 6.84], [6.34, 9.24], [12.39, 9.24],
  [12.39, 13.26], [6.34, 13.26], [6.34, 16.16], [0, 16.16]];
export const NORTH_BEDROOM_BALCONIES: Vec2[][] = [[[0, 0], [3.92, 0], [3.92, 1.72], [0, 1.72]]];

export function northBedroomSouthWalls(walls: PlanWall[]): PlanWall[] {
  const inWing = ([horizontal, vertical]: Vec2) => horizontal >= 6.34 - 1e-6 && vertical <= 9.24 + 1e-6;
  return walls.filter(item => item.unit === 'south' && item.floor === 'first').flatMap(original => {
    const firstInside = inWing(original.a), lastInside = inWing(original.b);
    if (firstInside && lastInside) return [];
    if (!firstInside && !lastInside) return [original];
    let a: Vec2 = [...original.a], b: Vec2 = [...original.b];
    const originalLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (firstInside !== lastInside) {
      const horizontal = b[0] - a[0], vertical = b[1] - a[1];
      const fraction = Math.abs(horizontal) > 1e-6 ? (6.34 - a[0]) / horizontal : (9.24 - a[1]) / vertical;
      const boundary: Vec2 = [a[0] + horizontal * fraction, a[1] + vertical * fraction];
      if (firstInside) a = boundary; else b = boundary;
    }
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < .02) return [];
    const offset = Math.hypot(a[0] - original.a[0], a[1] - original.a[1]);
    const id = `north-bedrooms-south-${original.id}`;
    return [{ ...original, id, provenance: 'proposal' as const, a, b, openings: original.openings.flatMap(opening => {
      const center = opening.position * originalLength;
      const start = Math.max(offset, center - opening.width / 2), end = Math.min(offset + length, center + opening.width / 2);
      return end - start < .02 ? [] : [{ ...opening, id: `north-bedrooms-south-${opening.id}`, wallId: id,
        position: ((start + end) / 2 - offset) / length, width: end - start }];
    }) }];
  });
}

type Aperture = { at: number; width: number; kind: OpeningKind; label: string; sill?: number };
function wall(name: string, a: Vec2, b: Vec2, exterior: boolean, gaps: Aperture[] = [], low?: number): PlanWall {
  const id = `north-bedrooms-first-${name}`, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { id, sourceId: 'north-bedrooms-attached-plan', provenance: 'proposal', unit: 'north', floor: 'first', a, b,
    exterior, retaining: false, thickness: exterior ? .22 : .10, ...(low === undefined ? {} : { low }),
    openings: gaps.map((gap, index) => ({ id: `${id}-opening-${index}`, wallId: id, unit: 'north', floor: 'first', source: 'plan',
      kind: gap.kind, label: gap.label, position: gap.at / length, width: gap.width, height: gap.kind === 'door' ? 2.15 : gap.sill ? .65 : 1.35,
      sill: gap.sill ?? (gap.kind === 'door' ? 0 : .95), open: gap.kind === 'door', shutter: false, overhang: 0 })),
  };
}

export const NORTH_BEDROOM_WALLS: PlanWall[] = [
  wall('balcony-north', [.11, .11], [3.92, .11], true, [], 1.05),
  wall('balcony-west', [.11, .11], [.11, 1.72], true, [], 1.05),
  wall('north', [3.92, .11], [12.28, .11], true, [
    { at: .70, width: .8, kind: 'window', label: 'חלון חדר כביסה' },
    { at: 3.80, width: 2, kind: 'window', label: 'חלון צפוני בחדר הורים' },
    { at: 6.70, width: 2, kind: 'window', label: 'חלון צפוני נוסף בחדר הורים' },
  ]),
  wall('east', [12.28, .11], [12.28, 9.13], true, [
    { at: 2.08, width: 1.4, kind: 'window', label: 'חלון מזרחי בחדר הורים' },
    { at: 4.96, width: .65, kind: 'window', label: 'חלון רחצת הורים', sill: 1.5 },
    { at: 7.60, width: 1.4, kind: 'window', label: 'חלון חדר דרום מזרחי' },
  ]),
  wall('south-wing', [6.45, 9.13], [12.28, 9.13], false),
  wall('wing-west', [6.34, 6.84], [6.34, 9.24], false),
  wall('south-west', [.11, 6.73], [6.34, 6.73], false),
  wall('west', [.11, 1.72], [.11, 6.73], true),
  wall('west-bedroom-north', [.11, 1.72], [3.92, 1.72], true, [
    { at: 1.92, width: 2.2, kind: 'window', label: 'חלון חדר מערבי למרפסת' },
  ]),
  wall('laundry-west', [3.92, .11], [3.92, 2.20], false, [
    { at: .82, width: .80, kind: 'door', label: 'יציאה מחדר כביסה למרפסת' },
  ]),
  wall('laundry-east', [5.88, .11], [5.88, 2.20], false),
  wall('laundry-entry', [3.92, 2.20], [5.88, 2.20], false, [
    { at: .63, width: .82, kind: 'door', label: 'כניסה לחדר כביסה' },
  ]),
  wall('west-bedroom-entry', [3.92, 2.20], [3.92, 6.73], false, [
    { at: .61, width: .85, kind: 'door', label: 'כניסה לחדר שינה מערבי' },
  ]),
  wall('west-bath-entry', [.11, 5.33], [3.92, 5.33], false, [
    { at: 2.48, width: .80, kind: 'door', label: 'כניסה לרחצה מערבית' },
  ]),
  wall('master-entry', [5.88, 2.20], [7.59, 2.20], false, [
    { at: 1.11, width: .90, kind: 'door', label: 'כניסה לסוויטת הורים' },
  ]),
  wall('dressing-west', [7.59, 2.20], [7.59, 6.12], false),
  wall('master-south', [7.59, 6.12], [12.28, 6.12], false),
  wall('master-bath-north', [9.26, 4.08], [12.28, 4.08], false),
  wall('master-bath-entry', [9.26, 4.08], [9.26, 6.12], false, [
    { at: 1.24, width: .80, kind: 'door', label: 'כניסה לרחצת הורים' },
  ]),
  wall('southeast-entry', [6.34, 6.12], [7.59, 6.12], false, [
    { at: .625, width: .90, kind: 'door', label: 'כניסה לחדר דרום מזרחי' },
  ]),
  wall('southeast-bath-entry', [6.34, 7.45], [8.22, 7.45], false, [
    { at: .99, width: .80, kind: 'door', label: 'כניסה לרחצה דרום מזרחית' },
  ]),
  wall('southeast-bath-east', [8.22, 7.45], [8.22, 9.13], false),
];

const room = (name: string, label: string, center: Vec2, width: number, depth: number, kind: Room['kind']): Room =>
  ({ id: `north-bedrooms-${name}`, name: label, unit: 'north', floor: 'first', center, width, depth, kind });

export const NORTH_BEDROOM_ROOMS: Room[] = [
  room('master', 'חדר הורים', [9.055, 2.12], 6.25, 3.80, 'bedroom'),
  room('dressing', 'ארונות הורים', [8.48, 4.50], 1.67, 3.04, 'hall'),
  room('master-bath', 'רחצת הורים', [10.745, 5.10], 2.85, 1.90, 'bath'),
  room('west', 'חדר שינה מערבי', [2.04, 3.525], 3.64, 3.50, 'bedroom'),
  room('west-bath', 'רחצה מערבית', [2.04, 6.00], 3.64, 1.24, 'bath'),
  room('southeast', 'חדר שינה דרום מזרחי', [10.22, 7.63], 3.80, 3.00, 'bedroom'),
  room('southeast-bath', 'רחצה דרום מזרחית', [7.28, 8.29], 1.76, 1.56, 'bath'),
  room('laundry', 'חדר כביסה', [4.94, 1.16], 1.80, 1.98, 'hall'),
  room('hall', 'מבואת חדרים', [5.71, 2.77], 3.46, 1.10, 'hall'),
  room('stair-hall', 'מסדרון לצד המדרגות', [6.99, 4.72], 1.10, 2.70, 'hall'),
];

const seeds: { owner: string; item: FurnitureSpec }[] = [];
function furniture(owner: string, name: string, kind: FurnitureSpec['kind'], center: Vec2, width: number, depth: number, height: number, rotation = 0) {
  seeds.push({ owner: `north-bedrooms-${owner}`, item: { id: `north-bedrooms-${owner}-${name}`, unit: 'north', floor: 'first',
    source: 'plan', kind, center, width, depth, height, rotation } });
}
furniture('master', 'bed', 'bed', [10.72, 2.80], 1.60, 2, .87, 180);
furniture('master', 'nightstand-west', 'nightstand', [9.58, 3.72], .45, .42, .55);
furniture('master', 'nightstand-east', 'nightstand', [11.91, 3.72], .42, .42, .55);
furniture('master', 'chair', 'armchair', [11.25, .83], 1.20, .78, .82, -15);
furniture('master', 'desk', 'desk', [6.30, 1.17], 1.65, .58, .75, 90);
furniture('master', 'desk-chair', 'chair', [7.05, 1.17], .43, .43, .84, 90);
furniture('dressing', 'wardrobe', 'wardrobe', [7.98, 4.16], 3.70, .65, 2.35, 90);
furniture('master-bath', 'vanity', 'vanity', [10.45, 4.42], 1.65, .50, .87);
furniture('master-bath', 'shower', 'shower', [11.64, 5.15], .90, 1.75, 2.10);
furniture('master-bath', 'toilet', 'toilet', [10.66, 5.72], .44, .66, .80, 180);
furniture('west', 'bed', 'bed', [1.02, 4.23], 1.35, 1.95, .82, 180);
furniture('west', 'wardrobe', 'wardrobe', [.57, 2.52], 1.35, .58, 2.35, 90);
furniture('west', 'desk', 'desk', [3.49, 4.34], 1.10, .58, .75, -90);
furniture('west', 'chair', 'chair', [2.70, 4.34], .43, .43, .83, -90);
furniture('west-bath', 'shower', 'shower', [.83, 6.02], 1.10, 1.10, 2.10);
furniture('west-bath', 'vanity', 'vanity', [2.17, 6.38], .70, .42, .87, 180);
furniture('west-bath', 'toilet', 'toilet', [3.45, 6.13], .44, .66, .80, 180);
furniture('laundry', 'stack', 'washer-dryer', [5.44, .67], .62, .68, 1.85, 90);
furniture('laundry', 'cabinet', 'wardrobe', [5.44, 1.65], .78, .62, 2.30, 90);
furniture('southeast', 'bed', 'bed', [11.50, 8.02], 1.20, 2.00, .82);
furniture('southeast', 'desk', 'desk', [10.08, 6.58], 1.30, .60, .75);
furniture('southeast', 'chair', 'chair', [10.08, 7.34], .43, .43, .83);
furniture('southeast', 'wardrobe', 'wardrobe', [8.58, 8.19], 1.60, .60, 2.35, 90);
furniture('southeast-bath', 'shower', 'shower', [6.88, 8.57], .84, .90, 2.10);
furniture('southeast-bath', 'vanity', 'vanity', [6.77, 7.79], .55, .40, .87, 90);
furniture('southeast-bath', 'toilet', 'toilet', [7.78, 8.60], .44, .66, .80, 180);

export const NORTH_BEDROOM_FURNITURE = seeds.map(seed => seed.item);
export function northBedroomRoomFurniture(current: Room): FurnitureSpec[] {
  const base = NORTH_BEDROOM_ROOMS.find(item => item.id === current.id);
  if (!base) return [];
  return seeds.filter(seed => seed.owner === current.id).map(({ item }) => ({ ...item,
    center: rotatePlanPoint([current.center[0] + item.center[0] - base.center[0], current.center[1] + item.center[1] - base.center[1]], current.center, current.rotation ?? 0),
    rotation: normalizeRotation(item.rotation + (current.rotation ?? 0)),
  }));
}