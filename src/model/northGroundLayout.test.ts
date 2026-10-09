import { describe, expect, it } from 'vitest';
import polygonClipping from 'polygon-clipping';
import { defaultState, FOOTPRINTS, resolvedFootprint, resolvedFurniture, resolvedRooms, resolvedWalls } from './plans';
import { normalizeRotation } from './rotation';
import { applyCadCommand, applyObjectCommand, resolveStairGeometry, stairPartOrder } from './cad';
import { parseProject, serializeProject } from '../lib/project';
import { NORTH_GROUND_FOOTPRINT, NORTH_GROUND_FURNITURE, NORTH_GROUND_ROOMS, NORTH_GROUND_STAIR_HOLE,
  NORTH_GROUND_WALLS, northGroundProposal, northGroundRoomFurniture, northGroundStairProposal } from './northGroundLayout';

describe('attached northern ground-floor plan', () => {
  it('resolves only the selected ground-floor variant and preserves all other rooms and walls', () => {
    const before = defaultState(), next = northGroundProposal(before);
    const elsewhere = (item: { unit: string; floor: string }) => item.unit !== 'north' || item.floor !== 'ground';
    expect(resolvedRooms(next).filter(elsewhere)).toEqual(resolvedRooms(before).filter(elsewhere));
    expect(resolvedWalls(next).filter(elsewhere)).toEqual(resolvedWalls(before).filter(elsewhere));
    expect(resolvedFurniture(next).filter(elsewhere)).toEqual(resolvedFurniture(before).filter(elsewhere));
    expect(resolvedRooms(next).filter(item => !elsewhere(item))).toEqual(NORTH_GROUND_ROOMS);
    expect(resolvedWalls(next).filter(item => !elsewhere(item))).toEqual(NORTH_GROUND_WALLS);
    expect(resolvedFootprint('ground', 'north', next)).toEqual(NORTH_GROUND_FOOTPRINT);
    expect(resolvedRooms(before).some(item => item.id.startsWith('north-ground-'))).toBe(false);
  });

  it.each(['basement', 'ground', 'first'] as const)('resolves a right-hand ascent, southern U landing and left-hand return from %s', fromFloor => {
    const state = northGroundStairProposal(defaultState()); state.buildings.north.stairToRoof = true;
    const geometry = resolveStairGeometry(state, 'north', fromFloor)!;
    expect(geometry.riserCount).toBe(18);
    expect(geometry.parts.filter(part => part.kind === 'tread')).toHaveLength(16);
    expect(geometry.parts.filter(part => part.kind === 'landing')).toHaveLength(1);
    expect(geometry.parts.some(part => part.kind === 'entry-apron')).toBe(false);
    const parts = stairPartOrder(geometry).map(index => geometry.parts[index]);
    expect(parts[0].center[0]).toBeCloseTo(5.815, 6);
    expect(parts.at(-1)!.center[0]).toBeCloseTo(4.525, 6);
    expect(parts[1].center[1]).toBeGreaterThan(parts[0].center[1]);
    expect(parts.at(-1)!.center[1]).toBeLessThan(parts.at(-2)!.center[1]);
    expect(parts.find(part => part.kind === 'landing')!.center[1]).toBeCloseTo(6.19, 6);
    for (let index = 1; index < parts.length; index++) {
      expect(parts[index].bottom + parts[index].height - parts[index - 1].bottom - parts[index - 1].height).toBeCloseTo(geometry.rise / 18, 8);
    }
  });

  it('round-trips new object edits and restores them without dropping inactive original edits', () => {
    const state = northGroundStairProposal(defaultState());
    state.design.furnitureEdits['a-dining-table'] = { center: [5.1, 2.1], rotation: 15, deleted: false };
    const edited = applyCadCommand(state, { type: 'furniture', id: 'north-ground-dining-table', edit: { center: [5.2, 1.5], rotation: 0, deleted: false } });
    const restored = parseProject(serializeProject(edited));
    expect(restored).toEqual(edited);
    expect(resolvedFurniture(restored).find(item => item.id === 'north-ground-dining-table')?.center).toEqual([5.2, 1.5]);
    delete restored.buildings.north.northGroundLayout;
    expect(resolvedFurniture(restored).some(item => item.id.startsWith('north-ground-'))).toBe(false);
    expect(resolvedFurniture(restored).find(item => item.id === 'a-dining-table')?.center).toEqual([5.1, 2.1]);
    expect(resolvedFurniture(northGroundProposal(restored)).find(item => item.id === 'north-ground-dining-table')?.center).toEqual([5.2, 1.5]);
  });

  it('rejects unknown variants and applying the northern plan to the south, while old files remain unchanged', () => {
    const original = defaultState();
    expect(parseProject(serializeProject(original))).toEqual(original);
    for (const [unit, value] of [['north', 'unknown'], ['south', 'attached'], ['north', false]]) {
      const invalid = { ...original, buildings: { ...original.buildings, [unit as string]: { ...original.buildings.north, northGroundLayout: value } } };
      expect(() => parseProject(JSON.stringify(invalid))).toThrow();
    }
  });

  it('scopes added and copied furniture to the active ground plan and rejects foreign ownership', () => {
    const original = defaultState();
    const originalTable = { ...NORTH_GROUND_FURNITURE.find(item => item.kind === 'dining-table')!, id: 'original-table', source: 'added' as const };
    const withOriginal = applyCadCommand(original, { type: 'add-furniture', item: originalTable });
    const selected = northGroundProposal(withOriginal);
    const added = applyCadCommand(selected, { type: 'add-furniture', item: { ...originalTable, id: 'new-table' } });
    const copied = applyObjectCommand(added, { type: 'duplicate-furniture', id: 'north-ground-dining-table', newId: 'copied-table' });
    expect(copied.design.addedFurniture.slice(1).map(item => item.layout)).toEqual(['north-ground', 'north-ground']);
    expect(copied.design.addedFurniture.at(-1)?.shape).toBe('round');
    const restored = parseProject(serializeProject(copied));
    expect(restored).toEqual(copied);
    expect(resolvedFurniture(restored).some(item => item.id === 'original-table')).toBe(false);
    delete restored.buildings.north.northGroundLayout;
    expect(resolvedFurniture(restored).some(item => item.id === 'original-table')).toBe(true);
    expect(resolvedFurniture(restored).some(item => ['new-table', 'copied-table'].includes(item.id))).toBe(false);
    expect(resolvedFurniture(northGroundProposal(restored)).filter(item => ['new-table', 'copied-table'].includes(item.id))).toHaveLength(2);
    expect(() => applyCadCommand(original, { type: 'add-furniture', item: { ...copied.design.addedFurniture[1], id: 'inactive-table' } })).toThrow();
    for (const location of [{ unit: 'south' }, { floor: 'first' }, { floor: 'basement' }, { layout: 'unknown' }]) {
      const invalid = { ...copied, design: { ...copied.design, addedFurniture: [{ ...copied.design.addedFurniture[1], ...location }] } };
      expect(() => parseProject(JSON.stringify(invalid))).toThrow();
    }
  });

  it('keeps the existing unit boundary and does not allocate any southern floor to the north', () => {
    expect(polygonClipping.intersection([NORTH_GROUND_FOOTPRINT], [FOOTPRINTS.ground.south])).toEqual([]);
    expect(polygonClipping.difference([NORTH_GROUND_STAIR_HOLE], [NORTH_GROUND_FOOTPRINT])).toEqual([]);
  });

  it('places a 1.30m round table, western 1.10 by 2.65m island and eastern L seating around the stair core', () => {
    const table = NORTH_GROUND_FURNITURE.find(item => item.id === 'north-ground-dining-table')!;
    const island = NORTH_GROUND_FURNITURE.find(item => item.kind === 'kitchen-island')!;
    expect(table).toMatchObject({ shape: 'round', width: 1.30, depth: 1.30 });
    expect(island).toMatchObject({ center: [2.50, 3.53], width: 1.10, depth: 2.65 });
    expect(NORTH_GROUND_FURNITURE.filter(item => item.kind === 'sofa')).toHaveLength(2);
    expect(NORTH_GROUND_FURNITURE.filter(item => item.kind === 'armchair')).toHaveLength(2);
    expect(NORTH_GROUND_FURNITURE.find(item => item.kind === 'cooktop')?.center[0]).toBe(island.center[0]);
    expect(island.center[0] + island.width / 2 + .95).toBeCloseTo(NORTH_GROUND_STAIR_HOLE[0][0]);
  });

  it('keeps every object stable and owned by exactly one room', () => {
    const objects = NORTH_GROUND_ROOMS.flatMap(northGroundRoomFurniture);
    expect(objects.map(item => item.id)).toEqual(NORTH_GROUND_FURNITURE.map(item => item.id));
    objects.forEach((item, index) => {
      const source = NORTH_GROUND_FURNITURE[index];
      expect(item).toEqual({ ...source, center: item.center, rotation: normalizeRotation(source.rotation) });
      expect(item.center[0]).toBeCloseTo(source.center[0], 10);
      expect(item.center[1]).toBeCloseTo(source.center[1], 10);
    });
    const ids = [...objects, ...NORTH_GROUND_ROOMS, ...NORTH_GROUND_WALLS, ...NORTH_GROUND_WALLS.flatMap(wall => wall.openings)].map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const wall of NORTH_GROUND_WALLS) for (const opening of wall.openings) {
      const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
      expect(opening.position * length - opening.width / 2).toBeGreaterThanOrEqual(0);
      expect(opening.position * length + opening.width / 2).toBeLessThanOrEqual(length);
    }
  });

  it('separates selecting the floor plan from explicitly resetting its stair placement', () => {
    const original = defaultState(); original.buildings.north.stairToRoof = true;
    const before = structuredClone(original), next = northGroundProposal(original);
    expect(original).toEqual(before);
    expect(next.design).toBe(original.design);
    expect(next.buildings.south).toBe(original.buildings.south);
    expect(next.buildings.north).toEqual({ ...original.buildings.north, northGroundLayout: 'attached' });
    const stairs = northGroundStairProposal(next);
    expect(stairs.buildings.north).toMatchObject({ stairLayout: 'u-shaped', stairPosition: [5.17, 5.19], stairRotation: 180, stairScale: 1, stairToRoof: true });
    expect(stairs.buildings.north.firstFloorVariant).toBe(original.buildings.north.firstFloorVariant);
    expect(stairs.buildings.south).toBe(original.buildings.south);
  });
});