import { describe, expect, it } from 'vitest';
import { defaultState, trueWorldPoint } from '../model/plans';
import { roomViewpoint, showroomProject, visitorPosition, worldToPlan } from './showroom';
import { surfaceTarget } from '../model/appearance';

describe('showroom geometry and material setup', () => {
  it('does not mutate the source or replace user material assignments', () => {
    const original = defaultState(), before = structuredClone(original);
    const next = showroomProject(original);
    expect(original).toEqual(before);
    expect(next.view).toMatchObject({ mode: 'walk', renderMode: 'realistic', planVisible: false, cutaway: 'none' });
    const floor = surfaceTarget('floor', 'north', 'ground');
    next.appearance!.assignments[floor].material = 'tile';
    expect(showroomProject(next).appearance!.assignments[floor].material).toBe('tile');
  });
  it.each([-180, -30, 0, 14.7, 90, 180])('minimap inverts true-north bearing %s', northBearing => {
    const state = { ...defaultState(), northBearing }, world = trueWorldPoint([3, 8], state);
    expect(worldToPlan(world, northBearing)[0]).toBeCloseTo(3, 10);
    expect(worldToPlan(world, northBearing)[1]).toBeCloseTo(8, 10);
    const target = trueWorldPoint([3, 6], state);
    const pose = visitorPosition({ position: [world[0], 5.02, world[1]], target: [target[0], 5.02, target[1]], up: [0, 1, 0] }, state, 'north');
    expect(pose.heading).toBeCloseTo(0);
    expect(pose.floor).toBe('first');
  });
  it('finds room views in the active plan and rejects nonexistent rooms', () => {
    expect(roomViewpoint(defaultState(), 'a-living')?.position[1]).toBe(1.62);
    expect(roomViewpoint(defaultState(), 'missing')).toBeNull();
  });
});
