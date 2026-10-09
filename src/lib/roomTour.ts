import { resolvedRooms } from '../model/plans';
import type { Room, SimulationState, UnitId } from '../model/types';

export function resolveTourRoom(state: SimulationState, unit: UnitId, preferredRoom: string): Room | undefined {
  const building = state.buildings[unit];
  if (!building.enabled) return undefined;
  const rooms = resolvedRooms(state).filter(room => room.unit === unit && (room.floor !== 'first' || building.storeys === 2));
  return rooms.find(room => room.id === preferredRoom)
    ?? rooms.find(room => room.floor === 'ground' && room.kind === 'living')
    ?? rooms.find(room => room.floor === 'ground')
    ?? rooms[0];
}