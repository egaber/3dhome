import { describe, expect, it } from 'vitest';
import { applyCadCommand, resolveStairGeometry } from './cad';
import { defaultState } from './plans';
import { DEFAULT_STAIR_PATH, parseStairPath, reverseStairPath } from './stairPath';
import { northEntranceStairProposal } from './northStairLayout';
import { parseProject, serializeProject } from '../lib/project';

describe('relative transforms for individual stair connections', () => {
  it('preserves legacy paths when relative rotation and offset are absent or zero', () => {
    const state = applyCadCommand(defaultState(), { type: 'stair-path', unit: 'north', fromFloor: 'ground', path: DEFAULT_STAIR_PATH });
    const zero = applyCadCommand(state, { type: 'stair-path', unit: 'north', fromFloor: 'ground', path: { ...DEFAULT_STAIR_PATH, rotation: 0, offset: [0, 0] } });
    expect(resolveStairGeometry(zero, 'north', 'ground')).toEqual(resolveStairGeometry(state, 'north', 'ground'));
    expect(parseStairPath(DEFAULT_STAIR_PATH)).toEqual(DEFAULT_STAIR_PATH);
  });

  it('round-trips independent connections and keeps the basement unchanged when editing the ascent', () => {
    const state = northEntranceStairProposal(defaultState());
    expect(parseProject(serializeProject(state))).toEqual(state);
    const changed = applyCadCommand(state, { type: 'stair-path', unit: 'north', fromFloor: 'ground', path: { ...state.buildings.north.stairPaths!.ground!, rotation: 12, offset: [.2, -.3] } });
    expect(resolveStairGeometry(changed, 'north', 'basement')).toEqual(resolveStairGeometry(state, 'north', 'basement'));
    expect(resolveStairGeometry(changed, 'north', 'ground')?.footprint).not.toEqual(resolveStairGeometry(state, 'north', 'ground')?.footprint);
  });

  it('retains the connection transform and physical footprint through reversal', () => {
    const state = northEntranceStairProposal(defaultState());
    const path = state.buildings.north.stairPaths!.basement!;
    const reversed = reverseStairPath(path);
    expect(reverseStairPath(reversed)).toEqual(path);
    const next = applyCadCommand(state, { type: 'stair-path', unit: 'north', fromFloor: 'basement', path: reversed });
    expect(resolveStairGeometry(next, 'north', 'basement')?.footprint).toEqual(resolveStairGeometry(state, 'north', 'basement')?.footprint);
  });

  it('moves both connections together after their independent arrangement', () => {
    const state = northEntranceStairProposal(defaultState());
    const next = applyCadCommand(state, { type: 'stair-position', unit: 'north', position: [5.83, 6.655] });
    for (const floor of ['ground', 'basement'] as const) {
      const before = resolveStairGeometry(state, 'north', floor)!, after = resolveStairGeometry(next, 'north', floor)!;
      for (const [index, point] of before.footprint.entries()) {
        expect(after.footprint[index][0] - point[0]).toBeCloseTo(1, 8);
        expect(after.footprint[index][1] - point[1]).toBeCloseTo(2, 8);
      }
    }
  });

  it.each([{ rotation: 181 }, { rotation: '90' }, { rotation: NaN }, { offset: [1] }, { offset: [Infinity, 0] }, { offset: [0, 100.1] }])('rejects invalid relative transforms without mutating state: %j', invalid => {
    const state = northEntranceStairProposal(defaultState()), before = structuredClone(state);
    expect(() => parseStairPath({ ...DEFAULT_STAIR_PATH, ...invalid })).toThrow();
    expect(() => parseProject(JSON.stringify({ ...state, buildings: { ...state.buildings, north: { ...state.buildings.north,
      stairPaths: { ground: { ...DEFAULT_STAIR_PATH, ...invalid } } } } }))).toThrow();
    expect(state).toEqual(before);
  });
});