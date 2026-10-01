import { describe, expect, it, vi } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { rotationCommand, rotationInfo, rotationShortcut } from './cadRotation';
import { dragCommand } from './cadEditor';
import { createHistory, historyReducer } from './actionHistory';
import { parseProject, serializeProject } from './project';
import { applyCadCommand, modelWorldPoint, resolveStairGeometry } from '../model/cad';
import { defaultState, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls, SLAB } from '../model/plans';
import { normalizeRotation, rotatePlanPoint } from '../model/rotation';
import type { CadSelection } from './cadEditor';
import type { SimulationState, Vec2 } from '../model/types';
import { buildArchitecture, disposeArchitecture, roomSamplePoints, type Palette } from '../scene/architecture';

const selections: CadSelection[] = [
  { type: 'wall', id: 'ground-wall-2-north' },
  { type: 'furniture', id: 'a-living-sofa' },
  { type: 'room', id: 'a-living' },
  { type: 'stair', id: 'stair-north-ground' },
];
const rotate = (state: SimulationState, selection: CadSelection, angle: number) => {
  const command = rotationCommand(state, selection, angle);
  return command ? applyCadCommand(state, command) : state;
};
const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };
const closePoint = (a: Vec2, b: Vec2) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-9);

describe('shared CAD rotation commands', () => {
  it.each(selections)('rotates $type once, persists, and is fully undoable without mutating the input', selection => {
    const initial = defaultState(), before = structuredClone(initial);
    const next = rotate(initial, selection, 35);
    expect(rotationInfo(next, selection)!.angle).toBeCloseTo(35);
    expect(initial).toEqual(before);
    expect(next.buildings.south).toBe(initial.buildings.south);
    expect(parseProject(serializeProject(next))).toEqual(next);
    let history = createHistory(initial);
    history = historyReducer(history, { type: 'change', update: next, label: 'סיבוב' });
    expect(history.entries).toHaveLength(2);
    expect(historyReducer(history, { type: 'undo' }).present).toEqual(initial);
    expect(historyReducer(historyReducer(history, { type: 'undo' }), { type: 'redo' }).present).toEqual(next);
    expect(rotate(next, selection, 35)).toBe(next);
  });

  it('keeps wall midpoint, local length and hosted openings, including under anisotropic dwelling transforms', () => {
    const state = defaultState(); Object.assign(state.buildings.north, { width: 16, depth: 5, rotation: 37 });
    const wall = resolvedWalls(state).find(w => w.unit === 'north' && w.floor === 'ground' && w.openings.length > 0)!;
    const selection: CadSelection = { type: 'wall', id: wall.id };
    const before = rotationInfo(state, selection)!;
    const next = rotate(state, selection, -32);
    const rotated = resolvedWalls(next).find(w => w.id === wall.id)!;
    closePoint(rotationInfo(next, selection)!.pivot, before.pivot);
    expect(Math.hypot(rotated.b[0] - rotated.a[0], rotated.b[1] - rotated.a[1])).toBeCloseTo(Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]), 9);
    expect(next.addedOpenings).toBe(state.addedOpenings); expect(next.openings).toBe(state.openings);
    expect(resolvedWalls(next).filter(w => w.id !== wall.id)).toEqual(resolvedWalls(state).filter(w => w.id !== wall.id));
    const opening = resolvedOpenings(state).find(o => o.wallId === wall.id)!;
    const viaOpening = rotate(state, { type: 'opening', id: opening.id }, -32);
    expect(viaOpening).toEqual(next);
    expect(resolvedOpenings(next).find(o => o.id === opening.id)).toMatchObject({ wallId: wall.id, position: opening.position });
  });

  it('wraps at 180 degrees and leaves whole-turn equivalents unchanged', () => {
    expect(normalizeRotation(195)).toBe(-165); expect(normalizeRotation(-195)).toBe(165);
    const next = rotate(defaultState(), selections[1], -180);
    expect(rotate(next, selections[1], 180)).toBe(next);
  });

  it.each(selections)('rejects invalid $type angles and inactive selections without mutation', selection => {
    const state = defaultState(), before = structuredClone(state);
    for (const bad of [NaN, Infinity, -Infinity, 181, -181, undefined, null, '90']) {
      expect(() => rotate(state, selection, bad as number)).toThrow();
    }
    expect(state).toEqual(before);
    state.buildings.north.enabled = false;
    expect(() => rotate(state, selection, 45)).toThrow();
    expect(() => rotate(defaultState(), { ...selection, id: 'missing' }, 45)).toThrow();
  });

  it('room rotation moves only inherited furniture and preserves independently edited objects', () => {
    let state = defaultState(); const before = resolvedFurniture(state);
    const sofa = before.find(i => i.id === 'a-living-sofa')!;
    state = applyCadCommand(state, { type: 'furniture', id: sofa.id, edit: { center: [6, 4], rotation: 12, width: 2.5, deleted: false } });
    const next = rotate(state, selections[2], 90), room = resolvedRooms(next).find(r => r.id === 'a-living')!;
    expect(resolvedFurniture(next).find(i => i.id === sofa.id)).toMatchObject({ center: [6, 4], rotation: 12, width: 2.5 });
    const oldTable = before.find(i => i.id === 'a-living-coffee-table')!, table = resolvedFurniture(next).find(i => i.id === oldTable.id)!;
    closePoint(table.center, rotatePlanPoint(oldTable.center, room.center, 90)); expect(table.rotation).toBe(90);
    expect(next.design.wallEdits).toBe(state.design.wallEdits);
    expect(resolvedFurniture(next).filter(i => !i.id.startsWith('a-living-'))).toEqual(before.filter(i => !i.id.startsWith('a-living-')));
    const drag = dragCommand(next, selections[2], [0, 0], [1, 0], false)!;
    expect(applyCadCommand(next, drag).design.roomEdits['a-living'].rotation).toBe(90);
    const samples = roomSamplePoints(room, next);
    const first = rotatePlanPoint([room.center[0] - .28 * room.width, room.center[1] - .28 * room.depth], room.center, 90);
    expect(samples[0].distanceTo(new Vector3(...modelWorldPoint(first, .08, room.unit, next)))).toBeLessThan(1e-8);
  });

  it('retains furniture size overrides and does not freeze inherited sizes when only rotating', () => {
    const state = defaultState(); state.design.furnitureEdits['a-living-sofa'] = { center: [7, 4], rotation: 0, width: 3, deleted: false };
    const next = rotate(state, selections[1], 45);
    expect(next.design.furnitureEdits['a-living-sofa']).toEqual({ center: [7, 4], rotation: 45, width: 3, deleted: false });
    const other = rotate(defaultState(), { type: 'furniture', id: 'a-kitchen-run' }, 90);
    expect(other.design.furnitureEdits['a-kitchen-run']).not.toHaveProperty('depth');
  });
});

describe('rotated stair geometry, real meshes and matching destination holes', () => {
  for (const unit of ['north', 'south'] as const) for (const layout of ['straight', 'u-shaped'] as const) {
    it(`${unit} ${layout}: shared pivot and transformed treads/cutouts match in both connections`, () => {
      const initial = defaultState(); initial.buildings[unit].stairLayout = layout;
      Object.assign(initial.buildings[unit], { width: 16, depth: 6, x: 2, z: -3, rotation: 37 });
      initial.northBearing = -43;
      const state = rotate(initial, { type: 'stair', id: `stair-${unit}-basement` }, 90);
      const architecture = buildArchitecture(state, palette);
      try {
        for (const from of ['basement', 'ground'] as const) {
          const before = resolveStairGeometry(initial, unit, from)!, stair = resolveStairGeometry(state, unit, from)!;
          expect(stair.rise).toBe(before.rise); expect(stair.parts).toHaveLength(before.parts.length);
          stair.footprint.forEach((point, i) => closePoint(point, rotatePlanPoint(before.footprint[i], before.pivot, 90)));
          const meshes = architecture.measurementTargets.filter(m => m.userData.stairId === `stair-${unit}-${from}`);
          stair.parts.forEach((part, i) => {
            closePoint(part.center, rotatePlanPoint(before.parts[i].center, before.pivot, 90));
            expect(meshes[i].rotation.y).toBeCloseTo(-Math.PI / 2);
            expect(meshes[i].getWorldPosition(new Vector3()).distanceTo(new Vector3(...modelWorldPoint(part.center, part.bottom + part.height / 2, unit, state)))).toBeLessThan(1e-8);
            expect(part.width).toBe(before.parts[i].width); expect(part.depth).toBe(before.parts[i].depth);
          });
          const slab = architecture.measurementTargets.filter(m => m.userData.role === 'slab' && m.userData.unit === unit && m.userData.floor === stair.toFloor);
          const center: Vec2 = [stair.footprint.reduce((sum, p) => sum + p[0], 0) / 4, stair.footprint.reduce((sum, p) => sum + p[1], 0) / 4];
          const elevation = from === 'basement' ? 0 : state.buildings[unit].groundHeight;
          const ray = new Raycaster(new Vector3(...modelWorldPoint(center, elevation + .1, unit, state)), new Vector3(0, -1, 0), 0, SLAB + .2);
          expect(ray.intersectObjects(slab, false)).toHaveLength(0);
          // Just outside the rotated edge must remain solid, not remove the entire floor.
          const edge: Vec2 = [(before.footprint[2][0] + before.footprint[3][0]) / 2, before.footprint[2][1] + .02];
          ray.set(new Vector3(...modelWorldPoint(rotatePlanPoint(edge, before.pivot, 90), elevation + .1, unit, state)), new Vector3(0, -1, 0));
          expect(ray.intersectObjects(slab, false).length).toBeGreaterThan(0);
        }
      } finally { disposeArchitecture(architecture); }
    });
  }
  it('keeps rotation across layout changes and refuses unavailable upper connections', () => {
    let state = rotate(defaultState(), selections[3], 45);
    state = applyCadCommand(state, { type: 'stair', unit: 'north', layout: 'straight' });
    expect(resolveStairGeometry(state, 'north', 'ground')!.rotation).toBe(45);
    state.buildings.north.storeys = 1;
    expect(() => rotate(state, selections[3], 60)).toThrow();
    expect(rotate(state, { type: 'stair', id: 'stair-north-basement' }, 60).buildings.north.stairRotation).toBe(60);
  });
});

describe('rotation persistence and keyboard boundaries', () => {
  it('loads old files without synthesizing rotation fields', () => {
    const state = defaultState();
    expect(parseProject(serializeProject(state))).toEqual(state);
    expect(parseProject('{"version":1}').buildings.north).not.toHaveProperty('stairRotation');
  });
  it('rejects malformed optional rotations, even in inactive data, without invoking accessors', () => {
    for (const rotation of [undefined, null, NaN, Infinity, 181, -181, '90']) {
      const state = defaultState(); state.buildings.north.enabled = false;
      state.buildings.north.stairRotation = rotation as number;
      expect(() => serializeProject(state)).toThrow('stairRotation');
      delete state.buildings.north.stairRotation;
      state.design.roomEdits['a-living'] = { center: [5, 4], width: 3, depth: 2, deleted: true, rotation: rotation as number };
      expect(() => serializeProject(state)).toThrow('rotation');
    }
    const state = defaultState(), getter = vi.fn(() => 90);
    Object.defineProperty(state.buildings.north, 'stairRotation', { get: getter });
    expect(() => serializeProject(state)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('keeps typing, browser shortcuts, repeats and composition native', () => {
    const event = { key: 'r', code: 'KeyR', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false };
    expect(rotationShortcut(event, false)).toBe(15);
    expect(rotationShortcut({ ...event, shiftKey: true }, false)).toBe(-15);
    expect(rotationShortcut({ ...event, key: 'ר' }, false)).toBe(15);
    expect(rotationShortcut(event, true)).toBeNull();
    for (const flag of ['ctrlKey', 'metaKey', 'altKey', 'repeat', 'isComposing', 'defaultPrevented']) expect(rotationShortcut({ ...event, [flag]: true }, false)).toBeNull();
    expect(rotationShortcut({ ...event, key: 'ArrowUp', code: 'ArrowUp' }, false)).toBeNull();
  });
});