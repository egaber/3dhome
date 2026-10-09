import { areaOf, resolvedFootprint, isFloorAvailable, planPoint, resolvedFurniture, resolvedRooms, resolvedWalls } from '../model/plans';
import { resolveStairGeometry, type StairGeometry } from '../model/cad';
import { rotatePlanPoint } from '../model/rotation';
import type { FloorId, FurnitureSpec, PlanWall, Room, SimulationState, UnitId, Vec2 } from '../model/types';

export interface CombinedPlanRoom {
  room: Room;
  center: Vec2;
  corners: Vec2[];
  width: number;
  depth: number;
}

export interface CombinedPlanUnit {
  id: UnitId;
  footprint: Vec2[];
  envelopeArea: number;
  walls: PlanWall[];
  furniture: FurnitureSpec[];
  rooms: CombinedPlanRoom[];
  stair: StairGeometry | null;
}

export interface CombinedPlan {
  floor: FloorId;
  units: CombinedPlanUnit[];
  bounds: { x: number; y: number; width: number; height: number };
}

export function combinedFloorPlan(state: SimulationState, floor: FloorId, unitScope: 'both' | UnitId = 'both'): CombinedPlan {
  const walls = resolvedWalls(state), rooms = resolvedRooms(state), furniture = resolvedFurniture(state);
  const units = (['north', 'south'] as const).filter(id => (unitScope === 'both' || id === unitScope) && isFloorAvailable(floor, state.buildings[id])).map(id => {
    const footprint = resolvedFootprint(floor, id, state).map(point => planPoint(point, id, state));
    return {
      id, footprint, envelopeArea: areaOf(footprint),
      stair: resolveStairGeometry(state, id, floor === 'basement' ? 'basement' : 'ground'),
      walls: walls.filter(wall => wall.unit === id && wall.floor === floor),
      furniture: furniture.filter(item => item.unit === id && item.floor === floor),
      rooms: rooms.filter(room => room.unit === id && room.floor === floor).map(room => {
        const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Vec2[]).map(([horizontal, vertical]) =>
          planPoint(rotatePlanPoint([room.center[0] + horizontal * room.width / 2, room.center[1] + vertical * room.depth / 2], room.center, room.rotation ?? 0), id, state));
        return {
          room, corners, center: planPoint(room.center, id, state),
          width: Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]),
          depth: Math.hypot(corners[2][0] - corners[1][0], corners[2][1] - corners[1][1]),
        };
      }),
    };
  });
  const points = units.flatMap(unit => [
    ...unit.footprint,
    ...(unit.stair?.footprint.map(point => planPoint(point, unit.id, state)) ?? []),
    ...unit.walls.flatMap(wall => [planPoint(wall.a, unit.id, state), planPoint(wall.b, unit.id, state)]),
    ...unit.rooms.flatMap(room => room.corners),
    ...unit.furniture.flatMap(item => ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Vec2[]).map(([horizontal, vertical]) =>
      planPoint(rotatePlanPoint([item.center[0] + horizontal * item.width / 2, item.center[1] + vertical * item.depth / 2], item.center, item.rotation), unit.id, state))),
  ]);
  if (!points.length) return { floor, units, bounds: { x: 0, y: 0, width: 1, height: 1 } };
  const left = Math.min(...points.map(point => point[0])), top = Math.min(...points.map(point => point[1]));
  return {
    floor, units,
    bounds: { x: left, y: top, width: Math.max(1, Math.max(...points.map(point => point[0])) - left), height: Math.max(1, Math.max(...points.map(point => point[1])) - top) },
  };
}