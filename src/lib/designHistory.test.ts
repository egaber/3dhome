import { describe, expect, it } from 'vitest';
import { createHistory, historyReducer } from './actionHistory';
import { defaultState } from '../model/plans';

describe('switching design histories', () => {
  it('resets undo/redo at an alternative boundary without changing either design', () => {
    const first = defaultState(), second = { ...defaultState(), minutes: 950 };
    const edited = historyReducer(createHistory(first), { type: 'change', update: { ...first, minutes: 800 } });
    const switched = historyReducer(edited, { type: 'reset', state: second });
    expect(switched.entries).toHaveLength(1);
    expect(switched.present).toBe(second);
    expect(historyReducer(switched, { type: 'undo' }).present).toBe(second);
    expect(historyReducer(switched, { type: 'redo' }).present).toBe(second);
    expect(first.minutes).toBe(720);
  });
});
