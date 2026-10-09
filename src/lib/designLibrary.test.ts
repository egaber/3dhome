import { describe, expect, it } from 'vitest';
import { defaultState } from '../model/plans';
import { activateDesign, createDesignLibrary, DESIGN_LIBRARY_KEY, duplicateDesign, mergeDesignLibrary, parseDesignLibrary, removeDesign, storeDesignLibrary, updateDesign } from './designLibrary';

const now = '2026-10-09T07:00:00.000Z';
describe('independent persistent home alternatives', () => {
  it('copies complete projects without mutating or sharing the original design', () => {
    const original = createDesignLibrary(defaultState(), 'original', now);
    const next = duplicateDesign(original, original.options[0].project, '  Warm oak  ', 'oak', now);
    next.options[1].project.buildings.north.groundHeight = 4;
    expect(original.options).toHaveLength(1);
    expect(next.options[0].project.buildings.north.groundHeight).toBe(3.4);
    expect(next.options[1].name).toBe('Warm oak');
    const edited = updateDesign(next, next.options[1].project, now);
    expect(parseDesignLibrary(JSON.stringify(activateDesign(edited, 'original'))).activeId).toBe('original');
    expect(edited.options[1].project.buildings.north.groundHeight).toBe(4);
  });
  it('uses one atomic key and rejects stale-tab overwrites', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const saved = storeDesignLibrary(storage, createDesignLibrary(defaultState(), 'original', now), null);
    const next = storeDesignLibrary(storage, duplicateDesign(saved, defaultState(), 'Copy', 'copy', now), saved.revision);
    expect(values.size).toBe(1);
    expect(parseDesignLibrary(values.get(DESIGN_LIBRARY_KEY)!).activeId).toBe('copy');
    expect(() => storeDesignLibrary(storage, saved, saved.revision)).toThrow('לשונית אחרת');
    expect(parseDesignLibrary(values.get(DESIGN_LIBRARY_KEY)!)).toEqual(next);
  });
  it('does not destroy corrupt storage or report quota errors as success', () => {
    const original = createDesignLibrary(defaultState(), 'original', now);
    let written = false;
    expect(() => storeDesignLibrary({ getItem: () => '{invalid', setItem: () => { written = true; } }, original, null)).toThrow();
    expect(written).toBe(false);
    expect(() => storeDesignLibrary({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, original, null)).toThrow('quota');
  });
  it('rejects invalid names, duplicate IDs, missing active records and malformed models', () => {
    const original = createDesignLibrary(defaultState(), 'original', now);
    expect(() => duplicateDesign(original, defaultState(), ' ', 'copy', now)).toThrow();
    expect(() => duplicateDesign(original, defaultState(), 'Copy', 'original', now)).toThrow();
    expect(() => activateDesign(original, 'missing')).toThrow();
    expect(() => removeDesign(original, 'original')).toThrow();
    expect(() => parseDesignLibrary(JSON.stringify({ ...original, activeId: 'missing' }))).toThrow();
    const broken = structuredClone(original); broken.options[0].project.buildings.north.width = -1;
    expect(() => parseDesignLibrary(JSON.stringify(broken))).toThrow();
  });
  it('imports every archived alternative with fresh identities and no overwrite of existing work', () => {
    const existing = createDesignLibrary(defaultState(), 'existing', now);
    const archive = duplicateDesign(createDesignLibrary(defaultState(), 'source', now), { ...defaultState(), minutes: 900 }, 'Evening', 'evening', now);
    const imported = mergeDesignLibrary(existing, archive, ['restored-source', 'restored-evening'], now);
    expect(imported.options).toHaveLength(3);
    expect(imported.activeId).toBe('restored-evening');
    expect(imported.options[0]).toBe(existing.options[0]);
    expect(imported.options[2].project.minutes).toBe(900);
    expect(existing.options).toHaveLength(1);
    expect(() => mergeDesignLibrary(existing, archive, ['existing', 'duplicate'], now)).toThrow();
  });
});
