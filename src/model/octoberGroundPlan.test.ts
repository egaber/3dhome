import { describe, expect, it } from 'vitest';
import { applyCadCommand, getWallApertures } from './cad';
import { defaultState, resolvedFootprint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls } from './plans';
import { OCTOBER_FOOTPRINTS, OCTOBER_PLAN_ID, OCTOBER_SOURCE } from './octoberGroundPlan';
import { octoberProject, installOctoberAlternative } from '../lib/octoberAlternative';
import { createDesignLibrary } from '../lib/designLibrary';
import { parseProject, serializeProject } from '../lib/project';

describe('8 October calibrated ground-floor alternative', () => {
  it('uses the printed 11.45m clear width and actual PDF door/window gaps', () => {
    const state = octoberProject(), walls = resolvedWalls(state);
    expect(OCTOBER_SOURCE.walls).toHaveLength(28);
    expect(OCTOBER_SOURCE.pointsPerMetre).toBeCloseTo(28.406699901064414, 12);
    const north = walls.find(wall => wall.id === 'october-ground-1-north')!;
    expect(north.b[0] - north.a[0] - north.thickness * 2).toBeCloseTo(11.45, 6);
    expect(getWallApertures(north, state).map(opening => opening.width)).toEqual([3.2, 3.2, 3.2]);
    expect(resolvedOpenings(state).find(opening => opening.id === 'october-ground-3-north-opening-1')).toMatchObject({ kind: 'door', width: 1.2, sill: 0, open: false });
    expect(resolvedOpenings(state).find(opening => opening.id === 'october-ground-12-south-opening-0')).toMatchObject({ kind: 'door', width: 1.2 });
    const rooms = resolvedRooms(state);
    expect(rooms.find(room => room.id === 'october-north-safe')).toMatchObject({ width: 2.95, depth: 3.23 });
    expect(rooms.find(room => room.id === 'october-south-living')).toMatchObject({ width: 5.75, depth: 3.62 });
    expect(resolvedFootprint('ground', 'north', state)).toEqual(OCTOBER_FOOTPRINTS.north);
    expect(resolvedFootprint('ground', 'south', state)).toEqual(OCTOBER_FOOTPRINTS.south);
  });
  it('creates a separate library option without overwriting earlier edits, and reopens rather than reinstalls it', () => {
    const previous = defaultState(); previous.buildings.south.groundHeight = 4.1;
    const original = createDesignLibrary(previous, 'my-design', '2026-10-09T12:00:00Z'), before = structuredClone(original);
    const next = installOctoberAlternative(original, '2026-10-09T12:01:00Z');
    expect(original).toEqual(before); expect(next.options[0]).toBe(original.options[0]);
    expect(next.options).toHaveLength(2); expect(next.activeId).toBe(OCTOBER_PLAN_ID);
    next.options[1].project.minutes = 1000;
    const reopened = installOctoberAlternative(next, '2026-10-09T12:03:00Z');
    expect(reopened.options).toHaveLength(2); expect(reopened.options[1].project.minutes).toBe(1000);
    expect(parseProject(serializeProject(next.options[1].project))).toEqual(next.options[1].project);
  });
  it('keeps original walls and upstairs/basement data unchanged and isolates added ground furniture', () => {
    const original = defaultState(), state = octoberProject();
    expect(resolvedWalls(state).filter(wall => wall.floor !== 'ground')).toEqual(resolvedWalls(original).filter(wall => wall.floor !== 'ground'));
    expect(resolvedRooms(state).filter(room => room.floor !== 'ground')).toEqual(resolvedRooms(original).filter(room => room.floor !== 'ground'));
    expect(resolvedFurniture(state).filter(item => item.floor === 'ground').every(item => item.id.startsWith('october-'))).toBe(true);
    const next = applyCadCommand(state, { type: 'add-furniture', item: { id: 'october-new-chair', kind: 'chair', unit: 'north', floor: 'ground',
      center: [7, 4], width: .5, depth: .5, height: .8, rotation: 0, source: 'added' } });
    expect(next.design.addedFurniture[0].layout).toBe('october-ground');
    delete next.design.groundPlan;
    expect(resolvedFurniture(next).some(item => item.id === 'october-new-chair')).toBe(false);
    expect(() => parseProject(JSON.stringify({ ...state, design: { ...state.design, groundPlan: 'unknown' } }))).toThrow();
  });
});
