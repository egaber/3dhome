import { describe, expect, it, vi } from 'vitest';
import { defaultState, LEGACY_GROUND_WALLS, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls } from '../model/plans';
import { loadProject, parseProject, PROJECT_STORAGE_KEY, serializeProject } from './project';

describe('ground blueprint saved-project compatibility', () => {
  it('retains retired edits, additions, appearance and tombstones without rendering retired objects', () => {
    const state = defaultState();
    const wall = LEGACY_GROUND_WALLS.find(item => item.id === 'ground-wall-7-north')!;
    const opening = LEGACY_GROUND_WALLS.flatMap(item => item.openings).find(item => item.id === 'ground-wall-12-south-opening-0')!;
    expect(wall).toBeDefined();
    expect(opening).toBeDefined();
    state.design.wallEdits[wall.id] = { a: [1, 2], b: [3, 4], deleted: true };
    state.design.roomEdits['b-safe'] = { center: [10, 8], width: 3, depth: 2, deleted: false };
    state.design.furnitureEdits['b-safe-bed'] = { center: [10, 8], rotation: 45, deleted: true };
    state.openings[opening.id] = { width: 0, height: 0, wallId: opening.wallId, unit: opening.unit };
    state.addedOpenings = [{ ...opening, id: 'retired-custom-window', source: 'added' }];
    state.appearance = { images: [], models: { 'b-safe-bed': 'parametric' }, assignments: {
      [`wall-${wall.id}`]: { material: 'paint', metres: 1, roughness: .6 },
      [`opening-${opening.id}`]: { material: 'glass', metres: 1, roughness: .2 },
    } };
    const json = serializeProject(state);
    const restored = parseProject(json);
    expect(restored).toEqual(state);
    expect(resolvedWalls(restored).some(item => item.id === wall.id)).toBe(false);
    expect(resolvedRooms(restored).some(item => item.id === 'b-safe')).toBe(false);
    expect(resolvedFurniture(restored).some(item => item.id === 'b-safe-bed')).toBe(false);
    expect(resolvedOpenings(restored).some(item => item.id === opening.id || item.id === 'retired-custom-window')).toBe(false);
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => key === PROJECT_STORAGE_KEY ? json : null } });
    try { expect(loadProject()).toEqual(state); } finally { vi.unstubAllGlobals(); }
  });

  it('keeps arbitrary unknown records and invalid archived fields rejected', () => {
    const state = defaultState();
    state.design.roomEdits['b-safe'] = { center: [10, 8], width: -1, depth: 2, deleted: false };
    expect(() => serializeProject(state)).toThrow();
    state.design.roomEdits = { 'b-unknown': { center: [10, 8], width: 3, depth: 2, deleted: false } };
    expect(() => serializeProject(state)).toThrow();
    state.design.roomEdits = {};
    state.openings['ground-wall-12-south-opening-99'] = { width: 0 };
    expect(() => serializeProject(state)).toThrow();
  });
});