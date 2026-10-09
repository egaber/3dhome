import drawing from '../assets/october-ground-vectors.json';
import image from '../assets/october-ground-plan.jpg';
import { choice } from './cadValidation';
import { normalizeRotation, rotatePlanPoint } from './rotation';
import type { FurnitureSpec, PlanWall, Room, UnitId, Vec2 } from './types';

export const OCTOBER_PLAN_NAME = 'קומת קרקע · 08.10.2026';
export const OCTOBER_PLAN_ID = 'october-ground-2026';
export const OCTOBER_SOURCE = { ...drawing, image };
const PARTY = 6.84;

export const OCTOBER_FOOTPRINTS: Record<UnitId, Vec2[]> = {
  north: [[0, 0], [11.89, 0], [11.89, 9.52], [8.44, 9.52], [8.44, 9.17], [6.34, 9.17], [6.34, 6.94], [0, 6.94]],
  south: [[0, 6.94], [6.34, 6.94], [6.34, 9.17], [8.44, 9.17], [8.44, 9.52], [9.49, 9.52], [9.49, 12.54], [6.19, 12.54], [6.19, 16.16], [0, 16.16]],
};

export const OCTOBER_WALLS: PlanWall[] = drawing.walls.flatMap(raw => raw.units.map(value => {
  const unit = choice(value, 'October wall unit', ['north', 'south']);
  const a: Vec2 = [raw.a[0], raw.a[1]], b: Vec2 = [raw.b[0], raw.b[1]];
  if (raw.splitAtParty) {
    if (unit === 'north') b[1] = PARTY;
    else a[1] = PARTY;
  }
  const offset = Math.hypot(a[0] - raw.a[0], a[1] - raw.a[1]), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const id = `october-ground-${raw.sourceIndex}-${unit}`;
  return { id, sourceId: `pdf-october-path-${raw.sourceIndex}`, unit, floor: 'ground', a, b, thickness: raw.thickness,
    exterior: raw.exterior, retaining: false,
    openings: raw.gaps.flatMap((gap, index) => {
      if (gap.center < offset || gap.center > offset + length) return [];
      const kind = choice(gap.kind, 'October opening kind', ['window', 'glazing', 'door']);
      return [{ id: `${id}-opening-${index}`, wallId: id, label: gap.label, unit, floor: 'ground', kind,
        position: (gap.center - offset) / length, width: gap.width, height: kind === 'window' ? 1.1 : kind === 'door' ? 2.15 : 2.5,
        sill: kind === 'window' ? 1.1 : 0, open: kind === 'door' && !raw.exterior,
        ...(kind === 'door' ? { swing: raw.sourceIndex === 48 ? 'negative' as const : 'positive' as const } : {}),
        shutter: false, overhang: 0, source: 'plan' }];
    }) } satisfies PlanWall;
}));

const room = (id: string, name: string, unit: UnitId, center: Vec2, width: number, depth: number, kind: Room['kind']): Room =>
  ({ id: `october-${id}`, name, unit, floor: 'ground', center, width, depth, kind });
export const OCTOBER_ROOMS: Room[] = [
  room('north-kitchen', 'מטבח ואי', 'north', [2.055, 3.48], 3.67, 6.52, 'kitchen'),
  room('north-dining', 'פינת אוכל', 'north', [5.415, 2.22], 2.83, 4, 'dining'),
  room('north-living', 'סלון', 'north', [9.67, 2.22], 4, 4, 'living'),
  room('north-entry', 'מבואה', 'north', [9.405, 5.03], 4.53, 1.62, 'hall'),
  room('north-hall', 'מבואת רחצה וממ״ד', 'north', [7.54, 6.49], 2, .9, 'hall'),
  room('north-bath', 'חדר רחצה', 'north', [7.59, 7.955], 1.9, 1.83, 'bath'),
  room('north-safe', 'ממ״ד', 'north', [10.115, 7.655], 2.95, 3.23, 'bedroom'),
  room('south-kitchen', 'מטבח ואי', 'south', [2.06, 8.465], 3.68, 3.05, 'kitchen'),
  room('south-dining', 'פינת אוכל', 'south', [1.77, 11.18], 3.1, 2.2, 'dining'),
  room('south-entry', 'מבואה', 'south', [7.725, 11.23], 3.09, 2.08, 'hall'),
  room('south-wc', 'שירותי אורחים', 'south', [7.44, 9.655], 2, .97, 'bath'),
  room('south-living', 'סלון', 'south', [3.095, 14.13], 5.75, 3.62, 'living'),
];

const seeds: { owner: string; item: FurnitureSpec }[] = [];
const add = (owner: string, name: string, kind: FurnitureSpec['kind'], center: Vec2, width: number, depth: number, height: number, rotation = 0) => {
  const room = OCTOBER_ROOMS.find(room => room.id === `october-${owner}`)!;
  seeds.push({ owner: room.id, item: { id: `october-${owner}-${name}`, unit: room.unit, floor: 'ground', kind, center, width, depth, height, rotation, source: 'plan' } });
};
for (const unit of ['north', 'south'] as const) {
  add(`${unit}-kitchen`, 'counter', 'kitchen-unit', [.55, unit === 'north' ? 3.86 : 8.50], .66, unit === 'north' ? 4.3 : 2.7, .94);
  add(`${unit}-kitchen`, 'sink', 'sink', [.55, unit === 'north' ? 4.40 : 8.10], .54, .56, .96, 90);
  add(`${unit}-kitchen`, 'cooktop', 'cooktop', [.55, unit === 'north' ? 2.96 : 9.42], .54, .6, .96, 90);
  add(`${unit}-kitchen`, 'fridge', 'fridge', [2.58, unit === 'north' ? 6.28 : 7.34], .9, .68, 1.98);
  add(`${unit}-kitchen`, 'dishwasher', 'dishwasher', [.55, unit === 'north' ? 3.69 : 8.78], .6, .6, .9, 90);
}
add('north-kitchen', 'island', 'kitchen-island', [2.5, 1.85], .9, 2.4, .94);
for (let i = 0; i < 4; i++) add('north-kitchen', `stool-${i}`, 'chair', [3.24, .94 + i * .59], .4, .4, 1.02, -90);
add('north-kitchen', 'pantry', 'wardrobe', [3.55, 5.42], .55, 2.15, 2.3);
add('north-dining', 'table', 'dining-table', [5.35, 1.9], 2.4, 1.04, .76);
for (let i = 0; i < 4; i++) for (const sign of [-1, 1]) add('north-dining', `seat-${i}-${sign < 0 ? 'n' : 's'}`, 'chair', [4.48 + i * .58, 1.9 + sign * .83], .43, .43, .8, sign > 0 ? 180 : 0);
add('north-living', 'sofa-west', 'sofa', [7.83, 2.10], 2.25, .84, .8, 90);
add('north-living', 'sofa-east', 'sofa', [11.13, 2.10], 2.25, .84, .8, -90);
add('north-living', 'table', 'coffee-table', [9.45, 2.10], 1.05, .58, .36, 90);
add('north-safe', 'bed', 'bed', [10.79, 8.39], 1.4, 1.65, .85);
add('north-safe', 'wardrobe', 'wardrobe', [10.73, 6.37], 1.6, .6, 2.2);
add('north-bath', 'toilet', 'toilet', [7.02, 7.45], .42, .63, .78);
add('north-bath', 'shower', 'shower', [7.02, 8.40], .72, .78, 2.05);
add('north-bath', 'basin', 'basin', [8.2, 8.42], .54, .4, .86);
add('south-kitchen', 'pantry', 'wardrobe', [3.54, 8.22], .56, 2.4, 2.2);
add('south-kitchen', 'island', 'kitchen-island', [2.12, 9.55], 2.3, .9, .94);
for (let i = 0; i < 4; i++) add('south-kitchen', `stool-${i}`, 'chair', [1.26 + i * .57, 10.3], .4, .4, 1.02, 180);
add('south-dining', 'table', 'dining-table', [1.15, 11.99], 1.55, .85, .76, 90);
for (const z of [11.55, 12.43]) for (const x of [.43, 1.89]) add('south-dining', `seat-${x < 1 ? 'w' : 'e'}-${z < 12 ? 'n' : 's'}`, 'chair', [x, z], .4, .4, .8, x < 1 ? 90 : -90);
add('south-living', 'sofa-north', 'sofa', [3.23, 13.31], 2.3, .84, .8, 180);
add('south-living', 'sofa-west', 'sofa', [1.52, 14.46], 2.3, .84, .8, 90);
add('south-living', 'table', 'coffee-table', [3.35, 14.52], 1.05, .65, .36);
add('south-wc', 'toilet', 'toilet', [7.92, 9.63], .42, .63, .78, 90);
add('south-wc', 'basin', 'basin', [6.69, 9.44], .37, .4, .86, 90);
export const OCTOBER_FURNITURE = seeds.map(seed => seed.item);

export function octoberRoomFurniture(room: Room): FurnitureSpec[] {
  const base = OCTOBER_ROOMS.find(item => item.id === room.id);
  if (!base) return [];
  return seeds.filter(seed => seed.owner === room.id).map(({ item }) => ({ ...item,
    center: rotatePlanPoint([item.center[0] + room.center[0] - base.center[0], item.center[1] + room.center[1] - base.center[1]], room.center, room.rotation ?? 0),
    rotation: normalizeRotation(item.rotation + (room.rotation ?? 0)) }));
}
