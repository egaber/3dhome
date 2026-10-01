import { describe, expect, it, vi } from 'vitest';
import { normalizeApertures } from '../lib/wallGeometry';
import { parseProject, serializeProject } from '../lib/project';
import { createHistory, historyReducer, HISTORY_LIMIT } from '../lib/actionHistory';
import { applyCadCommand, getFloorLevels, getWallApertures, inversePlanPoint, measureBetween, modelWorldPoint, resolveStairGeometry, type CadCommand } from './cad';
import { BASE_DEPTH, BASE_FURNITURE, BASE_OPENINGS, BASE_WIDTH, EDITABLE_OPENINGS, EDITABLE_WALLS, PARTY_Z, ROOMS, STAIR_HOLES, WALLS,
  defaultState, floorElevation, planPoint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls, wallHeight, wallScale } from './plans';
import { furnitureParts } from './furnitureParts';
import { FURNITURE_KINDS, type FurnitureSpec } from './types';

const units = ['north', 'south'] as const;
const layouts = ['straight', 'u-shaped'] as const;
const item = (): FurnitureSpec => ({ id: 'added-armchair', unit: 'north', floor: 'ground', kind: 'armchair',
  center: [4, 2], width: .9, depth: .85, height: .8, rotation: 0, source: 'added' });
function freeze(value: object) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); Object.freeze(value); }

describe('CAD coordinates and nominal floor heights', () => {
  it.each(units)('inverts translated rotated anisotropic %s coordinates without north rotation', unit => {
    const state = defaultState();
    Object.assign(state.buildings[unit], { width: BASE_WIDTH * 1.3, depth: BASE_DEPTH[unit] * .6, rotation: 37, x: -11, z: 13 });
    state.northBearing = -71;
    for (const p of [[0, PARTY_Z], [12, -3], [-2, 18]] as [number, number][]) {
      const result = inversePlanPoint(planPoint(p, unit, state), unit, state);
      expect(result[0]).toBeCloseTo(p[0], 10); expect(result[1]).toBeCloseTo(p[1], 10);
    }
    const snapped = inversePlanPoint([1.25, 2.5], unit, state);
    const displayed = planPoint(snapped, unit, state);
    expect(displayed[0]).toBeCloseTo(1.25); expect(displayed[1]).toBeCloseTo(2.5);
  });
  it('measures full world XYZ and scaling but not camera/view or rigid transforms', () => {
    const state = defaultState();
    const measure = () => measureBetween(modelWorldPoint([1, 2], -2, 'north', state), modelWorldPoint([4, 6], 10, 'north', state));
    expect(measure()!.distance).toBeCloseTo(13, 12);
    expect(measure()!.horizontal).toBeCloseTo(5, 12);
    expect(measure()!.vertical).toBe(12);
    state.view.mode = 'walk'; state.northBearing = 125;
    Object.assign(state.buildings.north, { rotation: -55, x: 19, z: -14 });
    expect(measure()!.distance).toBeCloseTo(13);
    state.buildings.north.width *= 1.2; state.buildings.north.depth *= .8;
    expect(measure()!.horizontal).toBeCloseTo(Math.hypot(3.6, 3.2));
    expect(measure()!.vertical).toBe(12);
    expect(measureBetween([1, 2, 3], [1, 2, 3])).toEqual({ distance: 0, horizontal: 0, vertical: 0 });
    expect(measureBetween([0, NaN, 0], [0, 0, 0])).toBeNull();
    expect(measureBetween([0, 0, Infinity], [0, 0, 0])).toBeNull();
    expect(measureBetween([-Number.MAX_VALUE, 0, 0], [Number.MAX_VALUE, 0, 0])).toBeNull();
    expect(() => modelWorldPoint([NaN, 2], 0, 'north', state)).toThrow();
    state.buildings.north.width = 0;
    expect(() => inversePlanPoint([1, 2], 'north', state)).toThrow();
  });
  it.each(units)('returns basement/ground/first clear heights and availability for %s', unit => {
    const b = defaultState().buildings[unit];
    for (const [floor, elevation, storeyHeight, clearHeight] of [['basement', -2.95, 2.95, 2.71], ['ground', 0, 3.4, 3.16], ['first', 3.4, 3.1, 2.86]] as const) {
      const levels = getFloorLevels(floor, b)!;
      expect(levels.elevation).toBe(elevation); expect(levels.storeyHeight).toBe(storeyHeight);
      expect(levels.clearHeight).toBeCloseTo(clearHeight); expect(levels.ceilingElevation).toBeCloseTo(elevation + clearHeight);
      b.roofEnabled = false; expect(getFloorLevels(floor, b)).toEqual(levels);
    }
    b.storeys = 1; expect(getFloorLevels('first', b)).toBeNull(); expect(getFloorLevels('ground', b)).not.toBeNull();
    b.enabled = false; expect(getFloorLevels('basement', b)).toBeNull();
    b.enabled = true; b.groundHeight = NaN; expect(getFloorLevels('ground', b)).toBeNull();
  });
});

describe('single-source stair geometry', () => {
  for (const unit of units) for (const layout of layouts) for (const from of ['basement', 'ground'] as const) {
    it(`${unit} ${layout} ${from}: 18 rises, landing, footprint and final destination`, () => {
      const state = defaultState(); state.buildings[unit].stairLayout = layout;
      const stair = resolveStairGeometry(state, unit, from)!;
      const treads = stair.parts.filter(p => p.kind === 'tread'), landing = stair.parts.find(p => p.kind === 'landing');
      expect(treads).toHaveLength(18);
      expect(stair.rise).toBeCloseTo(from === 'basement' ? 2.95 : 3.4);
      expect(treads.at(-1)!.bottom + .1).toBeCloseTo(floorElevation(stair.toFloor, state.buildings[unit]));
      const seed = STAIR_HOLES[unit], width = (seed[1][0] - seed[0][0] - .13) / 2, tread = (seed[2][1] - seed[0][1] - .72) / 9;
      expect(treads[0].width).toBeCloseTo(width); expect(treads[0].depth).toBeCloseTo(tread);
      expect(treads[0].center[1] + tread / 2).toBeCloseTo(seed[2][1] - .1);
      if (layout === 'u-shaped') {
        expect(stair.footprint).toEqual(seed); expect(stair.footprint).not.toBe(seed);
        expect(landing!.bottom + landing!.height).toBeCloseTo(floorElevation(from, state.buildings[unit]) + stair.rise / 2);
        expect(treads[8].center[1]).toBeLessThan(treads[0].center[1]);
        expect(treads[17].center[1]).toBeGreaterThan(treads[9].center[1]);
      } else {
        expect(landing).toBeUndefined();
        expect(stair.footprint[2][1] - stair.footprint[0][1]).toBeCloseTo(tread * 18);
        expect(stair.footprint[2][1] - stair.footprint[0][1]).toBeGreaterThan(seed[2][1] - seed[0][1]);
      }
      const xs = stair.footprint.map(p => p[0]), zs = stair.footprint.map(p => p[1]);
      for (const p of stair.parts) {
        expect(p.center[0] - p.width / 2).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
        expect(p.center[0] + p.width / 2).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
        expect(p.center[1] - p.depth / 2).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-9);
        expect(p.center[1] + p.depth / 2).toBeLessThanOrEqual(Math.max(...zs) + 1e-9);
      }
    });
  }
  it('changes only one unit, uses edited storey rises, and refuses unavailable runs', () => {
    const state = defaultState(), south = resolveStairGeometry(state, 'south', 'ground');
    const next = applyCadCommand(state, { type: 'stair', unit: 'north', layout: 'straight' });
    expect(next.design).toBe(state.design); expect(next.buildings.south).toBe(state.buildings.south);
    expect(resolveStairGeometry(next, 'south', 'ground')).toEqual(south);
    next.buildings.north.groundHeight = 4.4;
    expect(resolveStairGeometry(next, 'north', 'ground')!.rise).toBe(4.4);
    next.buildings.north.storeys = 1;
    expect(resolveStairGeometry(next, 'north', 'ground')).toBeNull();
    expect(resolveStairGeometry(next, 'north', 'basement')).not.toBeNull();
    next.buildings.north.enabled = false;
    expect(resolveStairGeometry(next, 'north', 'basement')).toBeNull();
    expect(resolveStairGeometry(state, 'north', 'roof' as 'ground')).toBeNull();
  });
});

describe('canonical variants and wall apertures', () => {
  it('retains source identities, isolates variant edits and hides original room annotations', () => {
    const source = structuredClone(WALLS), openings = structuredClone(BASE_OPENINGS);
    const state = defaultState(), original = WALLS.find(w => w.unit === 'north' && w.floor === 'first')!;
    const concept = EDITABLE_WALLS.find(w => w.provenance === 'concept')!;
    state.design.wallEdits[original.id] = { a: [1, 1], b: [2, 3], deleted: false };
    state.design.wallEdits[concept.id] = { a: [3, 1], b: [3, 5], deleted: false };
    expect(resolvedWalls(state).find(w => w.id === original.id)!.a).toEqual([1, 1]);
    expect(resolvedWalls(state).some(w => w.id === concept.id)).toBe(false);
    state.buildings.north.firstFloorVariant = 'open-plan';
    expect(resolvedWalls(state).some(w => w.id === original.id)).toBe(false);
    expect(resolvedWalls(state).find(w => w.id === concept.id)!.a).toEqual([3, 1]);
    expect(resolvedRooms(state).some(r => r.unit === 'north' && r.floor === 'first')).toBe(false);
    expect(resolvedOpenings(state).filter(o => o.unit === 'north' && o.floor === 'first')).toHaveLength(4);
    expect(WALLS).toEqual(source); expect(BASE_OPENINGS).toEqual(openings);
    expect(new Set(EDITABLE_WALLS.map(w => w.id)).size).toBe(EDITABLE_WALLS.length);
    expect(new Set(EDITABLE_OPENINGS.map(o => o.id)).size).toBe(EDITABLE_OPENINGS.length);
  });
  it('uses moved endpoints, normalized union apertures, source scale and world manual widths', () => {
    let state = defaultState(); const wall = WALLS[0];
    state = applyCadCommand(state, { type: 'wall', id: wall.id, edit: { a: [1, 1], b: [4, 5], deleted: false } });
    Object.assign(state.buildings[wall.unit], { width: BASE_WIDTH * 1.2, depth: BASE_DEPTH[wall.unit] * .8, rotation: 47 });
    const moved = resolvedWalls(state).find(w => w.id === wall.id)!;
    const first = wall.openings[0];
    state = applyCadCommand(state, { type: 'opening', id: first.id, patch: { width: 45, height: 6, sill: .5, position: 1 } });
    const effective = getWallApertures(moved, state);
    expect(effective).toEqual(normalizeApertures(5, wallHeight(moved, state.buildings[wall.unit]), resolvedOpenings(state).filter(o => o.wallId === wall.id).map(o => ({ id: o.id, center: o.position * 5, width: o.width / wallScale(moved, state), height: o.height, sill: o.sill }))));
    expect(effective[0].width).toBe(5); expect(effective[0].center).toBe(2.5);
    state = applyCadCommand(state, { type: 'delete-opening', id: first.id });
    expect(getWallApertures(moved, state).some(a => a.id === first.id)).toBe(false);
    state = applyCadCommand(state, { type: 'wall', id: wall.id, edit: { a: moved.a, b: moved.b, deleted: true } });
    expect(getWallApertures(moved, state)).toEqual([]); expect(resolvedOpenings(state).some(o => o.wallId === wall.id)).toBe(false);
    expect(state.openings[first.id]).toMatchObject({ width: 0, height: 0 });
  });
});

describe('independent shared furniture and detail geometry', () => {
  it('follows room centers and kitchen dimensions only until a selected item override', () => {
    let state = defaultState(); const room = ROOMS.find(r => r.kind === 'kitchen')!;
    const before = resolvedFurniture(state), sink = before.find(i => i.id === `${room.id}-sink`)!;
    state = applyCadCommand(state, { type: 'furniture', id: sink.id, edit: { center: [8, 4], rotation: 30, width: 1, depth: .8, height: 1, deleted: false } });
    expect(state.design.roomEdits).toEqual({});
    expect(resolvedFurniture(state).filter(i => i.id !== sink.id)).toEqual(before.filter(i => i.id !== sink.id));
    state = applyCadCommand(state, { type: 'room', id: room.id, edit: { center: [room.center[0] + 2, room.center[1] + 1], width: 5, depth: 2, deleted: false } });
    expect(resolvedFurniture(state).find(i => i.id === sink.id)).toMatchObject({ center: [8, 4], rotation: 30, width: 1, depth: .8, height: 1 });
    expect(resolvedFurniture(state).find(i => i.id === `${room.id}-run`)!.depth).toBeCloseTo(1.74);
    state = applyCadCommand(state, { type: 'room', id: room.id, edit: { ...state.design.roomEdits[room.id], deleted: true } });
    expect(resolvedFurniture(state).some(i => i.id === sink.id)).toBe(false);
    state = applyCadCommand(state, { type: 'room', id: room.id, edit: { ...state.design.roomEdits[room.id], deleted: false } });
    expect(resolvedFurniture(state).find(i => i.id === sink.id)!.center).toEqual([8, 4]);
  });
  it('retains individual dining chair IDs, variant overrides and independent added furniture', () => {
    const state = defaultState();
    expect(BASE_FURNITURE.filter(i => i.id.startsWith('a-dining-chair'))).toHaveLength(4);
    expect(BASE_FURNITURE.some(i => i.kind === 'armchair')).toBe(false);
    expect(new Set(BASE_FURNITURE.map(i => i.id)).size).toBe(BASE_FURNITURE.length);
    const original = resolvedFurniture(state).filter(i => i.unit === 'north' && i.floor === 'first');
    state.buildings.north.firstFloorVariant = 'open-plan';
    let next = applyCadCommand(state, { type: 'furniture', id: 'concept-first-north-sofa-west', edit: { center: [6, 4], rotation: -20, deleted: false } });
    next = applyCadCommand(next, { type: 'add-furniture', item: item() });
    next.buildings.north.firstFloorVariant = 'original';
    expect(resolvedFurniture(next).filter(i => i.unit === 'north' && i.floor === 'first')).toEqual(original);
    next.buildings.north.firstFloorVariant = 'open-plan';
    expect(resolvedFurniture(next).find(i => i.id === 'concept-first-north-sofa-west')!.center).toEqual([6, 4]);
    expect(resolvedFurniture(next).find(i => i.id === item().id)).toEqual(item());
    next.buildings.north.enabled = false; expect(resolvedFurniture(next).some(i => i.unit === 'north')).toBe(false);
  });
  it.each(FURNITURE_KINDS)('provides detailed bounded shared parts for %s at arbitrary dimensions', kind => {
    const spec = { ...item(), kind, width: 1.3, depth: 2.1, height: 1.2 };
    const parts = furnitureParts(spec); expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.width).toBeGreaterThan(0); expect(p.depth).toBeGreaterThan(0); expect(p.height).toBeGreaterThan(0);
      expect(Math.abs(p.center[0]) + p.width / 2).toBeLessThanOrEqual(spec.width / 2 + 1e-9);
      expect(Math.abs(p.center[1]) + p.depth / 2).toBeLessThanOrEqual(spec.depth / 2 + 1e-9);
      expect(p.bottom).toBeGreaterThanOrEqual(0); expect(p.bottom + p.height).toBeLessThanOrEqual(spec.height + 1e-9);
    }
    expect(() => furnitureParts({ ...spec, width: NaN })).toThrow();
  });
});

describe('atomic CAD commands and parser-compatible limits', () => {
  it('returns original state for effective no-ops, without inserting overrides', () => {
    const state = defaultState(), wall = WALLS[0], room = ROOMS[0], furniture = resolvedFurniture(state)[0];
    const commands: CadCommand[] = [
      { type: 'wall', id: wall.id, edit: { a: wall.a, b: wall.b, deleted: false } },
      { type: 'room', id: room.id, edit: { center: room.center, width: room.width, depth: room.depth, deleted: false } },
      { type: 'furniture', id: furniture.id, edit: { center: furniture.center, rotation: furniture.rotation, deleted: false, width: furniture.width } },
      { type: 'stair', unit: 'north', layout: 'u-shaped' }, { type: 'opening', id: BASE_OPENINGS[0].id, patch: {} },
    ];
    freeze(state); for (const command of commands) expect(applyCadCommand(state, command)).toBe(state);
  });
  it('treats reordered existing edit properties as unchanged', () => {
    const state = defaultState(), wall = WALLS[0];
    state.design.wallEdits[wall.id] = { deleted: false, b: [4, 4], a: [1, 1] };
    expect(applyCadCommand(state, { type: 'wall', id: wall.id, edit: { a: [1, 1], b: [4, 4], deleted: false } })).toBe(state);
  });
  it('supports discarded local previews and one release commit in the unchanged 100-action whole-project history', () => {
    const state = defaultState(); let history = createHistory(state), preview = state;
    const wall = WALLS[0];
    for (let x = 1; x <= 10; x++) preview = applyCadCommand(state, { type: 'wall', id: wall.id, edit: { a: [x, 1], b: [x + 1, 3], deleted: false } });
    expect(history.present).toBe(state); expect(history.entries).toHaveLength(1); // Dropping preview is a cancellation.
    history = historyReducer(history, { type: 'change', update: preview });
    expect(history.entries).toHaveLength(2); expect(history.present).toBe(preview);
    history = historyReducer(history, { type: 'undo' }); expect(history.present).toBe(state);
    history = historyReducer(history, { type: 'redo' }); expect(history.present).toBe(preview);
    history = historyReducer(history, { type: 'change', update: { ...history.present, minutes: 600 } });
    history = historyReducer(history, { type: 'change', update: applyCadCommand(history.present, { type: 'stair', unit: 'south', layout: 'straight' }) });
    history = historyReducer(history, { type: 'undo' }); expect(history.present.minutes).toBe(600);
    history = historyReducer(history, { type: 'undo' }); expect(history.present.minutes).toBe(state.minutes);
    for (let i = 0; i < 105; i++) history = historyReducer(history, { type: 'change', update: applyCadCommand(history.present, { type: 'stair', unit: 'north', layout: i % 2 ? 'u-shaped' : 'straight' }) });
    expect(HISTORY_LIMIT).toBe(100); expect(history.entries).toHaveLength(101);
    const imported = parseProject(serializeProject(state));
    history = historyReducer(history, { type: 'change', update: imported, label: 'ייבוא' });
    expect(history.entries).toHaveLength(101); expect(history.present).toEqual(imported);
    history = historyReducer(history, { type: 'undo' }); expect(history.present.design).toEqual(preview.design);
  });
  it('copies input commands, retains unrelated domains and round-trips every successful command', () => {
    const state = defaultState(), before = structuredClone(state); freeze(state);
    const added = item();
    let next = applyCadCommand(state, { type: 'add-furniture', item: added });
    added.center[0] = 99;
    expect(next.design.addedFurniture[0].center[0]).toBe(4);
    next = applyCadCommand(next, { type: 'add-window', id: 'new-window', wallId: WALLS[0].id, position: .5 });
    expect(next.addedOpenings[0]).toMatchObject({ width: 1.2, height: 1.35, sill: .95 });
    next = applyCadCommand(next, { type: 'delete-opening', id: 'new-window' });
    expect(next.openings['new-window']).toEqual({ width: 0, height: 0 });
    expect(applyCadCommand(next, { type: 'delete-opening', id: 'new-window' })).toBe(next);
    expect(next.reference).toBe(state.reference); expect(next.view).toBe(state.view); expect(next.neighbors).toBe(state.neighbors);
    expect(state).toEqual(before); expect(parseProject(serializeProject(next))).toEqual(next);
    expect(getWallApertures(resolvedWalls(next)[0], parseProject(serializeProject(next))).some(a => a.id === 'new-window')).toBe(false);
  });
  it.each([
    { type: 'wall', id: WALLS[0].id, edit: { a: [0, 0], b: [.01, 0], deleted: true } },
    { type: 'wall', id: 'missing', edit: { a: [0, 0], b: [1, 0], deleted: false } },
    { type: 'room', id: ROOMS[0].id, edit: { center: [0, 101], width: 2, depth: 2, deleted: false } },
    { type: 'opening', id: BASE_OPENINGS[0].id, patch: { wallId: WALLS[1].id } },
    { type: 'opening', id: BASE_OPENINGS[0].id, patch: { width: NaN } },
    { type: 'opening', id: BASE_OPENINGS[0].id, patch: { kind: 'unknown' } },
    { type: 'delete-opening', id: 'missing' },
    { type: 'add-window', id: BASE_OPENINGS[0].id, wallId: WALLS[0].id, position: .5 },
    { type: 'add-window', id: 'constructor', wallId: WALLS[0].id, position: .5 },
    { type: 'add-window', id: 'window', wallId: WALLS[0].id, position: 1.1 },
    { type: 'furniture', id: 'missing', edit: { center: [0, 0], rotation: 0, deleted: false } },
    { type: 'furniture', id: BASE_FURNITURE[0].id, edit: { center: [0, 0], rotation: 181, deleted: false } },
    { type: 'add-furniture', item: { ...item(), id: BASE_FURNITURE[0].id } },
    { type: 'add-furniture', item: { ...item(), source: 'plan' } },
    { type: 'add-furniture', item: { ...item(), width: 10.1 } },
    { type: 'stair', unit: 'east', layout: 'straight' }, { type: 'stair', unit: 'north', layout: 'spiral' },
    { type: 'other' },
  ])('rejects the complete invalid command atomically: %j', command => {
    const state = defaultState(), before = structuredClone(state); freeze(state);
    expect(() => applyCadCommand(state, command as CadCommand)).toThrow(/[א-ת]/); expect(state).toEqual(before);
  });
  it('rejects accessors/prototypes/unknown fields without executing user code', () => {
    const state = defaultState(), get = vi.fn(() => 'wall');
    const command = Object.defineProperty({}, 'type', { get });
    expect(() => applyCadCommand(state, command as CadCommand)).toThrow(); expect(get).not.toHaveBeenCalled();
    const poisoned = JSON.parse('{"type":"stair","unit":"north","layout":"straight","__proto__":{}}');
    expect(() => applyCadCommand(state, poisoned)).toThrow();
    expect(() => applyCadCommand(state, Object.assign(Object.create({}), { type: 'stair', unit: 'north', layout: 'straight' }))).toThrow();
    const edit = Object.defineProperty({ center: [1, 2], deleted: false }, 'rotation', { get });
    expect(() => applyCadCommand(state, { type: 'furniture', id: BASE_FURNITURE[0].id, edit } as CadCommand)).toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects deleted/inactive/disabled hosts, nonfitting windows, collisions and bounded additions', () => {
    let state = defaultState(); const wall = WALLS[0];
    state.design.wallEdits[wall.id] = { a: wall.a, b: wall.b, deleted: true };
    expect(() => applyCadCommand(state, { type: 'add-window', id: 'new', wallId: wall.id, position: .5 })).toThrow();
    const concept = EDITABLE_WALLS.find(w => w.provenance === 'concept')!;
    expect(() => applyCadCommand(state, { type: 'add-window', id: 'new', wallId: concept.id, position: .5 })).toThrow();
    state.buildings.north.enabled = false;
    expect(() => applyCadCommand(state, { type: 'add-furniture', item: item() })).toThrow();
    state = defaultState(); state.buildings.north.basementDepth = 1;
    const low = WALLS.find(w => w.unit === 'north' && w.floor === 'basement' && !w.retaining)!;
    expect(() => applyCadCommand(state, { type: 'add-window', id: 'new', wallId: low.id, position: .5 })).toThrow();
    state = defaultState(); state.design.addedFurniture = Array.from({ length: 200 }, (_, i) => ({ ...item(), id: `f-${i}` }));
    expect(() => applyCadCommand(state, { type: 'add-furniture', item: item() })).toThrow();
    state = applyCadCommand(defaultState(), { type: 'add-furniture', item: item() });
    expect(() => applyCadCommand(state, { type: 'add-furniture', item: item() })).toThrow();
    state.addedOpenings = Array.from({ length: 200 }, (_, i) => ({ ...BASE_OPENINGS[0], source: 'added', id: `w-${i}` }));
    expect(() => applyCadCommand(state, { type: 'add-window', id: 'new', wallId: wall.id, position: .5 })).toThrow();
  });
});