import { describe, expect, it } from 'vitest';
import { defaultState } from '../model/plans';
import { createHistory, describeChange, finishHistory, HISTORY_LIMIT, historyReducer, historyShortcut, sameState, type HistoryAction } from './actionHistory';

describe('project action history', () => {
  const initial = defaultState();
  const start = () => createHistory(structuredClone(initial));
  const time = (minutes: number): HistoryAction => ({ type: 'change', update: current => ({ ...current, minutes }) });

  it('starts empty and clamps repeated undo/redo at both boundaries', () => {
    const history = start();
    expect(historyReducer(history, { type: 'undo' })).toBe(history);
    expect(historyReducer(history, { type: 'redo' })).toBe(history);
    const changed = historyReducer(history, time(650));
    expect(historyReducer(changed, { type: 'redo' })).toBe(changed);
    const undone = historyReducer(changed, { type: 'undo' });
    expect(undone.present).toEqual(initial);
    expect(historyReducer(undone, { type: 'redo' }).present.minutes).toBe(650);
  });

  it('retains exact nested states for ordered undo, redo and arbitrary jumps', () => {
    const one = historyReducer(start(), time(650));
    const two = historyReducer(one, { type: 'change', update: state => ({ ...state, buildings: { ...state.buildings, north: { ...state.buildings.north, width: 12 } } }) });
    const three = historyReducer(two, { type: 'change', update: state => ({ ...state, openings: { ...state.openings, test: { width: 0, height: 0 } } }) });
    expect(historyReducer(three, { type: 'undo' }).present).toEqual(two.present);
    expect(historyReducer(three, { type: 'jump', id: 1 }).present).toEqual(one.present);
    const first = historyReducer(three, { type: 'jump', id: 0 });
    expect(first.present).toEqual(initial);
    expect(historyReducer(first, { type: 'jump', id: 3 }).present).toEqual(three.present);
    expect(one.present.buildings.north.width).toBe(initial.buildings.north.width);
    expect(initial.openings).not.toHaveProperty('test');
  });

  it('discards only the redo branch after a real new edit and never reuses ids', () => {
    const one = historyReducer(start(), time(650));
    const two = historyReducer(one, time(700));
    const back = historyReducer(two, { type: 'undo' });
    const branch = historyReducer(back, time(800));
    expect(branch.entries.map(entry => entry.id)).toEqual([0, 1, 3]);
    expect(historyReducer(branch, { type: 'redo' })).toBe(branch);
    expect(historyReducer(branch, { type: 'undo' }).present).toEqual(one.present);
    expect(historyReducer(branch, { type: 'jump', id: 2 })).toBe(branch);
  });

  it('ignores same-value updates, including clones and reordered keys, without clearing redo', () => {
    const history = historyReducer(historyReducer(start(), time(650)), { type: 'undo' });
    expect(historyReducer(history, { type: 'change', update: state => state })).toBe(history);
    expect(historyReducer(history, { type: 'change', update: state => structuredClone(state) })).toBe(history);
    expect(sameState({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(sameState([], {})).toBe(false);
    expect(sameState({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('coalesces a continuous gesture into a single labelled step and updates live', () => {
    let history = historyReducer(start(), { type: 'begin', label: 'שעת הסימולציה' });
    for (let minutes = 600; minutes < 620; minutes++) history = historyReducer(history, time(minutes));
    expect(history.present.minutes).toBe(619);
    expect(history.entries).toHaveLength(1);
    const completed = historyReducer(history, { type: 'end' });
    expect(completed.entries).toHaveLength(2);
    expect(completed.entries[1].label).toBe('שעת הסימולציה');
    expect(historyReducer(completed, { type: 'undo' }).present).toEqual(initial);
    expect(historyReducer(completed, { type: 'end' })).toBe(completed);
  });

  it('does not lose redo or add a step for a click-only or net-zero gesture', () => {
    const history = historyReducer(historyReducer(start(), time(650)), { type: 'undo' });
    let grouped = historyReducer(history, { type: 'begin' });
    expect(finishHistory(grouped).entries).toBe(history.entries);
    grouped = historyReducer(grouped, time(800));
    grouped = historyReducer(grouped, time(initial.minutes));
    const completed = historyReducer(grouped, { type: 'end' });
    expect(completed.entries).toBe(history.entries);
    expect(completed.index).toBe(0);
    expect(historyReducer(completed, { type: 'redo' }).present.minutes).toBe(650);
  });

  it('finishes pending gestures before undo or another gesture begins', () => {
    let history = historyReducer(start(), { type: 'begin' });
    history = historyReducer(history, time(650));
    const back = historyReducer(history, { type: 'undo' });
    expect(back.present).toEqual(initial);
    expect(back.entries).toHaveLength(2);
    expect(historyReducer(back, { type: 'redo' }).present.minutes).toBe(650);
    history = historyReducer(history, { type: 'begin', label: 'next' });
    history = historyReducer(history, time(750));
    expect(finishHistory(history).entries).toHaveLength(3);
    expect(historyReducer(history, { type: 'undo' }).present.minutes).toBe(650);
  });

  it('bounds the stack without losing the oldest remaining undo state', () => {
    let history = start();
    for (let index = 1; index <= HISTORY_LIMIT + 10; index++) history = historyReducer(history, time(index));
    expect(history.entries).toHaveLength(HISTORY_LIMIT + 1);
    expect(history.index).toBe(HISTORY_LIMIT);
    expect(history.entries[0].state.minutes).toBe(10);
    for (let index = 0; index < HISTORY_LIMIT + 10; index++) history = historyReducer(history, { type: 'undo' });
    expect(history.present.minutes).toBe(10);
    expect(history.index).toBe(0);
  });

  it('ignores invalid jumps without prematurely committing a gesture', () => {
    let history = historyReducer(start(), { type: 'begin' });
    history = historyReducer(history, time(650));
    for (const id of [-1, 99, NaN, 0.5]) expect(historyReducer(history, { type: 'jump', id })).toBe(history);
  });

  it('restores a whole imported/reset project, including images and design, as one step', () => {
    const imported = structuredClone(initial);
    imported.reference.image = 'data:image/png;base64,test';
    imported.design.roomEdits.test = { center: [1, 2], width: 3, depth: 4, deleted: true };
    imported.view.grid = !initial.view.grid;
    const loaded = historyReducer(start(), { type: 'change', update: imported, label: 'ייבוא פרויקט' });
    const reset = historyReducer(loaded, { type: 'change', update: initial, label: 'איפוס המודל' });
    expect(historyReducer(reset, { type: 'undo' }).present).toEqual(imported);
    expect(historyReducer(loaded, { type: 'undo' }).present).toEqual(initial);
    expect(loaded.entries[1].label).toBe('ייבוא פרויקט');
  });

  it('gives descriptive Hebrew labels and preserves unchanged branches', () => {
    const history = start();
    const changed = historyReducer(history, time(650));
    expect(changed.entries[1].label).toBe('שינוי תאריך ושעת שמש');
    expect(changed.present.buildings).toBe(history.present.buildings);
    expect(describeChange(initial, { ...initial, design: { ...initial.design, wallEdits: {}, roomEdits: { test: { center: [0, 0], width: 2, depth: 2, deleted: false } } } })).toBe('עריכת תוכנית 2D');
  });
});

describe('history shortcuts', () => {
  const key = { key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, isComposing: false, defaultPrevented: false };
  it('supports Ctrl/Cmd Z, Shift Z, Y and Hebrew-layout physical keys', () => {
    expect(historyShortcut(key, false)).toBe('undo');
    expect(historyShortcut({ ...key, ctrlKey: false, metaKey: true }, false)).toBe('undo');
    expect(historyShortcut({ ...key, shiftKey: true }, false)).toBe('redo');
    expect(historyShortcut({ ...key, key: 'y', code: 'KeyY' }, false)).toBe('redo');
    expect(historyShortcut({ ...key, key: 'ז' }, false)).toBe('undo');
  });
  it('preserves native input undo, IME, alt combinations, and handled events', () => {
    expect(historyShortcut(key, true)).toBeNull();
    for (const modifier of ['altKey', 'isComposing', 'defaultPrevented'] as const) expect(historyShortcut({ ...key, [modifier]: true }, false)).toBeNull();
    expect(historyShortcut({ ...key, ctrlKey: false }, false)).toBeNull();
    expect(historyShortcut({ ...key, key: 'x', code: 'KeyX' }, false)).toBeNull();
    expect(historyShortcut({ ...key, key: 'y', code: 'KeyY', shiftKey: true }, false)).toBeNull();
  });
});