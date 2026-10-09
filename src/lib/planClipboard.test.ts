import { describe, expect, it } from 'vitest';
import { applyCadCommand } from '../model/cad';
import { defaultState, resolvedFurniture, resolvedWalls, resolvedOpenings } from '../model/plans';
import { parseProject, serializeProject } from './project';
import { copyPlanObject, pastePlanObject } from './planClipboard';

describe('editable wall and furniture clipboard', () => {
  it('pastes a furniture snapshot after the source changes without aliasing its geometry', () => {
    const state = defaultState(), item = resolvedFurniture(state)[0];
    const clipboard = copyPlanObject(state, { type: 'furniture', id: item.id });
    const deleted = applyCadCommand(state, { type: 'furniture', id: item.id, edit: { center: item.center, rotation: item.rotation, deleted: true } });
    const pasted = pastePlanObject(deleted, clipboard, 'paste-sofa', item.unit, item.floor);
    expect(resolvedFurniture(pasted.state).find(item => item.id === 'paste-sofa')?.center).toEqual([item.center[0] + .5, item.center[1] + .5]);
    expect(parseProject(serializeProject(pasted.state))).toEqual(pasted.state);
    expect(resolvedFurniture(deleted).some(item => item.id === 'paste-sofa')).toBe(false);
  });
  it('copies a wall with its hosted openings into independent editable IDs', () => {
    const state = defaultState(), wall = resolvedWalls(state).find(wall => wall.openings.length)!;
    const clipboard = copyPlanObject(state, { type: 'wall', id: wall.id });
    const { state: next } = pastePlanObject(state, clipboard, 'copied-wall', wall.unit, wall.floor, [1, 0]);
    expect(resolvedWalls(next).find(wall => wall.id === 'copied-wall')?.a).toEqual([wall.a[0] + 1, wall.a[1]]);
    expect(resolvedOpenings(next).filter(opening => opening.wallId === 'copied-wall')).toHaveLength(wall.openings.length);
    expect(parseProject(serializeProject(next))).toEqual(next);
    expect(() => pastePlanObject(next, clipboard, 'copied-wall', wall.unit, wall.floor)).toThrow();
  });
  it('rejects unavailable floors and invalid/unsupported selections without changing the source', () => {
    const state = defaultState(), before = serializeProject(state);
    expect(() => copyPlanObject(state, { type: 'room', id: 'a-living' })).toThrow();
    expect(() => copyPlanObject(state, { type: 'wall', id: 'missing' })).toThrow();
    const clip = copyPlanObject(state, { type: 'wall', id: resolvedWalls(state)[0].id });
    const disabled = { ...state, buildings: { ...state.buildings, south: { ...state.buildings.south, enabled: false } } };
    expect(() => pastePlanObject(disabled, clip, 'paste', 'south', 'ground')).toThrow();
    expect(serializeProject(state)).toBe(before);
  });
});
