import { describe, expect, it } from 'vitest';
import { defaultState, resolvedRooms } from '../model/plans';
import { southWestProposal } from '../model/southWestLayout';
import { resolveTourRoom } from './roomTour';

describe('tour entry follows the selected dwelling', () => {
  it('keeps an available preferred room in the selected unit', () => {
    const state = defaultState();
    const preferred = resolvedRooms(state).find(room => room.unit === 'south' && room.floor === 'first')!;
    expect(resolveTourRoom(state, 'south', preferred.id)).toEqual(preferred);
  });
  it('starts in the selected dwelling living room instead of a room in the other dwelling', () => {
    const state = defaultState();
    const before = structuredClone(state);
    const north = resolvedRooms(state).find(room => room.unit === 'north')!;
    expect(resolveTourRoom(state, 'south', north.id)).toMatchObject({ unit: 'south', floor: 'ground', kind: 'living' });
    expect(resolveTourRoom(state, 'north', 'missing-room')).toMatchObject({ unit: 'north', floor: 'ground', kind: 'living' });
    expect(state).toEqual(before);
  });
  it('uses only active proposal rooms and falls back from removed source rooms', () => {
    const state = southWestProposal(defaultState());
    expect(resolveTourRoom(state, 'south', 'south-west-kitchen')).toMatchObject({ id: 'south-west-kitchen', unit: 'south' });
    expect(resolveTourRoom(state, 'south', 'b-kitchen')).toMatchObject({ unit: 'south', floor: 'ground', kind: 'living' });
  });
  it('does not enter a disabled dwelling or an unavailable first floor', () => {
    const state = defaultState();
    const upstairs = resolvedRooms(state).find(room => room.unit === 'south' && room.floor === 'first')!;
    state.buildings.south.storeys = 1;
    expect(resolveTourRoom(state, 'south', upstairs.id)).toMatchObject({ unit: 'south', floor: 'ground' });
    state.buildings.south.enabled = false;
    expect(resolveTourRoom(state, 'south', upstairs.id)).toBeUndefined();
  });
  it('ignores deleted rooms and returns no entry when the unit has no rooms', () => {
    const state = defaultState();
    const rooms = resolvedRooms(state).filter(room => room.unit === 'south');
    for (const room of rooms) state.design.roomEdits[room.id] = { center: room.center, width: room.width, depth: room.depth, deleted: true };
    expect(resolveTourRoom(state, 'south', rooms[0].id)).toBeUndefined();
    expect(resolveTourRoom(state, 'north', rooms[0].id)?.unit).toBe('north');
  });
});