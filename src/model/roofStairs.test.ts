import { describe, expect, it } from 'vitest';
import { applyCadCommand, getFloorLevels, resolveStairGeometry } from './cad';
import { defaultState } from './plans';
import { northEntranceStairProposal } from './northStairLayout';
import { northBedroomProposal } from './northBedroomLayout';
import { parseProject, serializeProject } from '../lib/project';
import { rotationInfo, stairSelection } from '../lib/cadRotation';

const proposal = () => northEntranceStairProposal(northBedroomProposal(defaultState()));

describe('optional first-floor to roof stair', () => {
  it('recognizes only valid stair selections and exposes active roof geometry to the editors', () => {
    const original = proposal(), selection = { type: 'stair' as const, id: 'stair-north-first' };
    expect(stairSelection(selection)).toEqual({ unit: 'north', fromFloor: 'first' });
    expect(stairSelection({ type: 'stair', id: 'stair-north-roof' })).toBeNull();
    expect(rotationInfo(original, selection)).toBeNull();
    const state = applyCadCommand(original, { type: 'stair-roof', unit: 'north', enabled: true });
    expect(rotationInfo(state, selection)).toMatchObject({ unit: 'north', angle: -90, pivot: [4.83, 4.655] });
  });

  it('reaches the roof floor while leaving both lower connections and the other dwelling intact', () => {
    const original = proposal();
    expect(resolveStairGeometry(original, 'north', 'first')).toBeNull();
    const state = applyCadCommand(original, { type: 'stair-roof', unit: 'north', enabled: true });
    const roof = resolveStairGeometry(state, 'north', 'first')!;
    const upper = resolveStairGeometry(original, 'north', 'ground')!;
    expect(roof).toMatchObject({ fromFloor: 'first', toFloor: 'roof', rise: 3.1, riserCount: 18 });
    expect(roof.footprint).toEqual(upper.footprint);
    expect(roof.parts.map(part => part.center)).toEqual(upper.parts.map(part => part.center));
    expect(state.buildings.north.stairPaths?.first).toEqual(original.buildings.north.stairPaths?.ground);
    expect(state.buildings.north.stairPaths?.first).not.toBe(original.buildings.north.stairPaths?.ground);
    expect(roof.parts.at(-1)!.bottom + roof.parts.at(-1)!.height + roof.topStepRise).toBeCloseTo(6.5);
    for (const floor of ['basement', 'ground'] as const) {
      expect(resolveStairGeometry(state, 'north', floor)).toEqual(resolveStairGeometry(original, 'north', floor));
    }
    expect(state.buildings.south).toBe(original.buildings.south);
    expect(state.design).toBe(original.design);
    expect(getFloorLevels('roof', state.buildings.north)?.elevation).toBe(6.5);
  });

  it('edits the roof connection independently and can disable it without dropping its settings', () => {
    const enabled = applyCadCommand(proposal(), { type: 'stair-roof', unit: 'north', enabled: true });
    const path = { ...enabled.buildings.north.stairPaths!.ground!, treadDepth: .25 };
    const edited = applyCadCommand(enabled, { type: 'stair-path', unit: 'north', fromFloor: 'first', path });
    expect(edited.buildings.north.stairPaths?.ground).toBe(enabled.buildings.north.stairPaths?.ground);
    expect(resolveStairGeometry(edited, 'north', 'first')?.footprint).not.toEqual(resolveStairGeometry(enabled, 'north', 'first')?.footprint);
    const disabled = applyCadCommand(edited, { type: 'stair-roof', unit: 'north', enabled: false });
    expect(resolveStairGeometry(disabled, 'north', 'first')).toBeNull();
    expect(disabled.buildings.north.stairPaths?.first).toEqual(path);
    expect(applyCadCommand(disabled, { type: 'stair-roof', unit: 'north', enabled: false })).toBe(disabled);
  });

  it('round-trips the independent roof connection while keeping legacy projects unchanged', () => {
    const original = proposal();
    const enabled = applyCadCommand(original, { type: 'stair-roof', unit: 'north', enabled: true });
    expect(parseProject(serializeProject(enabled))).toEqual(enabled);
    expect(parseProject(serializeProject(original))).toEqual(original);
    const edited = applyCadCommand(enabled, { type: 'stair-path', unit: 'north', fromFloor: 'ground',
      path: { ...enabled.buildings.north.stairPaths!.ground!, treadDepth: .26 } });
    expect(resolveStairGeometry(edited, 'north', 'first')).toEqual(resolveStairGeometry(enabled, 'north', 'first'));
  });

  it.each(['true', 1, null])('rejects a malformed roof switch %j without changing the project', value => {
    const original = proposal(), snapshot = serializeProject(original);
    const command = JSON.parse(JSON.stringify({ type: 'stair-roof', unit: 'north', enabled: value }));
    expect(() => applyCadCommand(original, command)).toThrow();
    const input = JSON.parse(snapshot);
    input.buildings.north.stairToRoof = value;
    expect(() => parseProject(JSON.stringify(input))).toThrow();
    expect(serializeProject(original)).toBe(snapshot);
  });

  it('rejects malformed roof paths and restores the basic roof template when a custom path is cleared', () => {
    const enabled = applyCadCommand(proposal(), { type: 'stair-roof', unit: 'north', enabled: true });
    const snapshot = serializeProject(enabled);
    expect(() => applyCadCommand(enabled, { type: 'stair-path', unit: 'north', fromFloor: 'first',
      path: { ...enabled.buildings.north.stairPaths!.first!, width: 0 } })).toThrow();
    const input = JSON.parse(snapshot);
    input.buildings.north.stairPaths.first.offset = [Infinity, 0];
    expect(() => parseProject(JSON.stringify(input))).toThrow();
    expect(serializeProject(enabled)).toBe(snapshot);
    const cleared = applyCadCommand(enabled, { type: 'stair-path', unit: 'north', fromFloor: 'first', path: null });
    expect(resolveStairGeometry(cleared, 'north', 'first')?.customPath).toBeUndefined();
    expect(cleared.buildings.north.stairPaths?.ground).toEqual(enabled.buildings.north.stairPaths?.ground);
  });

  it.each([{ enabled: false }, { storeys: 1 as const }, { roofEnabled: false }])('rejects an unavailable roof %j', settings => {
    const state = proposal();
    state.buildings.north = { ...state.buildings.north, ...settings, stairToRoof: true };
    expect(resolveStairGeometry(state, 'north', 'first')).toBeNull();
    expect(() => applyCadCommand(state, { type: 'stair-roof', unit: 'north', enabled: true })).toThrow();
  });
});