import { floorElevation, planPoint, resolvedFurniture, resolvedRooms, trueWorldPoint } from '../model/plans';
import { emptyAppearance, surfaceTarget } from '../model/appearance';
import type { FloorId, LevelId, Room, SimulationState, UnitId, Vec2 } from '../model/types';

export interface Viewpoint {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  zoom?: number;
}

export interface VisitorPosition {
  point: Vec2;
  heading: number;
  floor: LevelId;
  unit: UnitId;
  outside?: boolean;
}

export function showroomProject(source: SimulationState): SimulationState {
  const appearance = source.appearance ?? emptyAppearance();
  const assignments = { ...appearance.assignments };
  const models = { ...appearance.models };
  for (const item of resolvedFurniture(source)) {
    if (item.kind === 'sofa' && !models[item.id]) models[item.id] = 'parametric';
  }
  for (const unit of ['north', 'south'] as const) for (const floor of ['ground', 'first'] as const) {
    const target = surfaceTarget('floor', unit, floor);
    if (!assignments[target]) assignments[target] = { material: 'wood', metres: 2, roughness: .62 };
  }
  return { ...source, appearance: { ...appearance, assignments, models },
    view: { ...source.view, mode: 'walk', renderMode: 'realistic', quality: 'high', cutaway: 'none', isolateFloor: 'none',
      planVisible: false, grid: false, labels: false, path: false, dimensions: false, directOnly: false },
    reference: { ...source.reference, visible: false } };
}

export function applyShowroomLook(source: SimulationState, look: 'natural' | 'stone'): SimulationState {
  const styled = showroomProject(source), appearance = styled.appearance!;
  for (const unit of ['north', 'south'] as const) for (const floor of ['ground', 'first'] as const) {
    appearance.assignments[surfaceTarget('floor', unit, floor)] = { material: look === 'natural' ? 'wood' : 'stone', metres: look === 'natural' ? 2 : 2.4, roughness: look === 'natural' ? .62 : .4 };
  }
  for (const item of resolvedFurniture(source)) if (item.kind === 'sofa') appearance.models[item.id] = 'parametric';
  return { ...styled, view: { ...source.view, renderMode: 'realistic' } };
}

export function worldToPlan(point: Vec2, bearing: number): Vec2 {
  const r = bearing * Math.PI / 180;
  return [point[0] * Math.cos(r) + point[1] * Math.sin(r), -point[0] * Math.sin(r) + point[1] * Math.cos(r)];
}

export function visitorPosition(camera: Viewpoint, state: SimulationState, unit: UnitId, level?: LevelId): VisitorPosition {
  const point = worldToPlan([camera.position[0], camera.position[2]], state.northBearing);
  const target = worldToPlan([camera.target[0], camera.target[2]], state.northBearing);
  const height = camera.position[1] - state.view.eyeHeight + .15;
  const building = state.buildings[unit];
  const floor = level ?? (height >= floorElevation('roof', building) && building.stairToRoof ? 'roof'
    : height >= building.groundHeight ? 'first' : height < -.5 ? 'basement' : 'ground');
  return { point, heading: Math.atan2(target[0] - point[0], -(target[1] - point[1])) * 180 / Math.PI, floor, unit };
}

export function roomViewpoint(state: SimulationState, id: string): Viewpoint | null {
  const room = resolvedRooms(state).find(item => item.id === id);
  if (!room) return null;
  const point = trueWorldPoint(planPoint([room.center[0] - room.width * .28, room.center[1] - room.depth * .28], room.unit, state), state);
  const furniture = resolvedFurniture(state).filter(item => item.unit === room.unit && item.floor === room.floor);
  const subject = furniture.find(item => (room.kind === 'living' ? item.kind === 'sofa' : room.kind === 'bedroom' ? item.kind === 'bed'
    : room.kind === 'kitchen' ? item.kind === 'kitchen-unit' : item.kind === 'dining-table')
    && Math.abs(item.center[0] - room.center[0]) < room.width / 2 && Math.abs(item.center[1] - room.center[1]) < room.depth / 2);
  const focus = trueWorldPoint(planPoint(subject?.center ?? room.center, room.unit, state), state);
  const y = floorElevation(room.floor, state.buildings[room.unit]) + state.view.eyeHeight;
  return { position: [point[0], y, point[1]], target: [focus[0], y - .18, focus[1]], up: [0, 1, 0], zoom: 1 };
}

export function roomEntryPoints(room: Room): Vec2[] {
  const preferred = [[0, 0], [.22, 0], [-.22, 0], [0, .22], [0, -.22], [.3, .3], [-.3, -.3]];
  const grid = [-.4, -.3, -.2, -.1, 0, .1, .2, .3, .4].flatMap(x => [-.4, -.3, -.2, -.1, 0, .1, .2, .3, .4].map(z => [x, z]));
  return [...preferred, ...grid].map(([x, z]) => [room.center[0] + x * room.width, room.center[1] + z * room.depth]);
}

export const ROOM_FLOORS: FloorId[] = ['ground', 'first', 'basement'];
