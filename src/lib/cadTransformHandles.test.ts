import { describe, expect, it, vi } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { rotationDragCommand, rotationHandlePoint, selectionFrame } from './cadTransformHandles';
import { rotationCommand, rotationInfo } from './cadRotation';
import { dragCommand, finishCadDrag, type CadSelection } from './cadEditor';
import { parseProject, serializeProject } from './project';
import { createHistory, historyReducer } from './actionHistory';
import { applyCadCommand, inversePlanPoint, modelWorldPoint, resolveStairGeometry } from '../model/cad';
import { defaultState, planPoint, resolvedOpenings, SLAB } from '../model/plans';
import { normalizeRotation, rotatePlanPoint } from '../model/rotation';
import type { Vec2 } from '../model/types';
import { buildArchitecture, disposeArchitecture, type Palette } from '../scene/architecture';

const cases: CadSelection[] = [{ type: 'wall', id: 'ground-wall-0-north' }, { type: 'furniture', id: 'a-living-sofa' },
  { type: 'room', id: 'a-living' }, { type: 'stair', id: 'stair-north-ground' }];
const closePoint = (a: Vec2, b: Vec2) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-8);
const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };

describe('PowerPoint-style rotation handles', () => {
  it.each(cases)('$type has a frame and affine-safe drag with fixed pivot', selection => {
    const state = defaultState(); Object.assign(state.buildings.north, { width: 16, depth: 5, rotation: 37, x: 2, z: -4 });
    const frame = selectionFrame(state, selection)!, info = rotationInfo(state, selection)!;
    expect(frame.outline).toHaveLength(4);
    closePoint(frame.pivot, planPoint(info.pivot, info.unit, state));
    const start = rotationHandlePoint(frame, { x: -10, y: -10, width: 40, height: 30 }, [800, 600]);
    const local = inversePlanPoint(start, info.unit, state);
    const end = planPoint(rotatePlanPoint(local, info.pivot, 42.7), info.unit, state);
    const before = structuredClone(state);
    const command = rotationDragCommand(state, selection, start, end, false)!;
    const next = applyCadCommand(state, command);
    expect(rotationInfo(next, selection)!.angle).toBeCloseTo(normalizeRotation(info.angle + 42.7));
    closePoint(rotationInfo(next, selection)!.pivot, info.pivot);
    expect(state).toEqual(before);
    expect(rotationDragCommand(state, selection, start, start, false)).toBeNull();
  });

  it('rotates openings via their host wall, not a detached aperture', () => {
    const state = defaultState(), opening = resolvedOpenings(state)[0];
    const selection: CadSelection = { type: 'opening', id: opening.id };
    expect(selectionFrame(state, selection)).toEqual(selectionFrame(state, { type: 'wall', id: opening.wallId }));
  });

  it('snaps only when requested, wraps at 180 and does not accumulate previews', () => {
    let state = defaultState(); const selection = cases[1];
    state = applyCadCommand(state, rotationCommand(state, selection, 175)!);
    const info = rotationInfo(state, selection)!;
    const start = planPoint([info.pivot[0], info.pivot[1] - 2], info.unit, state);
    const end = planPoint(rotatePlanPoint([info.pivot[0], info.pivot[1] - 2], info.pivot, 21), info.unit, state);
    const free = rotationDragCommand(state, selection, start, end, false)!;
    const snap = rotationDragCommand(state, selection, start, end, true)!;
    expect(rotationInfo(applyCadCommand(state, free), selection)!.angle).toBeCloseTo(-164);
    expect(rotationInfo(applyCadCommand(state, snap), selection)!.angle).toBe(-165);
    expect(rotationDragCommand(state, selection, start, end, false)).toEqual(free);
  });

  it('ignores malformed points, inactive selections and a pointer on the pivot', () => {
    const state = defaultState(), selection = cases[1], pivot = selectionFrame(state, selection)!.pivot;
    expect(rotationDragCommand(state, selection, pivot, [1, 2], false)).toBeNull();
    expect(rotationDragCommand(state, selection, [1, 2], pivot, false)).toBeNull();
    expect(rotationDragCommand(state, selection, [NaN, 2], [2, 4], false)).toBeNull();
    state.buildings.north.enabled = false;
    expect(selectionFrame(state, selection)).toBeNull();
  });

  it('keeps a 38px stem on zoomed/non-square views and clamps the 44px hit area inside the view', () => {
    const frame = selectionFrame(defaultState(), cases[1])!;
    for (const [width, height] of [[20, 10], [40, 80]]) {
      const view = { x: frame.anchor[0] - width / 2, y: frame.anchor[1] - height / 2, width, height }, point = rotationHandlePoint(frame, view, [800, 600]);
      expect(Math.hypot((point[0] - frame.anchor[0]) * 800 / width, (point[1] - frame.anchor[1]) * 600 / height)).toBeCloseTo(38);
    }
    const view = { x: 0, y: 0, width: 10, height: 8 }, edge = rotationHandlePoint({ ...frame, anchor: [9.99, .01] }, view, [360, 300]);
    expect(edge[0] + 22 * 10 / 360).toBeLessThan(10);
    expect(edge[1] - 22 * 8 / 300).toBeGreaterThan(0);
  });
});

describe('movable staircases share geometry and history', () => {
  it.each(['north', 'south'] as const)('drags %s in displayed metres after scaling/rotation, preserving its angle', unit => {
    let state = defaultState(); Object.assign(state.buildings[unit], { width: 16, depth: 6, rotation: -32, x: 3, z: 1 });
    state = applyCadCommand(state, { type: 'stair-rotation', unit, rotation: 35 });
    const selected: CadSelection = { type: 'stair', id: `stair-${unit}-ground` };
    const initial = resolveStairGeometry(state, unit, 'ground')!, displayed = planPoint(initial.pivot, unit, state);
    const command = dragCommand(state, selected, displayed, [displayed[0] + 1.1, displayed[1] - .8], false)!;
    const next = applyCadCommand(state, command), moved = resolveStairGeometry(next, unit, 'ground')!;
    closePoint(planPoint(moved.pivot, unit, next), [Math.round((displayed[0] + 1.1) * 100) / 100, Math.round((displayed[1] - .8) * 100) / 100]);
    expect(moved.rotation).toBe(35); expect(moved.rise).toBe(initial.rise);
    const delta = moved.pivot.map((value, i) => value - initial.pivot[i]);
    for (const from of ['basement', 'ground'] as const) {
      const a = resolveStairGeometry(state, unit, from)!, b = resolveStairGeometry(next, unit, from)!;
      b.parts.forEach((part, i) => closePoint(part.center, [a.parts[i].center[0] + delta[0], a.parts[i].center[1] + delta[1]]));
    }
    expect(next.buildings[unit === 'north' ? 'south' : 'north']).toBe(state.buildings[unit === 'north' ? 'south' : 'north']);
    expect(parseProject(serializeProject(next))).toEqual(next);
    let history = createHistory(state);
    history = historyReducer(history, { type: 'change', update: finishCadDrag(state, state, command) });
    expect(history.entries).toHaveLength(2); expect(historyReducer(history, { type: 'undo' }).present).toEqual(state);
    expect(finishCadDrag(state, { ...state, minutes: 900 }, command).minutes).toBe(900);
    expect(finishCadDrag(state, state, null)).toBe(state);
    const snapped = applyCadCommand(state, dragCommand(state, selected, displayed, [displayed[0] + .71, displayed[1] + .46], true)!);
    for (const coordinate of planPoint(resolveStairGeometry(snapped, unit, 'ground')!.pivot, unit, snapped)) expect(coordinate * 4).toBeCloseTo(Math.round(coordinate * 4));
  });

  it('rotates around the moved pivot and preserves placement when changing stair layouts', () => {
    const original = defaultState();
    let state = applyCadCommand(original, { type: 'stair-position', unit: 'north', position: [6, 4] });
    state = applyCadCommand(state, { type: 'stair-rotation', unit: 'north', rotation: 90 });
    const rotated = resolveStairGeometry(state, 'north', 'ground')!;
    closePoint(rotated.pivot, [6, 4]);
    state = applyCadCommand(state, { type: 'stair', unit: 'north', layout: 'straight' });
    closePoint(resolveStairGeometry(state, 'north', 'ground')!.pivot, [6, 4]);
    expect(state.buildings.north.stairRotation).toBe(90);
    expect(dragCommand(state, { type: 'stair', id: 'stair-missing-ground' }, [0, 0], [1, 0], false)).toBeNull();
    state.buildings.north.storeys = 1;
    expect(dragCommand(state, { type: 'stair', id: 'stair-north-ground' }, [0, 0], [1, 0], false)).toBeNull();
  });

  it('moves real stair meshes AND slab openings, filling the original hole', () => {
    const original = defaultState(), before = resolveStairGeometry(original, 'north', 'ground')!;
    const state = applyCadCommand(original, { type: 'stair-position', unit: 'north', position: [8.5, before.pivot[1]] });
    const stair = resolveStairGeometry(state, 'north', 'ground')!, architecture = buildArchitecture(state, palette);
    try {
      const meshes = architecture.measurementTargets.filter(m => m.userData.stairId === 'stair-north-ground');
      stair.parts.forEach((part, i) => expect(meshes[i].getWorldPosition(new Vector3()).distanceTo(new Vector3(...modelWorldPoint(part.center, part.bottom + part.height / 2, 'north', state)))).toBeLessThan(1e-8));
      const floor = architecture.measurementTargets.filter(m => m.userData.role === 'slab' && m.userData.unit === 'north' && m.userData.floor === 'first');
      const ray = new Raycaster(new Vector3(...modelWorldPoint(stair.pivot, 3.5, 'north', state)), new Vector3(0, -1, 0), 0, SLAB + .2);
      expect(ray.intersectObjects(floor, false)).toHaveLength(0);
      ray.set(new Vector3(...modelWorldPoint(before.pivot, 3.5, 'north', state)), new Vector3(0, -1, 0));
      expect(ray.intersectObjects(floor, false).length).toBeGreaterThan(0);
    } finally { disposeArchitecture(architecture); }
  });

  it('strictly validates/copies optional positions without invoking getters; old projects keep defaults', () => {
    const state = defaultState(); expect(parseProject(serializeProject(state)).buildings.north).not.toHaveProperty('stairPosition');
    const pivot = resolveStairGeometry(state, 'north', 'ground')!.pivot;
    expect(applyCadCommand(state, { type: 'stair-position', unit: 'north', position: pivot })).toBe(state);
    const position: Vec2 = [6, 4], next = applyCadCommand(state, { type: 'stair-position', unit: 'north', position });
    position[0] = 99; expect(next.buildings.north.stairPosition).toEqual([6, 4]);
    for (const bad of [null, undefined, [], [1], [1, 2, 3], [NaN, 1], [101, 0], [0, -101], ['1', 2]]) {
      expect(() => applyCadCommand(state, { type: 'stair-position', unit: 'north', position: bad as Vec2 })).toThrow();
      const malformed = { ...state, buildings: { ...state.buildings, north: { ...state.buildings.north, stairPosition: bad as Vec2 } } };
      expect(() => serializeProject(malformed)).toThrow('stairPosition');
    }
    const getter = vi.fn(() => [6, 4]); Object.defineProperty(state.buildings.north, 'stairPosition', { get: getter });
    expect(() => serializeProject(state)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});