import polygonClipping from 'polygon-clipping';
import { describe, expect, it } from 'vitest';
import { southFamilyProposal, SOUTH_FAMILY_FIRST_FOOTPRINT, SOUTH_FAMILY_FIRST_WALLS, SOUTH_FAMILY_ROOMS, SOUTH_FAMILY_SUITE, SOUTH_FAMILY_STAIR_POSITION } from './southFamilyLayout';
import type { Vec2 } from './types';
import { defaultState, resolvedFurniture, resolvedRooms, resolvedWalls, resolvedFootprint } from './plans';
import { applyCadCommand, resolveStairGeometry } from './cad';
import { parseProject, serializeProject } from '../lib/project';

const rectangle = (center: Vec2, width: number, depth: number): Vec2[] => [[center[0] - width / 2, center[1] - depth / 2],
  [center[0] + width / 2, center[1] - depth / 2], [center[0] + width / 2, center[1] + depth / 2], [center[0] - width / 2, center[1] + depth / 2]];

describe('south family proposal geometry', () => {
  it('isolates prior south-ground edits and furniture while retaining their saved records', () => {
    const previous = defaultState();
    previous.buildings.south.stairLayout = 'straight'; previous.buildings.south.stairRotation = 180;
    previous.buildings.south.stairPosition = [.25, 10];
    previous.design.wallEdits['ground-wall-4-south'] = { a: [0, 18], b: [5, 18], deleted: false };
    const item = { id: 'previous-chair', unit: 'south' as const, floor: 'ground' as const, kind: 'chair' as const, source: 'added' as const,
      center: [3, 14] as Vec2, width: .5, depth: .5, height: .85, rotation: 0 };
    previous.design.addedFurniture.push(item);
    const before = JSON.stringify(previous), proposal = southFamilyProposal(previous);
    expect(proposal.design).toEqual(previous.design);
    expect(JSON.stringify(previous)).toBe(before);
    expect(resolveStairGeometry(proposal, 'south', 'ground')!.layout).toBe('u-shaped');
    expect(resolveStairGeometry(proposal, 'south', 'ground')!.rotation).toBe(0);
    expect(resolvedFurniture(proposal).some(furniture => furniture.id === item.id)).toBe(false);
    expect(resolvedWalls(proposal).find(wall => wall.id === 'south-family-ground-wall-4-south')!.a).toEqual([.22, 16.05]);
    const edited = applyCadCommand(proposal, { type: 'add-furniture', item: { ...item, id: 'new-family-chair' } });
    expect(resolvedFurniture(edited).some(furniture => furniture.id === 'new-family-chair')).toBe(true);
    expect(parseProject(serializeProject(edited))).toEqual(edited);
    delete edited.buildings.south.southLayout;
    expect(resolvedFurniture(edited).some(furniture => furniture.id === item.id)).toBe(true);
    expect(resolvedFurniture(edited).some(furniture => furniture.id === 'new-family-chair')).toBe(false);
  });

  it('switches only the south layout and round-trips edits without replacing the original catalog', () => {
    const original = defaultState(), state = defaultState();
    state.buildings.south.southLayout = 'family';
    expect(resolvedWalls(state).filter(wall => wall.unit === 'north')).toEqual(resolvedWalls(original).filter(wall => wall.unit === 'north'));
    expect(resolvedRooms(state).filter(room => room.unit === 'north')).toEqual(resolvedRooms(original).filter(room => room.unit === 'north'));
    expect(resolvedWalls(state).some(wall => wall.id === 'ground-wall-24-south')).toBe(false);
    expect(resolvedWalls(state).some(wall => wall.id === 'south-family-ground-wall-13-south')).toBe(false);
    expect(resolvedWalls(state).some(wall => wall.id === 'ground-wall-13-north')).toBe(true);
    expect(resolvedWalls(state).filter(wall => wall.unit === 'south' && wall.floor === 'first').every(wall => wall.id.startsWith('south-family-'))).toBe(true);
    expect(resolvedFootprint('first', 'south', state)).toEqual(SOUTH_FAMILY_FIRST_FOOTPRINT);
    expect(resolveStairGeometry(state, 'south', 'ground')!.pivot).toEqual(SOUTH_FAMILY_STAIR_POSITION);
    expect(resolveStairGeometry(state, 'north', 'ground')).toEqual(resolveStairGeometry(original, 'north', 'ground'));
    expect(resolvedFurniture(state).filter(item => item.unit === 'south' && item.floor === 'first' && item.kind === 'bed')).toHaveLength(3);
    expect(resolvedFurniture(state).some(item => item.kind === 'bathtub')).toBe(true);
    const room = resolvedRooms(state).find(item => item.id === 'south-family-master')!;
    const edited = applyCadCommand(state, { type: 'room', id: room.id, edit: { center: room.center, width: 3.6, depth: room.depth, deleted: false } });
    edited.design.wallEdits['south-family-ground-wall-13-south'] = { a: [9.49, 9.3], b: [11.67, 9.3], deleted: true };
    expect(parseProject(serializeProject(edited))).toEqual(edited);
    delete state.buildings.south.southLayout;
    expect(resolvedRooms(state)).toEqual(resolvedRooms(original));
    expect(resolvedWalls(state)).toEqual(resolvedWalls(original));
  });

  it('rejects unknown variants and assigning the south proposal to the north dwelling', () => {
    const state = defaultState();
    expect(() => parseProject(JSON.stringify({ ...state, buildings: { ...state.buildings, south: { ...state.buildings.south, southLayout: 'unknown' } } }))).toThrow();
    expect(() => parseProject(JSON.stringify({ ...state, buildings: { ...state.buildings, north: { ...state.buildings.north, southLayout: 'family' } } }))).toThrow();
  });

  it('provides three bedrooms, a private ensuite and a separate shared bathroom', () => {
    const rooms = SOUTH_FAMILY_ROOMS.filter(room => room.floor === 'first');
    expect(rooms.filter(room => room.kind === 'bedroom')).toHaveLength(3);
    expect(rooms.filter(room => room.kind === 'bath')).toHaveLength(2);
    expect(rooms.filter(room => room.name.includes('ילד'))).toHaveLength(2);
    expect(Math.max(...SOUTH_FAMILY_SUITE.map(point => point[0])) - Math.min(...SOUTH_FAMILY_SUITE.map(point => point[0]))).toBeCloseTo(5.9);
    expect(Math.max(...SOUTH_FAMILY_SUITE.map(point => point[1])) - Math.min(...SOUTH_FAMILY_SUITE.map(point => point[1]))).toBeCloseTo(3.65);
  });

  it('keeps every proposed room inside the stepped envelope without room overlaps', () => {
    const rooms = SOUTH_FAMILY_ROOMS.filter(room => room.floor === 'first');
    for (const [index, room] of rooms.entries()) {
      const ring = rectangle(room.center, room.width, room.depth);
      expect(polygonClipping.difference([ring], [SOUTH_FAMILY_FIRST_FOOTPRINT]), room.id).toEqual([]);
      for (const other of rooms.slice(index + 1)) {
        expect(polygonClipping.intersection([ring], [rectangle(other.center, other.width, other.depth)]), `${room.id}/${other.id}`).toEqual([]);
      }
    }
  });

  it('has individual bedroom and bathroom doors that fit inside their host walls', () => {
    const doors = SOUTH_FAMILY_FIRST_WALLS.flatMap(wall => wall.openings).filter(opening => opening.kind === 'door');
    for (const name of ['כניסה לסוויטת הורים', 'כניסה נפרדת לחדר ילד 1', 'כניסה נפרדת לחדר ילד 2', 'כניסה לרחצה כללית', 'כניסה לרחצה פרטית']) {
      expect(doors.some(door => door.label === name), name).toBe(true);
    }
    for (const wall of SOUTH_FAMILY_FIRST_WALLS) {
      const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
      for (const opening of wall.openings) {
        expect(opening.position * length - opening.width / 2, opening.id).toBeGreaterThanOrEqual(0);
        expect(opening.position * length + opening.width / 2, opening.id).toBeLessThanOrEqual(length);
      }
    }
  });
});