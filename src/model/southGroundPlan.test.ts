import { describe, expect, it } from 'vitest';
import { applyCadCommand, applyObjectCommand, resolveStairGeometry } from './cad';
import { defaultState, resolvedFurniture, resolvedRooms, resolvedWalls } from './plans';
import { southWestProposal } from './southWestLayout';
import { furnitureParts } from './furnitureParts';
import { parseProject, serializeProject } from '../lib/project';
import { furnitureSpec } from './cadValidation';

describe('south ground-floor source layout', () => {
  it('places the straight south staircase along the west wall without changing the north U stair', () => {
    const state = southWestProposal(defaultState());
    expect(state.buildings.south.stairLayout).toBe('straight');
    expect(state.buildings.north.stairLayout).toBe('u-shaped');
    const stair = resolveStairGeometry(state, 'south', 'ground')!;
    expect(stair.layout).toBe('straight');
    expect(Math.min(...stair.footprint.map(point => point[0]))).toBeGreaterThanOrEqual(.2);
    expect(Math.max(...stair.footprint.map(point => point[0]))).toBeLessThan(1.6);
  });

  it('uses the full kitchen bay up to the service-room partition', () => {
    const state = southWestProposal(defaultState());
    const rooms = resolvedRooms(state);
    const kitchen = rooms.find(room => room.id === 'south-west-kitchen')!;
    expect(kitchen.width).toBeGreaterThan(5.8);
    expect(kitchen.center[0] - kitchen.width / 2).toBeCloseTo(.22, 2);
    expect(kitchen.center[0] + kitchen.width / 2).toBeLessThanOrEqual(6.34);
    expect(rooms.find(room => room.id === 'a-kitchen')).toMatchObject({ width: 3.71, depth: 6.52 });
    expect(resolvedFurniture(state).some(item => item.id === 'south-west-kitchen-island')).toBe(true);
  });

  it('gives the south dining table the source drawing diameter without changing the north table', () => {
    const furniture = resolvedFurniture(southWestProposal(defaultState()));
    const table = furniture.find(item => item.id === 'south-west-dining-table')!;
    expect(table).toMatchObject({ shape: 'round', width: 1.3, depth: 1.3 });
    expect(furnitureParts(table).find(part => part.tone === 'surface')).toMatchObject({ shape: 'cylinder', width: 1.3, depth: 1.3 });
    expect(furniture.find(item => item.id === 'a-dining-table')).toMatchObject({ width: 1.6, depth: .85 });
  });

  it('preserves the original projects and all north, upper-floor and basement catalogs', () => {
    const original = defaultState(), before = structuredClone(original);
    const state = southWestProposal(original);
    expect(original).toEqual(before);
    expect(state.buildings.north).toBe(original.buildings.north);
    expect(state.design).toBe(original.design);
    expect(original.buildings.south.stairLayout).toBe('u-shaped');
    const untouched = (item: { unit: string; floor: string }) => item.unit === 'north' || item.floor !== 'ground';
    expect(resolvedWalls(state).filter(untouched)).toEqual(resolvedWalls(original).filter(untouched));
    expect(resolvedRooms(state).filter(untouched)).toEqual(resolvedRooms(original).filter(untouched));
    expect(resolvedFurniture(state).filter(untouched)).toEqual(resolvedFurniture(original).filter(untouched));
    expect(resolvedFurniture(original).some(item => item.id.startsWith('south-west-'))).toBe(false);
    expect(resolvedRooms(state).some(room => ['b-kitchen', 'b-dining'].includes(room.id))).toBe(false);
    expect(resolvedWalls(state).some(wall => ['ground-wall-24-south', 'ground-wall-25-south'].includes(wall.id))).toBe(false);
  });

  it('keeps the west stair aligned across connections and respects explicit placement edits', () => {
    const state = southWestProposal(defaultState());
    expect(resolveStairGeometry(state, 'south', 'basement')?.footprint).toEqual(resolveStairGeometry(state, 'south', 'ground')?.footprint);
    const moved = applyCadCommand(state, { type: 'stair-position', unit: 'south', position: [1.68, 10.44] });
    const before = resolveStairGeometry(state, 'south', 'ground')!, after = resolveStairGeometry(moved, 'south', 'ground')!;
    expect(after.footprint[0][0] - before.footprint[0][0]).toBeCloseTo(1, 10);
    expect(after.parts).toHaveLength(18);
    expect(after.parts.every(part => part.kind === 'tread')).toBe(true);
    expect(resolveStairGeometry({ ...state, buildings: { ...state.buildings, south: { ...state.buildings.south, stairEnabled: false } } }, 'south', 'ground')).toBeNull();
  });

  it('moves inherited dining furniture with its room and honors independent overrides and deletions', () => {
    const state = southWestProposal(defaultState());
    const moved = applyCadCommand(state, { type: 'room', id: 'south-west-dining', edit: {
      center: [3.18, 11.18], width: 2.2, depth: 2.28, rotation: 90, deleted: false,
    } });
    expect(resolvedFurniture(moved).find(item => item.id === 'south-west-dining-table')).toMatchObject({ center: [3.18, 11.18], rotation: 90, shape: 'round' });
    const independent = applyCadCommand(moved, { type: 'furniture', id: 'south-west-dining-table', edit: { center: [4, 11], rotation: 0, deleted: false } });
    expect(resolvedFurniture(independent).find(item => item.id === 'south-west-dining-table')?.center).toEqual([4, 11]);
    const deleted = applyCadCommand(moved, { type: 'room', id: 'south-west-dining', edit: {
      center: [3.18, 11.18], width: 2.2, depth: 2.28, rotation: 90, deleted: true,
    } });
    expect(resolvedFurniture(deleted).some(item => item.id.startsWith('south-west-dining-'))).toBe(false);
  });

  it('round-trips the selected layout, edits and a duplicated round table without leaking it into other plans', () => {
    const state = southWestProposal(defaultState());
    const duplicated = applyObjectCommand(state, { type: 'duplicate-furniture', id: 'south-west-dining-table', newId: 'round-table-copy' });
    const copy = duplicated.design.addedFurniture.find(item => item.id === 'round-table-copy')!;
    expect(copy).toMatchObject({ shape: 'round', layout: 'south-west' });
    expect(parseProject(serializeProject(duplicated))).toEqual(duplicated);
    const original = { ...duplicated, buildings: { ...duplicated.buildings, south: defaultState().buildings.south } };
    expect(resolvedFurniture(original).some(item => item.id === copy.id)).toBe(false);
    expect(original.design.addedFurniture).toContainEqual(copy);
  });

  it('rejects invalid round shapes, foreign layout ownership and unknown plan values', () => {
    const state = southWestProposal(defaultState());
    const table = { ...resolvedFurniture(state).find(item => item.id === 'south-west-dining-table')!, id: 'invalid-copy', source: 'added' };
    expect(() => furnitureSpec({ ...table, shape: 'triangle' }, 'item')).toThrow();
    expect(() => furnitureSpec({ ...table, kind: 'bed' }, 'item')).toThrow();
    expect(() => furnitureSpec({ ...table, layout: 'south-west', floor: 'first' }, 'item')).toThrow();
    expect(() => parseProject(JSON.stringify({ ...state, buildings: { ...state.buildings, north: { ...state.buildings.north, southLayout: 'west-stair' } } }))).toThrow();
    expect(() => parseProject(JSON.stringify({ ...state, buildings: { ...state.buildings, south: { ...state.buildings.south, southLayout: 'unknown' } } }))).toThrow();
  });
});