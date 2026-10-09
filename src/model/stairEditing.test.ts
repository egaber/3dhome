import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../lib/project';
import { applyCadCommand, resolveStairGeometry, stairPartOrder, type CadCommand } from './cad';
import { defaultState } from './plans';
import { DEFAULT_STAIR_PATH } from './stairPath';
import { southWestProposal } from './southWestLayout';
import { rotatePlanPoint } from './rotation';

describe('independent editable stair connections', () => {
  it('changes only the selected connection and restores its unchanged original on removal', () => {
    const state = southWestProposal(defaultState());
    const basement = resolveStairGeometry(state, 'south', 'basement');
    const next = applyCadCommand(state, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: DEFAULT_STAIR_PATH });
    expect(resolveStairGeometry(next, 'south', 'basement')).toEqual(basement);
    expect(next.buildings.north).toBe(state.buildings.north);
    expect(next.design).toBe(state.design);
    expect(state.buildings.south.stairPaths).toBeUndefined();
    const stair = resolveStairGeometry(next, 'south', 'ground')!;
    expect(stair.customPath).toBe(true);
    expect(stair.entry!.center[0]).toBeCloseTo(.68, 12);
    expect(stair.entry!.center[1]).toBeCloseTo(12.44, 12);
    expect(stair.exit!.center[0]).toBeGreaterThan(3);
    expect(stair.parts[9].kind).toBe('landing');
    expect(stairPartOrder(stair)).toEqual(stair.parts.map((_, index) => index));
    expect(stair.topStepRise).toBeCloseTo(3.4 / 18);
    expect(applyCadCommand(next, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: DEFAULT_STAIR_PATH })).toBe(next);
    expect(applyCadCommand(next, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: null })).toEqual(state);
  });
  it('composes each flight direction with shared rotation, scale and placement', () => {
    let state = southWestProposal(defaultState());
    state = applyCadCommand(state, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: DEFAULT_STAIR_PATH });
    const before = resolveStairGeometry(state, 'south', 'ground')!;
    Object.assign(state.buildings.south, { stairRotation: 37, stairScale: 1.2, stairPosition: [4, 11] });
    const stair = resolveStairGeometry(state, 'south', 'ground')!;
    expect(stair.parts[0].rotation).toBe(37);
    expect(stair.parts.at(-1)!.rotation).toBe(127);
    expect(stair.parts[0].width).toBeCloseTo(.92 * 1.2);
    const transformed = rotatePlanPoint([before.pivot[0] + (before.exit!.center[0] - before.pivot[0]) * 1.2,
      before.pivot[1] + (before.exit!.center[1] - before.pivot[1]) * 1.2], before.pivot, 37);
    expect(stair.exit!.center[0]).toBeCloseTo(transformed[0] + 4 - before.pivot[0]);
    expect(stair.exit!.center[1]).toBeCloseTo(transformed[1] + 11 - before.pivot[1]);
    expect(stair.parts.at(-1)!.bottom + .1 + stair.topStepRise).toBeCloseTo(3.4);
  });
  it('round-trips paths and protection while old projects retain their original stairs', () => {
    let state = southWestProposal(defaultState());
    state = applyCadCommand(state, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: DEFAULT_STAIR_PATH });
    state = applyCadCommand(state, { type: 'stair-path', unit: 'south', fromFloor: 'basement', path: { ...DEFAULT_STAIR_PATH, turn: 'straight', landingAfter: 8 } });
    state = applyCadCommand(state, { type: 'stair-protection', unit: 'south', railing: true, openingGlass: true });
    expect(parseProject(serializeProject(state))).toEqual(state);
    expect(parseProject(serializeProject(defaultState()))).toEqual(defaultState());
    const removed = applyCadCommand(state, { type: 'stair-path', unit: 'south', fromFloor: 'basement', path: null });
    expect(removed.buildings.south.stairPaths).toEqual({ ground: DEFAULT_STAIR_PATH });
    const preset = applyCadCommand(state, { type: 'stair', unit: 'south', layout: 'straight' });
    expect(preset.buildings.south.stairPaths).toBeUndefined();
    expect(preset.buildings.south.stairOpeningGlass).toBe(true);
    expect(preset.buildings.north).toBe(state.buildings.north);
  });
  it('adds the second southward turn only to the ground-to-first connection and persists it', () => {
    const state = applyCadCommand(southWestProposal(defaultState()), { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: DEFAULT_STAIR_PATH });
    const basement = resolveStairGeometry(state, 'south', 'basement');
    const next = applyCadCommand(state, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: {
      ...DEFAULT_STAIR_PATH, secondLanding: { turn: 'right', landingAfter: 15, landingDepth: 1.1 },
    } });
    expect(resolveStairGeometry(next, 'south', 'basement')).toEqual(basement);
    expect(next.buildings.south.stairPaths?.basement).toBeUndefined();
    expect(next.buildings.north).toBe(state.buildings.north);
    expect(next.design).toBe(state.design);
    expect(resolveStairGeometry(next, 'south', 'ground')!.parts.filter(part => part.kind === 'landing')).toHaveLength(2);
    expect(parseProject(serializeProject(next))).toEqual(next);
    expect(applyCadCommand(next, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: DEFAULT_STAIR_PATH })).toEqual(state);
    const invalid = { ...next, buildings: { ...next.buildings, south: { ...next.buildings.south, stairPaths: {
      ground: { ...DEFAULT_STAIR_PATH, secondLanding: { turn: 'right', landingAfter: 10, landingDepth: 1.1 } },
    } } } };
    expect(() => parseProject(JSON.stringify(invalid))).toThrow();
  });
  it('fails closed on invalid edits, imported routes, protection flags and unavailable destinations', () => {
    const state = defaultState();
    const invalidCommands = [
      { type: 'stair-path', unit: 'south', fromFloor: 'roof', path: DEFAULT_STAIR_PATH },
      { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: { ...DEFAULT_STAIR_PATH, landingAfter: 1 } },
      { type: 'stair-protection', unit: 'south', railing: 'true', openingGlass: true },
    ];
    for (const command of invalidCommands) expect(() => applyCadCommand(state, command as CadCommand)).toThrow();
    for (const patch of [{ stairPaths: { roof: DEFAULT_STAIR_PATH } }, { stairPaths: { ground: { ...DEFAULT_STAIR_PATH, width: NaN } } }, { stairOpeningGlass: 1 }]) {
      expect(() => parseProject(JSON.stringify({ ...state, buildings: { ...state.buildings, south: { ...state.buildings.south, ...patch } } }))).toThrow();
    }
    state.buildings.south.storeys = 1;
    expect(() => applyCadCommand(state, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: DEFAULT_STAIR_PATH })).toThrow();
    state.buildings.south.stairPaths = { ground: { ...DEFAULT_STAIR_PATH, width: NaN } };
    expect(resolveStairGeometry(state, 'south', 'ground')).toBeNull();
  });
});