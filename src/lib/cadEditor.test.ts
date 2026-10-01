import { describe, expect, it } from 'vitest';
import { applyCadCommand } from '../model/cad';
import { BASE_WIDTH, defaultState, planPoint, resolvedFurniture, resolvedWalls } from '../model/plans';
import { createHistory, historyReducer } from './actionHistory';
import { boundsOf, dragCommand, finishCadDrag, fitPlan, furniturePoint, furnitureScales, geometryContext, lengthText, planMeasurement, snapPlan, solidWallSpans, svgMatrix, wallPolygon, zoomPlan } from './cadEditor';

describe('CAD display-plan geometry', () => {
  it('measures world metres after anisotropic scaling and rotation, not source or screen distance', () => {
    const state = defaultState();
    state.buildings.north = { ...state.buildings.north, width: BASE_WIDTH * 1.4, depth: 4, rotation: 37, x: -8, z: 9 };
    const a = planPoint([1, 2], 'north', state), b = planPoint([4, 2], 'north', state);
    expect(planMeasurement([a, b], 'ground', 'north', state)?.distance).toBeCloseTo(4.2, 10);
    expect(planMeasurement([a, b], 'ground', 'north', state)?.vertical).toBe(0);
    expect(lengthText(4.2, 'mm')).toBe('4200 מ״מ');
  });
  it('rejects unavailable floors and incomplete measurements', () => {
    const state = defaultState(); state.buildings.north.storeys = 1;
    expect(planMeasurement([[0, 0], [3, 4]], 'first', 'north', state)).toBeNull();
    expect(planMeasurement([[0, 0]], 'ground', 'north', state)).toBeNull();
  });
  it('constructs transformed wall polygon thickness rather than a screen stroke', () => {
    const state = defaultState(), wall = resolvedWalls(state)[0];
    state.buildings[wall.unit].width *= 1.5; state.buildings[wall.unit].depth *= 1.5;
    state.buildings[wall.unit].rotation = 50;
    const polygon = wallPolygon(wall, 0, 1, state);
    expect(Math.hypot(polygon[1][0] - polygon[0][0], polygon[1][1] - polygon[0][1])).toBeCloseTo(1.5);
    expect(Math.hypot(polygon[3][0] - polygon[0][0], polygon[3][1] - polygon[0][1])).toBeCloseTo(wall.thickness * 1.5);
  });
  it('subtracts union of overlapping, touching and full-wall apertures', () => {
    const a = (center: number, width: number) => ({ id: 'a', center, width, height: 2, sill: 0 });
    expect(solidWallSpans(10, [a(3, 4), a(5, 4), a(8, 2)])).toEqual([[0, 1], [9, 10]]);
    expect(solidWallSpans(10, [a(5, 10)])).toEqual([]);
    expect(solidWallSpans(10, [])).toEqual([[0, 10]]);
  });
  it('rotates furniture before nonuniform building scaling', () => {
    const state = defaultState(); state.buildings.north.width *= 1.5;
    const item = { ...resolvedFurniture(state).find(i => i.unit === 'north')!, center: [2, 3] as [number, number], rotation: 90 };
    expect(furniturePoint(item, [1, 0])[0]).toBeCloseTo(2);
    expect(furniturePoint(item, [1, 0])[1]).toBeCloseTo(4);
    const scale = furnitureScales(item, state);
    expect(scale[0]).toBeCloseTo(1); expect(scale[1]).toBeCloseTo(1.5);
    expect(svgMatrix(([x, z]) => [x * 2 + 3, z * 4 + 5])).toBe('matrix(2 0 0 4 3 5)');
  });
  it('snap is 25cm in the display frame; unsnapped pointer precision is 1cm', () => {
    expect(snapPlan([1.13, -2.14], true)).toEqual([1.25, -2.25]);
    expect(snapPlan([1.133, -2.146], false)).toEqual([1.13, -2.15]);
  });
  it('fit maintains aspect and contains distant geometry; zoom retains the cursor anchor', () => {
    const bounds = boundsOf([[-40, -20], [60, 10]], 1);
    const view = fitPlan(bounds, 2);
    expect(view.width / view.height).toBe(2);
    expect(view.x).toBeLessThanOrEqual(-41); expect(view.x + view.width).toBeGreaterThanOrEqual(61);
    const anchor: [number, number] = [20, 4], next = zoomPlan(view, anchor, .25);
    expect((anchor[0] - next.x) / next.width).toBeCloseTo((anchor[0] - view.x) / view.width);
    expect((anchor[1] - next.y) / next.height).toBeCloseTo((anchor[1] - view.y) / view.height);
    expect(zoomPlan(view, anchor, .00001).width).toBe(.5);
    expect(zoomPlan(view, anchor, NaN)).toBe(view);
  });
  it('geometry context ignores camera/presentation but changes for floor, variant and furniture', () => {
    const state = defaultState(), key = geometryContext(state, 'north', 'ground');
    expect(geometryContext({ ...state, view: { ...state.view, grid: !state.view.grid } }, 'north', 'ground')).toBe(key);
    expect(geometryContext(state, 'north', 'first')).not.toBe(key);
    const next = applyCadCommand(state, { type: 'stair', unit: 'north', layout: 'straight' });
    expect(geometryContext(next, 'north', 'ground')).not.toBe(key);
  });
});

describe('local CAD drag transactions', () => {
  it('previews without mutation and commits once to the existing history', () => {
    const state = defaultState(), before = structuredClone(state), wall = resolvedWalls(state)[0];
    const selection = { type: 'wall' as const, id: wall.id };
    const a = planPoint(wall.a, wall.unit, state);
    const command = dragCommand(state, selection, a, [a[0] + 1, a[1]], true)!;
    const preview = applyCadCommand(state, command);
    expect(state).toEqual(before); expect(preview).not.toBe(state);
    const committed = finishCadDrag(state, state, command);
    const history = historyReducer(createHistory(state), { type: 'change', update: committed, label: 'CAD drag' });
    expect(history.entries).toHaveLength(2);
    expect(historyReducer(history, { type: 'undo' }).present).toEqual(state);
  });
  it('rejects stale release after external state or undo, even an equal-content new object', () => {
    const state = defaultState(), wall = resolvedWalls(state)[0];
    const command = dragCommand(state, { type: 'wall', id: wall.id }, [0, 0], [1, 1], true);
    const external = structuredClone(state);
    expect(finishCadDrag(state, external, command)).toBe(external);
    expect(finishCadDrag(state, state, null)).toBe(state);
  });
  it('a click and returning exactly to start are no-ops even off-grid', () => {
    const state = defaultState(), wall = resolvedWalls(state)[0];
    expect(dragCommand(state, { type: 'wall', id: wall.id }, [.12, .34], [.12, .34], true)).toBeNull();
  });
  it('snaps a moved endpoint in displayed metres BEFORE inverse rotation/scaling', () => {
    const state = defaultState(); state.buildings.north.rotation = 37; state.buildings.north.width *= 1.4;
    const wall = resolvedWalls(state).find(w => w.unit === 'north')!;
    const command = dragCommand(state, { type: 'wall', id: wall.id }, [0, 0], [3.14, 2.13], true, 'a')!;
    expect(command.type).toBe('wall');
    if (command.type !== 'wall') throw new Error('wall command required');
    const point = planPoint(command.edit.a, wall.unit, state);
    expect(point[0]).toBeCloseTo(3.25); expect(point[1]).toBeCloseTo(2.25);
    expect(command.edit.b).toEqual(wall.b);
  });
  it('moves one appliance without changing its cabinet, room, wall or neighboring appliances', () => {
    const state = defaultState(), item = resolvedFurniture(state).find(i => i.kind === 'sink')!;
    const command = dragCommand(state, { type: 'furniture', id: item.id }, [0, 0], [.5, .5], false)!;
    const next = finishCadDrag(state, state, command);
    expect(next.design.wallEdits).toBe(state.design.wallEdits); expect(next.design.roomEdits).toBe(state.design.roomEdits);
    expect(resolvedFurniture(next).filter(i => i.id !== item.id)).toEqual(resolvedFurniture(state).filter(i => i.id !== item.id));
  });
  it('rejects invalid endpoint command atomically and ignores missing/phantom objects', () => {
    const state = defaultState(), wall = resolvedWalls(state)[0], before = structuredClone(state);
    expect(() => finishCadDrag(state, state, { type: 'wall', id: wall.id, edit: { a: wall.a, b: wall.a, deleted: false } })).toThrow();
    expect(state).toEqual(before);
    expect(dragCommand(state, { type: 'furniture', id: 'missing' }, [0, 0], [1, 1], true)).toBeNull();
    expect(dragCommand(state, { type: 'wall', id: wall.id }, [0, 0], [NaN, 1], true)).toBeNull();
  });
});