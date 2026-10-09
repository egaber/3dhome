import { normalizeRotation, rotatePlanPoint } from './rotation';
import type { FurnitureSpec, OpeningKind, PlanWall, Room, SimulationState, Vec2 } from './types';

export function northGroundProposal(state: SimulationState): SimulationState {
  return { ...state, buildings: { ...state.buildings, north: { ...state.buildings.north, northGroundLayout: 'attached' } } };
}

export function northGroundStairProposal(state: SimulationState): SimulationState {
  const north = { ...state.buildings.north, stairLayout: 'u-shaped' as const, stairPosition: [5.17, 5.19] as Vec2,
    stairRotation: 180, stairScale: 1, stairEnabled: true, stairRailing: true, stairOpeningGlass: true };
  delete north.stairPaths;
  return northGroundProposal({ ...state, buildings: { ...state.buildings, north } });
}

export const NORTH_GROUND_FOOTPRINT: Vec2[] = [[0, 0], [11.89, 0], [11.89, 9.3], [8.54, 9.3],
  [8.54, 9.04], [6.44, 9.04], [6.44, 6.84], [0, 6.84]];
export const NORTH_GROUND_STAIR_HOLE: Vec2[] = [[4, 3.74], [6.34, 3.74], [6.34, 6.64], [4, 6.64]];

type Aperture = { at: number; width: number; kind: OpeningKind; label: string; sill?: number };
function wall(name: string, a: Vec2, b: Vec2, exterior: boolean, gaps: Aperture[] = []): PlanWall {
  const id = `north-ground-wall-${name}`, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { id, sourceId: 'north-ground-attached-plan', provenance: 'proposal', unit: 'north', floor: 'ground', a, b,
    exterior, retaining: false, thickness: exterior ? .22 : .10,
    openings: gaps.map((gap, index) => ({ id: `${id}-opening-${index}`, wallId: id, unit: 'north', floor: 'ground', source: 'plan',
      kind: gap.kind, label: gap.label, position: gap.at / length, width: gap.width,
      height: gap.kind === 'door' ? 2.15 : gap.kind === 'glazing' ? 2.5 : .9,
      sill: gap.sill ?? (gap.kind === 'window' ? 1.2 : 0), open: gap.kind === 'door', shutter: false, overhang: 0 })),
  };
}

export const NORTH_GROUND_WALLS: PlanWall[] = [
  wall('north', [.11, .11], [11.78, .11], true, [
    { at: 2.05, width: 3.3, kind: 'glazing', label: 'ויטרינה צפונית במטבח' },
    { at: 5.70, width: 3.3, kind: 'glazing', label: 'ויטרינה צפונית בפינת האוכל' },
    { at: 9.35, width: 3.3, kind: 'glazing', label: 'ויטרינה צפונית בסלון' },
  ]),
  wall('west', [.11, .11], [.11, 6.73], true),
  wall('east', [11.78, .11], [11.78, 9.19], true, [
    { at: 2.10, width: 2.90, kind: 'glazing', label: 'ויטרינה מזרחית בסלון' },
    { at: 4.96, width: 1.10, kind: 'door', label: 'כניסה ראשית לצפונית' },
    { at: 7.55, width: 1.10, kind: 'window', label: 'חלון ממ״ד', sill: 1.1 },
  ]),
  wall('south-west', [.11, 6.73], [6.44, 6.73], false),
  wall('wing-west', [6.44, 6.73], [6.44, 8.93], false),
  wall('bath-south', [6.44, 8.93], [8.54, 8.93], false),
  wall('south-step', [8.54, 8.93], [8.54, 9.19], false),
  wall('safe-south', [8.54, 9.19], [11.78, 9.19], true),
  wall('service-entry', [6.44, 5.90], [8.54, 5.90], false, [
    { at: .98, width: .90, kind: 'door', label: 'כניסה למבואת הרחצה' },
  ]),
  wall('safe-entry', [8.54, 5.90], [11.78, 5.90], false, [
    { at: .65, width: .90, kind: 'door', label: 'כניסה לממ״ד' },
  ]),
  wall('safe-west', [8.54, 5.90], [8.54, 9.19], false),
  wall('bath-entry', [6.44, 7.22], [8.54, 7.22], false, [
    { at: 1.24, width: .80, kind: 'door', label: 'כניסה לרחצה' },
  ]),
  wall('tv-divider', [9.96, 3.83], [11.78, 3.83], false),
];

const room = (name: string, label: string, center: Vec2, width: number, depth: number, kind: Room['kind']): Room =>
  ({ id: `north-ground-${name}`, name: label, unit: 'north', floor: 'ground', center, width, depth, kind });

export const NORTH_GROUND_ROOMS: Room[] = [
  room('kitchen', 'מטבח ואי', [1.35, 4.30], 2.25, 4.80, 'kitchen'),
  room('dining', 'פינת אוכל עגולה', [6.56, 1.30], 4.82, 2.16, 'dining'),
  room('living', 'סלון', [9.10, 1.80], 5.14, 3.16, 'living'),
  room('entry', 'מבואה', [8.52, 4.99], 3.20, 1.60, 'hall'),
  room('safe', 'ממ״ד', [10.16, 7.54], 3.02, 3.06, 'bedroom'),
  room('bath-entry', 'מבואת רחצה', [7.49, 6.56], 1.90, 1.20, 'hall'),
  room('bath', 'חדר רחצה', [7.49, 8.08], 1.90, 1.58, 'bath'),
];

const seeds: { owner: string; item: FurnitureSpec }[] = [];
function furniture(owner: string, name: string, kind: FurnitureSpec['kind'], center: Vec2, width: number, depth: number, height: number, rotation = 0, shape?: 'round') {
  seeds.push({ owner: `north-ground-${owner}`, item: { id: `north-ground-${owner}-${name}`, unit: 'north', floor: 'ground',
    source: 'plan', kind, center, width, depth, height, rotation, ...(shape ? { shape } : {}) } });
}
furniture('kitchen', 'west-run', 'kitchen-unit', [.50, 3.94], .60, 3.32, .92);
furniture('kitchen', 'sink', 'sink', [.50, 4.81], .53, .62, .96);
furniture('kitchen', 'dishwasher', 'dishwasher', [.50, 4.07], .60, .60, .90);
furniture('kitchen', 'north-cabinet', 'wardrobe', [.50, 1.25], .60, 1.65, 2.35);
furniture('kitchen', 'south-cabinet-west', 'wardrobe', [.91, 6.30], 1.35, .60, 2.35);
furniture('kitchen', 'oven', 'oven-tower', [1.93, 6.30], .65, .60, 2.35);
furniture('kitchen', 'fridge', 'fridge', [2.65, 6.30], .72, .60, 2.10);
furniture('kitchen', 'south-cabinet-east', 'wardrobe', [3.48, 6.30], .85, .60, 2.35);
furniture('kitchen', 'island', 'kitchen-island', [2.50, 3.53], 1.10, 2.65, .92);
furniture('kitchen', 'cooktop', 'cooktop', [2.50, 4.31], .65, .62, .96);
for (const [index, vertical] of [2.42, 3.03].entries()) {
  furniture('kitchen', `island-chair-west-${index}`, 'chair', [1.61, vertical], .42, .42, .83, 90);
  furniture('kitchen', `island-chair-east-${index}`, 'chair', [3.39, vertical], .42, .42, .83, -90);
}
furniture('kitchen', 'island-chair-north', 'chair', [2.50, 1.89], .42, .42, .83);
furniture('dining', 'table', 'dining-table', [5.05, 1.30], 1.30, 1.30, .76, 0, 'round');
for (let index = 0; index < 6; index++) {
  const angle = index * Math.PI / 3;
  furniture('dining', `chair-${index}`, 'chair', [5.05 + Math.sin(angle) * .95, 1.30 - Math.cos(angle) * .95], .43, .42, .83, index * 60);
}
furniture('living', 'sofa-north', 'sofa', [10.08, .80], 2.58, .90, .79);
furniture('living', 'sofa-east', 'sofa', [11.05, 2.47], 2.44, .90, .79, 90);
furniture('living', 'armchair-north', 'armchair', [8.25, 1.88], .72, .75, .83, -90);
furniture('living', 'armchair-south', 'armchair', [8.25, 2.78], .72, .75, .83, -90);
furniture('living', 'coffee-large', 'coffee-table', [9.62, 2.45], .70, .70, .38);
furniture('living', 'coffee-small', 'coffee-table', [9.24, 2.87], .48, .48, .32);
furniture('living', 'tv', 'tv-console', [10.77, 3.54], 1.40, .42, .53, 180);
furniture('entry', 'stair-cabinet', 'wardrobe', [6.79, 4.575], .60, 1.55, 2.35);
furniture('bath', 'toilet', 'toilet', [6.99, 8.52], .44, .65, .80, 180);
furniture('bath', 'basin', 'basin', [8.10, 8.07], .46, .44, .85, -90);

export const NORTH_GROUND_FURNITURE = seeds.map(seed => seed.item);
export function northGroundRoomFurniture(current: Room): FurnitureSpec[] {
  const base = NORTH_GROUND_ROOMS.find(item => item.id === current.id);
  if (!base) return [];
  return seeds.filter(seed => seed.owner === current.id).map(({ item }) => ({ ...item,
    center: rotatePlanPoint([current.center[0] + item.center[0] - base.center[0], current.center[1] + item.center[1] - base.center[1]], current.center, current.rotation ?? 0),
    rotation: normalizeRotation(item.rotation + (current.rotation ?? 0)),
  }));
}