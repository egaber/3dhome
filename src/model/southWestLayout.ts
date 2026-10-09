import type { FurnitureSpec, Room, SimulationState, Vec2 } from './types';
import { normalizeRotation, rotatePlanPoint } from './rotation';

export const SOUTH_WEST_STAIR_HOLE: Vec2[] = [[.22, 8.44], [1.14, 8.44], [1.14, 12.44], [.22, 12.44]];
export const SOUTH_WEST_STAIR_POSITION: Vec2 = [.68, 10.44];

export function southWestProposal(state: SimulationState): SimulationState {
  return { ...state, buildings: { ...state.buildings, south: { ...state.buildings.south, southLayout: 'west-stair',
    stairLayout: 'straight', stairPosition: [...SOUTH_WEST_STAIR_POSITION], stairRotation: 0, stairScale: 1, stairEnabled: true } } };
}

export const SOUTH_WEST_ROOMS: Room[] = [
  { id: 'south-west-kitchen', name: 'מטבח ואי', unit: 'south', floor: 'ground', kind: 'kitchen', center: [3.28, 8.49], width: 6.12, depth: 3.1 },
  { id: 'south-west-dining', name: 'פינת אוכל עגולה', unit: 'south', floor: 'ground', kind: 'dining', center: [2.18, 11.18], width: 2.2, depth: 2.28 },
];

const furniture = (name: string, kind: FurnitureSpec['kind'], center: Vec2, width: number, depth: number, height: number, rotation = 0): FurnitureSpec =>
  ({ id: `south-west-${name}`, unit: 'south', floor: 'ground', kind, center, width, depth, height, rotation, source: 'plan' });

export const SOUTH_WEST_FURNITURE: FurnitureSpec[] = [
  furniture('kitchen-counter', 'kitchen-unit', [3.28, 7.265], 6.02, .65, .935),
  furniture('kitchen-return', 'kitchen-unit', [6.015, 8.305], .65, 1.43, .935),
  furniture('kitchen-sink', 'sink', [2.15, 7.265], .54, .54, .96),
  furniture('kitchen-cooktop', 'cooktop', [3.92, 7.265], .56, .54, .97),
  furniture('kitchen-dishwasher', 'dishwasher', [2.94, 7.265], .6, .6, .9, 180),
  furniture('kitchen-fridge', 'fridge', [5.965, 9.48], .75, .75, 1.95, 90),
  furniture('kitchen-island', 'kitchen-island', [3.58, 8.97], 2.5, 1, .935),
  ...[2.59, 3.25, 3.91, 4.57].map((horizontal, index) => furniture(`island-chair-${index}`, 'chair', [horizontal, 9.8], .42, .4, 1.05, 180)),
  { ...furniture('dining-table', 'dining-table', [2.18, 11.18], 1.3, 1.3, .76), shape: 'round' },
  furniture('dining-chair-nw', 'chair', [1.45, 10.45], .42, .4, .79, -45),
  furniture('dining-chair-ne', 'chair', [2.91, 10.45], .42, .4, .79, 45),
  furniture('dining-chair-sw', 'chair', [1.45, 11.91], .42, .4, .79, -135),
  furniture('dining-chair-se', 'chair', [2.91, 11.91], .42, .4, .79, 135),
];

export function southWestRoomFurniture(room: Room): FurnitureSpec[] {
  const sourceRoom = SOUTH_WEST_ROOMS.find(source => source.id === room.id);
  if (!sourceRoom) return [];
  return SOUTH_WEST_FURNITURE.filter(item => item.id.startsWith('south-west-dining-') === (room.kind === 'dining')).map(item => ({
    ...item, center: rotatePlanPoint([room.center[0] + item.center[0] - sourceRoom.center[0],
      room.center[1] + item.center[1] - sourceRoom.center[1]], room.center, room.rotation ?? 0),
    rotation: normalizeRotation(item.rotation + (room.rotation ?? 0)),
  }));
}