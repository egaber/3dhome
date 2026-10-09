import { describe, expect, it } from 'vitest';
import polygonClipping from 'polygon-clipping';
import { NORTH_BEDROOM_FIRST_FOOTPRINT, NORTH_BEDROOM_FURNITURE, NORTH_BEDROOM_ROOMS, NORTH_BEDROOM_SOUTH_FIRST_FOOTPRINT,
  NORTH_BEDROOM_WALLS, northBedroomProposal, northBedroomRoomFurniture } from './northBedroomLayout';
import { defaultState, resolvedFootprint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls } from './plans';
import { applyCadCommand, applyObjectCommand } from './cad';
import { parseProject, serializeProject } from '../lib/project';

describe('attached northern first-floor bedroom plan', () => {
  it('allocates the southeast bedroom wing to the north without overlapping the remaining southern floor', () => {
    expect(polygonClipping.intersection([NORTH_BEDROOM_FIRST_FOOTPRINT], [NORTH_BEDROOM_SOUTH_FIRST_FOOTPRINT])).toEqual([]);
    expect(NORTH_BEDROOM_FIRST_FOOTPRINT).toContainEqual([12.39, 9.24]);
  });

  it('models three bedrooms, three bathrooms, laundry and a 1.10m stair-side passage', () => {
    expect(NORTH_BEDROOM_ROOMS.filter(room => room.kind === 'bedroom')).toHaveLength(3);
    expect(NORTH_BEDROOM_ROOMS.filter(room => room.kind === 'bath')).toHaveLength(3);
    expect(NORTH_BEDROOM_ROOMS.find(room => room.id === 'north-bedrooms-master')).toMatchObject({ width: 6.25, depth: 3.80 });
    expect(NORTH_BEDROOM_ROOMS.find(room => room.id === 'north-bedrooms-stair-hall')?.width).toBe(1.10);
    expect(NORTH_BEDROOM_FURNITURE.filter(item => item.kind === 'washer-dryer')).toHaveLength(1);
  });

  it('keeps each seed owned by exactly one room and leaves the source furniture unchanged when rooms move', () => {
    const furniture = NORTH_BEDROOM_ROOMS.flatMap(northBedroomRoomFurniture);
    expect(new Set(furniture.map(item => item.id)).size).toBe(NORTH_BEDROOM_FURNITURE.length);
    expect(furniture).toHaveLength(NORTH_BEDROOM_FURNITURE.length);
    const source = structuredClone(NORTH_BEDROOM_FURNITURE);
    const room = NORTH_BEDROOM_ROOMS.find(item => item.id === 'north-bedrooms-west')!;
    const moved = northBedroomRoomFurniture({ ...room, center: [room.center[0] + 1, room.center[1]] });
    expect(moved.find(item => item.kind === 'bed')?.center[0]).toBeCloseTo(2.02);
    expect(NORTH_BEDROOM_FURNITURE).toEqual(source);
  });

  it('has unique, open, floor-aligned door apertures contained within their host walls', () => {
    const ids = NORTH_BEDROOM_WALLS.flatMap(wall => [wall.id, ...wall.openings.map(opening => opening.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const wall of NORTH_BEDROOM_WALLS) for (const opening of wall.openings) {
      const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
      expect(opening.position * length - opening.width / 2, opening.id).toBeGreaterThanOrEqual(0);
      expect(opening.position * length + opening.width / 2, opening.id).toBeLessThanOrEqual(length);
      if (opening.kind === 'door') expect(opening).toMatchObject({ open: true, sill: 0 });
    }
  });

  it('activates only the new northern first floor and preserves both ground floors, basements and saved edits', () => {
    const original = defaultState(), before = structuredClone(original), next = northBedroomProposal(original);
    expect(original).toEqual(before);
    expect(next.buildings.south).toBe(original.buildings.south);
    expect(next.design).toBe(original.design);
    const lowerFloor = (item: { floor: string }) => item.floor !== 'first';
    expect(resolvedWalls(next).filter(lowerFloor)).toEqual(resolvedWalls(original).filter(lowerFloor));
    expect(resolvedRooms(next).filter(lowerFloor)).toEqual(resolvedRooms(original).filter(lowerFloor));
    expect(resolvedFurniture(next).filter(lowerFloor)).toEqual(resolvedFurniture(original).filter(lowerFloor));
    expect(resolvedRooms(next).filter(room => room.unit === 'north' && room.floor === 'first')).toEqual(NORTH_BEDROOM_ROOMS);
    expect(resolvedRooms(next).some(room => room.id === 'b-bed-east')).toBe(false);
    expect(polygonClipping.intersection([resolvedFootprint('first', 'north', next)], [resolvedFootprint('first', 'south', next)])).toEqual([]);
    for (const wall of resolvedWalls(next).filter(item => item.unit === 'south' && item.floor === 'first')) {
      const midpoint = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];
      expect(midpoint[0] < 6.34 + 1e-6 || midpoint[1] >= 9.24 - 1e-6, wall.id).toBe(true);
    }
  });

  it('round-trips edits to new objects, hides them in the original variant and restores them when reselected', () => {
    const state = northBedroomProposal(defaultState());
    const changed = applyCadCommand(state, { type: 'furniture', id: 'north-bedrooms-master-bed', edit: { center: [10.4, 2.8], rotation: 180, deleted: false } });
    const restored = parseProject(serializeProject(changed));
    expect(restored).toEqual(changed);
    expect(resolvedFurniture(restored).find(item => item.id === 'north-bedrooms-master-bed')?.center).toEqual([10.4, 2.8]);
    restored.buildings.north.firstFloorVariant = 'original';
    expect(resolvedFurniture(restored).some(item => item.id.startsWith('north-bedrooms-'))).toBe(false);
    expect(resolvedWalls(restored)).toEqual(resolvedWalls(defaultState()));
    expect(resolvedFurniture(northBedroomProposal(restored)).find(item => item.id === 'north-bedrooms-master-bed')?.center).toEqual([10.4, 2.8]);
  });

  it('retains unrelated southern wall and opening identities and edits in both variants', () => {
    const original = defaultState();
    const wall = resolvedWalls(original).find(item => item.unit === 'south' && item.floor === 'first'
      && item.a[1] > 9.24 && item.b[1] > 9.24 && item.openings.length)!;
    expect(wall).toBeDefined();
    const edited = applyCadCommand(original, { type: 'wall', id: wall.id, edit: {
      a: [wall.a[0] + .1, wall.a[1]], b: [wall.b[0] + .1, wall.b[1]], deleted: false,
    } });
    edited.openings[wall.openings[0].id] = { width: .6 };
    const proposed = parseProject(serializeProject(northBedroomProposal(edited)));
    expect(resolvedWalls(proposed).find(item => item.id === wall.id)).toEqual(resolvedWalls(edited).find(item => item.id === wall.id));
    expect(resolvedOpenings(proposed).find(item => item.id === wall.openings[0].id)).toEqual(resolvedOpenings(edited).find(item => item.id === wall.openings[0].id));
    const walls = resolvedWalls(proposed);
    expect(new Set(walls.map(item => item.id)).size).toBe(walls.length);
  });

  it('rejects unknown variants and applying the northern drawing to the south', () => {
    const state = northBedroomProposal(defaultState());
    expect(() => parseProject(JSON.stringify({ ...state, buildings: { ...state.buildings, north: { ...state.buildings.north, firstFloorVariant: 'invalid' } } }))).toThrow();
    expect(() => parseProject(JSON.stringify({ ...state, buildings: { ...state.buildings, south: { ...state.buildings.south, firstFloorVariant: 'bedrooms' } } }))).toThrow();
  });

  it('keeps new and copied furniture scoped to this plan without losing it when changing variants', () => {
    const state = northBedroomProposal(defaultState());
    const item = { id: 'north-new-table', unit: 'north', floor: 'first', kind: 'dining-table', center: [9, 2], width: 1.3, depth: 1.3,
      height: .76, rotation: 0, source: 'added', shape: 'round' } as const;
    const changed = applyCadCommand(state, { type: 'add-furniture', item: { ...item, center: [...item.center] } });
    expect(changed.design.addedFurniture[0].layout).toBe('north-bedrooms');
    expect(parseProject(serializeProject(changed))).toEqual(changed);
    const copied = applyObjectCommand(changed, { type: 'duplicate-furniture', id: 'north-bedrooms-master-bed', newId: 'north-bedrooms-bed-copy' });
    expect(copied.design.addedFurniture.at(-1)).toMatchObject({ id: 'north-bedrooms-bed-copy', layout: 'north-bedrooms', kind: 'bed' });
    expect(parseProject(serializeProject(copied))).toEqual(copied);
    const original = { ...copied, buildings: { ...copied.buildings, north: { ...copied.buildings.north, firstFloorVariant: 'original' as const } } };
    expect(resolvedFurniture(original).some(furniture => furniture.id === item.id)).toBe(false);
    expect(resolvedFurniture(original).some(furniture => furniture.id === 'north-bedrooms-bed-copy')).toBe(false);
    expect(resolvedFurniture(northBedroomProposal(original)).some(furniture => furniture.id === item.id)).toBe(true);
    expect(resolvedFurniture(northBedroomProposal(original)).some(furniture => furniture.id === 'north-bedrooms-bed-copy')).toBe(true);
    expect(() => applyCadCommand(original, { type: 'add-furniture', item: { ...changed.design.addedFurniture[0], id: 'wrong-variant' } })).toThrow();
    expect(() => parseProject(JSON.stringify({ ...changed, design: { ...changed.design, addedFurniture: [{ ...changed.design.addedFurniture[0], unit: 'south' }] } }))).toThrow();
  });
});