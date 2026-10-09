import { describe, expect, it } from 'vitest';
import { defaultState } from './plans';
import { applyLandscapeCommand, defaultLandscape, parseLandscape, parseLandscapeItem, resolvedLandscape } from './landscape';
import { parseProject, serializeProject } from '../lib/project';
import { createHistory, historyReducer } from '../lib/actionHistory';
import type { LandscapeSpec } from './types';

const tree: LandscapeSpec = { id: 'new-olive', kind: 'olive-tree', unit: 'north', level: 'garden', center: [4, -5], height: 3.5, spread: 2.4, rotation: 20 };
describe('persistent editable landscape', () => {
  it('replaces uniform pot rows with a small mixed collection, and empty means empty', () => {
    const state = defaultState(), items = defaultLandscape(state), garden = items.filter(item => item.level === 'garden');
    expect(garden).toHaveLength(6); expect(garden.filter(item => item.kind === 'potted-plant')).toHaveLength(2);
    expect(new Set(garden.map(item => item.kind)).size).toBe(4);
    expect(resolvedLandscape({ ...state, design: { ...state.design, landscape: [] } })).toEqual([]);
    expect(state.design.landscape).toBeUndefined();
  });
  it('adds, moves, resizes, rotates and deletes one object without touching another or another design', () => {
    const original = defaultState(), snapshot = structuredClone(original);
    const added = applyLandscapeCommand(original, { type: 'add', item: tree });
    const moved = applyLandscapeCommand(added, { type: 'update', item: { ...tree, center: [6, -8], height: 4, spread: 3, rotation: -45 } });
    expect(original).toEqual(snapshot);
    expect(moved.design.landscape!.find(item => item.id === tree.id)).toMatchObject({ center: [6, -8], height: 4, spread: 3, rotation: -45 });
    expect(moved.design.landscape!.filter(item => item.id !== tree.id)).toEqual(added.design.landscape!.filter(item => item.id !== tree.id));
    const deleted = applyLandscapeCommand(moved, { type: 'delete', id: tree.id });
    expect(resolvedLandscape(parseProject(serializeProject(deleted))).some(item => item.id === tree.id)).toBe(false);
  });
  it('retains deletions after reload and restores them through the shared undo history', () => {
    const state = defaultState(), id = resolvedLandscape(state)[0].id;
    const removed = applyLandscapeCommand(state, { type: 'delete', id });
    expect(resolvedLandscape(parseProject(serializeProject(removed))).some(item => item.id === id)).toBe(false);
    const history = historyReducer(createHistory(state), { type: 'change', update: removed, label: 'Delete tree' });
    expect(resolvedLandscape(historyReducer(history, { type: 'undo' }).present).some(item => item.id === id)).toBe(true);
    const empty = applyLandscapeCommand(state, { type: 'clear', gardenOnly: false });
    expect(resolvedLandscape(parseProject(serializeProject(empty)))).toEqual([]);
  });
  it('rejects invalid dimensions, duplicate IDs, excessive records, trees indoors and inactive updates', () => {
    for (const patch of [{ height: NaN }, { height: -1 }, { spread: 0 }, { rotation: 999 }, { center: [Infinity, 0] }, { level: 'first' }, { kind: 'unknown' }]) {
      expect(() => parseLandscapeItem({ ...tree, ...patch })).toThrow();
    }
    expect(() => parseLandscape([tree, tree])).toThrow();
    expect(() => parseLandscape(Array.from({ length: 81 }, (_, index) => ({ ...tree, id: `plant-${index}` })))).toThrow();
    expect(() => applyLandscapeCommand(defaultState(), { type: 'delete', id: 'missing' })).toThrow();
    const inactive = defaultState(); inactive.buildings.north.enabled = false;
    expect(() => applyLandscapeCommand(inactive, { type: 'add', item: tree })).toThrow();
  });
});
