import type { FurnitureSpec, OpeningKind, PlanWall, Room, SimulationState, Vec2 } from './types';

export const SOUTH_FAMILY_STAIR_POSITION: Vec2 = [1.32, 9.965];
export const SOUTH_FAMILY_STAIR_HOLE: Vec2[] = [[.22, 8.20], [2.42, 8.20], [2.42, 11.73], [.22, 11.73]];
export function southFamilyProposal(state: SimulationState): SimulationState {
  return { ...state, buildings: { ...state.buildings, south: { ...state.buildings.south, southLayout: 'family', enabled: true, storeys: 2,
    stairLayout: 'u-shaped', stairPosition: [...SOUTH_FAMILY_STAIR_POSITION], stairRotation: 0, stairScale: 1, stairEnabled: true } } };
}
export const SOUTH_FAMILY_SUITE: Vec2[] = [[.22, 12.95], [3.88, 12.95], [3.88, 12.29], [6.12, 12.29], [6.12, 15.94], [.22, 15.94]];
export const SOUTH_FAMILY_FIRST_FOOTPRINT: Vec2[] = [[0, 6.84], [6.34, 6.84], [6.34, 9.24], [12.39, 9.24],
  [12.39, 13.26], [6.34, 13.26], [6.34, 16.16], [0, 16.16]];
export const SOUTH_FAMILY_BALCONIES: Vec2[][] = [
  [[0, 6.84], [3.63, 6.84], [3.63, 8.14], [0, 8.14]],
  [[6.34, 13.26], [12.39, 13.26], [12.39, 16.16], [6.34, 16.16]],
];

type DoorOrWindow = { at: number; width: number; kind: OpeningKind; label: string; sill?: number };
function wall(name: string, a: Vec2, b: Vec2, exterior: boolean, gaps: DoorOrWindow[] = [], low?: number): PlanWall {
  const id = `south-family-first-${name}`, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { id, sourceId: 'south-family-proposal', provenance: 'proposal', unit: 'south', floor: 'first', a, b,
    exterior, retaining: false, thickness: exterior ? .22 : low === undefined ? .12 : .08, ...(low === undefined ? {} : { low }),
    openings: gaps.map((gap, index) => ({ id: `${id}-opening-${index}`, wallId: id, unit: 'south', floor: 'first', source: 'plan',
      kind: gap.kind, label: gap.label, position: gap.at / length, width: gap.width,
      height: gap.kind === 'door' || gap.kind === 'glazing' ? 2.15 : gap.sill ? .65 : 1.35,
      sill: gap.sill ?? (gap.kind === 'door' || gap.kind === 'glazing' ? 0 : .95), open: gap.kind === 'door', shutter: false, overhang: 0 })),
  };
}

export const SOUTH_FAMILY_FIRST_WALLS: PlanWall[] = [
  wall('north-balcony', [.11, 6.84], [3.63, 6.84], true, [], 1.05),
  wall('north', [3.63, 6.84], [6.23, 6.84], false),
  wall('north-inset', [6.23, 6.84], [6.23, 9.35], true, [{ at: 1.3, width: 1.2, kind: 'window', label: 'חלון חדר ילד 1' }]),
  wall('east-wing-north', [6.23, 9.35], [12.28, 9.35], true, [
    { at: 1.15, width: .6, kind: 'window', label: 'חלון רחצה כללית', sill: 1.5 },
    { at: 4.1, width: 1.4, kind: 'window', label: 'חלון חדר ילד 2' },
  ]),
  wall('east', [12.28, 9.35], [12.28, 13.15], true, [{ at: 1.9, width: 1.4, kind: 'window', label: 'חלון מזרחי חדר ילד 2' }]),
  wall('terrace', [6.23, 13.15], [12.28, 13.15], true, [
    { at: 1.1, width: .9, kind: 'door', label: 'יציאה למרפסת קדמית' },
    { at: 4.1, width: 1.4, kind: 'window', label: 'חלון דרומי חדר ילד 2' },
  ]),
  wall('suite-east', [6.23, 13.15], [6.23, 16.05], true, [{ at: 1.7, width: .6, kind: 'window', label: 'חלון רחצה הורים', sill: 1.5 }]),
  wall('south', [.11, 16.05], [6.23, 16.05], true, [
    { at: 1.55, width: 1.4, kind: 'window', label: 'חלון דרומי סוויטת הורים' },
    { at: 4.9, width: .8, kind: 'window', label: 'חלון דרומי רחצה הורים', sill: 1.5 },
  ]),
  wall('west', [.11, 8.14], [.11, 16.05], true),
  wall('west-balcony', [.11, 6.84], [.11, 8.14], true, [], 1.05),
  wall('balcony-entry', [.11, 8.14], [3.63, 8.14], false, [{ at: 2.94, width: .85, kind: 'door', label: 'יציאה למרפסת קטנה' }]),
  wall('balcony-side', [3.63, 6.84], [3.63, 8.14], false),
  wall('child-1-west', [3.58, 8.14], [3.58, 11.01], false, [{ at: 1.72, width: .9, kind: 'door', label: 'כניסה נפרדת לחדר ילד 1' }]),
  wall('child-1-entry', [3.58, 11.01], [6.23, 11.01], false),
  wall('child-1-east', [6.23, 9.35], [6.23, 11.01], false),
  wall('child-2-entry', [9.12, 9.35], [9.12, 13.15], false, [{ at: 2.26, width: .9, kind: 'door', label: 'כניסה נפרדת לחדר ילד 2' }]),
  wall('family-bath-west', [6.23, 11.01], [6.23, 11.21], false),
  wall('family-bath-entry', [6.23, 11.21], [9.12, 11.21], false, [{ at: 1.36, width: .85, kind: 'door', label: 'כניסה לרחצה כללית' }]),
  wall('suite-entry', [3.94, 12.89], [.11, 12.89], false, [{ at: .89, width: .9, kind: 'door', label: 'כניסה לסוויטת הורים' }]),
  wall('suite-offset', [3.94, 12.23], [3.94, 12.89], false),
  wall('suite-dressing-north', [3.94, 12.23], [6.23, 12.23], false),
  wall('suite-services', [3.94, 16.05], [3.94, 12.89], false, [
    { at: 2.73, width: .8, kind: 'door', label: 'כניסה לחדר ארונות' },
    { at: 1.32, width: .85, kind: 'door', label: 'כניסה לרחצה פרטית' },
  ]),
  wall('suite-bath', [3.94, 13.85], [6.23, 13.85], false),
  wall('stair-guard', [2.46, 8.20], [2.46, 11.73], false, [], 1.05),
];

const room = (name: string, label: string, floor: 'ground' | 'first', center: Vec2, width: number, depth: number, kind: Room['kind']): Room =>
  ({ id: `south-family-${name}`, name: label, unit: 'south', floor, center, width, depth, kind });

export const SOUTH_FAMILY_ROOMS: Room[] = [
  room('living', 'סלון', 'ground', [2.17, 14.65], 3.9, 2.58, 'living'),
  room('dining', 'פינת אוכל לשישה', 'ground', [3.5, 12.02], 2.4, 2.45, 'dining'),
  room('kitchen', 'מטבח ואי', 'ground', [4.36, 8.54], 3.64, 3.18, 'kitchen'),
  room('wc', 'שירותי אורחים', 'ground', [7.44, 9.84], 2, 1.4, 'bath'),
  room('entry', 'מבואה', 'ground', [7.855, 11.48], 2.83, 1.68, 'hall'),
  room('laundry', 'כביסה ומייבש', 'ground', [8.87, 9.80], .66, 1.0, 'hall'),
  room('master', 'סוויטת הורים · חדר שינה', 'first', [2.05, 14.445], 3.66, 2.99, 'bedroom'),
  room('dressing', 'חדר ארונות הורים', 'first', [5.06, 13.04], 2.12, 1.50, 'hall'),
  room('ensuite', 'רחצה פרטית הורים', 'first', [5.06, 14.925], 2.12, 2.03, 'bath'),
  room('child-1', 'חדר ילד 1', 'first', [4.905, 8.95], 2.43, 4.00, 'bedroom'),
  room('child-2', 'חדר ילד 2', 'first', [10.675, 11.255], 2.99, 3.58, 'bedroom'),
  room('bath', 'שירותים ואמבטיה כללית', 'first', [7.75, 10.305], 2.62, 1.69, 'bath'),
  room('hall', 'מבואת חדרים', 'first', [4.40, 11.62], 3.44, 1.10, 'hall'),
  room('hall-east', 'מסדרון מזרחי', 'first', [7.75, 12.155], 2.62, 1.77, 'hall'),
  room('hall-west', 'מעבר למרפסת', 'first', [3, 9.60], 1.0, 2.80, 'hall'),
  room('stair-arrival', 'רחבת מדרגות', 'first', [1.32, 12.28], 2.20, 1.10, 'hall'),
];

const furniture = (name: string, kind: FurnitureSpec['kind'], floor: 'ground' | 'first', center: Vec2, width: number, depth: number, height: number, rotation = 0): FurnitureSpec =>
  ({ id: `south-family-${name}`, unit: 'south', floor, kind, center, width, depth, height, rotation, source: 'plan' });

export const SOUTH_FAMILY_FURNITURE: FurnitureSpec[] = [
  furniture('kitchen-counter', 'kitchen-unit', 'ground', [5.08, 7.29], 2.22, .65, .92),
  furniture('kitchen-sink', 'sink', 'ground', [4.42, 7.29], .56, .5, .97),
  furniture('kitchen-hob', 'cooktop', 'ground', [5.80, 7.29], .56, .5, .98),
  furniture('kitchen-fridge', 'fridge', 'ground', [2.94, 7.36], .72, .78, 1.95, 180),
  furniture('kitchen-oven', 'oven-tower', 'ground', [3.64, 7.29], .6, .65, 2.3, 180),
  furniture('kitchen-dishwasher', 'dishwasher', 'ground', [5.10, 7.29], .6, .6, .86, 180),
  furniture('kitchen-island', 'kitchen-island', 'ground', [4.45, 9.25], 1.74, .85, .92),
  furniture('island-chair-1', 'chair', 'ground', [4.04, 10.0], .42, .42, 1.05, 180),
  furniture('island-chair-2', 'chair', 'ground', [4.86, 10.0], .42, .42, 1.05, 180),
  furniture('dining-table', 'dining-table', 'ground', [3.50, 12.15], 1.9, .85, .76),
  furniture('dining-chair-1', 'chair', 'ground', [2.85, 11.34], .43, .44, .88),
  furniture('dining-chair-2', 'chair', 'ground', [3.50, 11.34], .43, .44, .88),
  furniture('dining-chair-3', 'chair', 'ground', [4.15, 11.34], .43, .44, .88),
  furniture('dining-chair-4', 'bench', 'ground', [3.50, 13.08], 1.9, .55, .9),
  furniture('living-sofa', 'sofa', 'ground', [1.75, 14.02], 2.6, .9, .85, 180),
  furniture('living-chair', 'armchair', 'ground', [3.45, 15.38], .85, .85, .83),
  furniture('living-table', 'coffee-table', 'ground', [2.20, 15.05], .75, .35, .4),
  furniture('living-tv', 'tv-console', 'ground', [1.80, 15.78], 2.0, .3, 1.45),
  furniture('living-storage', 'bookcase', 'ground', [.42, 12.68], 1.1, .32, 1.25, 90),
  furniture('entry-bench', 'bench', 'ground', [7.74, 11.99], 1.1, .4, .82),
  furniture('entry-coats', 'wardrobe', 'ground', [8.86, 11.95], .65, .46, 2.1),
  furniture('laundry-stack', 'washer-dryer', 'ground', [8.88, 9.82], .62, .68, 1.84, 180),
  furniture('guest-toilet', 'toilet', 'ground', [8.0, 9.64], .44, .66, .8, 90),
  furniture('guest-basin', 'vanity', 'ground', [6.73, 10.16], .5, .42, .85, -90),
  furniture('master-bed', 'bed', 'first', [1.90, 14.92], 1.8, 2, .88, 180),
  furniture('master-nightstand-west', 'nightstand', 'first', [.66, 15.56], .44, .44, .55),
  furniture('master-nightstand-east', 'nightstand', 'first', [3.13, 15.56], .44, .44, .55),
  furniture('master-dresser', 'nightstand', 'first', [.61, 13.21], .7, .4, .88, 180),
  furniture('child-1-bed', 'bed', 'first', [4.92, 7.62], .95, 2, .75, 90),
  furniture('child-1-desk', 'desk', 'first', [5.80, 8.94], 1.2, .6, .75, 90),
  furniture('child-1-chair', 'chair', 'first', [5.01, 8.94], .43, .43, .83, -90),
  furniture('child-1-nightstand', 'nightstand', 'first', [4.09, 8.43], .4, .4, .52),
  furniture('child-1-books', 'bookcase', 'first', [3.85, 9.00], .7, .3, 1.5, 90),
  furniture('child-2-bed', 'bed', 'first', [10.6, 12.52], .95, 2, .75, 90),
  furniture('child-2-desk', 'desk', 'first', [10.05, 9.78], 1.3, .6, .75, 180),
  furniture('child-2-chair', 'chair', 'first', [10.05, 10.76], .43, .43, .83, 180),
  furniture('child-2-nightstand', 'nightstand', 'first', [11.85, 11.77], .42, .40, .52),
  furniture('child-2-books', 'bookcase', 'first', [9.38, 10.60], .9, .3, 1.5, 90),
  furniture('ensuite-shower', 'shower', 'first', [5.63, 15.35], .9, 1, 2.1),
  furniture('ensuite-toilet', 'toilet', 'first', [4.58, 15.35], .44, .66, .8, 180),
  furniture('ensuite-basin', 'vanity', 'first', [5.18, 14.17], 1.10, .45, .87),
  furniture('dressing-wardrobe', 'wardrobe', 'first', [5.08, 12.59], 1.98, .55, 2.4, 180),
  furniture('child-1-wardrobe', 'wardrobe', 'first', [4.92, 10.62], 2.2, .60, 2.3),
  furniture('child-2-wardrobe', 'wardrobe', 'first', [11.83, 10.47], 1.8, .6, 2.3, -90),
  furniture('bath-tub', 'bathtub', 'first', [7.48, 9.94], 1.7, .75, .6),
  furniture('bath-toilet', 'toilet', 'first', [8.72, 9.85], .44, .64, .8),
  furniture('bath-basin', 'vanity', 'first', [6.68, 10.80], .60, .4, .87, -90),
  furniture('linen-cabinet', 'wardrobe', 'first', [5.91, 13.38], .3, .60, 2.1),
  furniture('kitchen-light', 'pendant', 'ground', [4.45, 9.25], .75, .28, 2.98),
  furniture('dining-light', 'pendant', 'ground', [3.50, 12.15], .6, .3, 2.98),
  furniture('living-light', 'pendant', 'ground', [2.20, 14.65], .6, .6, 2.98),
  furniture('entry-light', 'pendant', 'ground', [7.8, 11.20], .35, .35, 2.98),
  furniture('master-light', 'pendant', 'first', [1.9, 14.45], .45, .45, 2.72),
  furniture('child-1-light', 'pendant', 'first', [4.75, 9.20], .4, .4, 2.72),
  furniture('child-2-light', 'pendant', 'first', [10.5, 11.20], .4, .4, 2.72),
  furniture('bath-light', 'pendant', 'first', [7.5, 10.9], .3, .3, 2.72),
  furniture('ensuite-light', 'pendant', 'first', [5.08, 14.65], .3, .3, 2.72),
];