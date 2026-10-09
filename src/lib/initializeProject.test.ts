import { describe, expect, it } from 'vitest';
import { initializeProject, MIGRATION_KEYS } from './initializeProject';
import { parseProject, serializeProject } from './project';
import { applyCadCommand } from '../model/cad';
import { defaultState, resolvedOpenings } from '../model/plans';
import { addCadOpening } from './cadOpening';

function legacyProject() {
  const state = initializeProject(defaultState());
  state.addedOpenings = [
    { id: 'added-north-east-glazing', wallId: 'ground-wall-2-north', label: 'legacy glazing', unit: 'north', floor: 'ground',
      kind: 'glazing', position: .5, width: 4, height: 2.65, sill: 0, open: false, shutter: false, overhang: 0, source: 'added' },
    { id: 'added-south-room-south-window', wallId: 'ground-wall-13-south', label: 'legacy window', unit: 'south', floor: 'ground',
      kind: 'window', position: .5, width: 1.8, height: 1.5, sill: .8, open: false, shutter: false, overhang: 0, source: 'added' },
  ];
  return state;
}

describe('startup migration deletion safety', () => {
  for (const key of ['width', 'height'] as const) it(`preserves explicit zero ${key} in overrides on fresh import/reload`, () => {
    const s = legacyProject();
    const ids = ['ground-wall-12-north-opening-0', 'added-south-room-south-window', 'added-north-east-glazing', ...[0, 1, 2].map(i => `ground-wall-0-north-opening-${i}`)];
    for (const id of ids) s.openings[id] = { ...s.openings[id], [key]: 0 };
    const before = serializeProject(s), imported = parseProject(before);
    const migrated = initializeProject(imported); // No migration flags on a new device.
    for (const id of ids) expect(resolvedOpenings(migrated).find(o => o.id === id)?.[key]).toBe(0);
    expect(migrated.addedOpenings).toEqual(s.addedOpenings); expect(serializeProject(s)).toBe(before);
    expect(parseProject(serializeProject(migrated))).toEqual(migrated);
  });
  for (const key of ['width', 'height'] as const) it(`never writes a positive override over an added-record ${key} tombstone`, () => {
    const s = legacyProject();
    for (const o of s.addedOpenings) { o[key] = 0; delete s.openings[o.id]; }
    const next = initializeProject(parseProject(serializeProject(s)));
    for (const o of s.addedOpenings) {
      expect(next.openings[o.id]).toBeUndefined();
      expect(resolvedOpenings(next).find(item => item.id === o.id)?.[key]).toBe(0);
    }
  });
  it('retains tombstone records for CAD deletion of base and added windows', () => {
    let s = legacyProject(); const count = s.addedOpenings.length;
    for (const id of ['added-north-east-glazing', 'ground-wall-0-north-opening-0']) s = applyCadCommand(s, { type: 'delete-opening', id });
    s = initializeProject(parseProject(serializeProject(s)));
    expect(s.addedOpenings).toHaveLength(count);
    expect(s.openings['added-north-east-glazing'].width).toBe(0); expect(s.openings['ground-wall-0-north-opening-0'].height).toBe(0);
  });
  it('an added-record tombstone wins over a conflicting legacy facade override', () => {
    const s = legacyProject();
    s.addedOpenings.find(o => o.id === 'added-north-east-glazing')!.height = 0;
    s.openings['added-north-east-glazing'] = { width: 4, height: 2.65, overhang: .8 };
    const next = initializeProject(parseProject(serializeProject(s)), MIGRATION_KEYS);
    expect(resolvedOpenings(next).find(o => o.id === 'added-north-east-glazing')?.height).toBe(0);
    expect(next.openings['added-north-east-glazing'].overhang).toBe(.8);
    expect(s.openings['added-north-east-glazing'].height).toBe(2.65);
  });
  it('does not exceed 200 additions or create an override without its record', () => {
    const s = defaultState(), seed = legacyProject().addedOpenings[0];
    s.addedOpenings = Array.from({ length: 200 }, (_, i) => ({ ...seed, id: `full-${i}` }));
    const next = initializeProject(s);
    expect(next.addedOpenings).toHaveLength(200); expect(next.openings['added-north-east-glazing']).toBeUndefined();
    expect(() => serializeProject(next)).not.toThrow();
  });
  it('preserves completed migrations, other overrides, stair transforms and caller state', () => {
    const s = legacyProject(); s.buildings.south.roofEnabled = false;
    s.buildings.north.stairRotation = 65; s.buildings.north.stairPosition = [20, -10];
    s.openings['added-north-east-glazing'] = { width: 2, label: 'custom', overhang: .6 };
    const before = serializeProject(s), next = initializeProject(s, MIGRATION_KEYS);
    expect(serializeProject(next)).toBe(before); expect(serializeProject(s)).toBe(before);
  });
});
describe('atomic active-host opening creation', () => {
  it('creates a selected kind using CAD and rejects a deleted host/invalid patch without publication', () => {
    const s = defaultState(), before = serializeProject(s), wallId = 'ground-wall-2-north';
    const next = addCadOpening(s, 'new-door', wallId, { kind: 'door', sill: 0, height: 2.3 });
    expect(resolvedOpenings(next).find(o => o.id === 'new-door')).toMatchObject({ kind: 'door', sill: 0, height: 2.3 });
    expect(() => addCadOpening(s, 'bad', wallId, { height: NaN })).toThrow();
    expect(serializeProject(s)).toBe(before);
    s.design.wallEdits[wallId] = { a: [0, 0], b: [2, 0], deleted: true };
    expect(() => addCadOpening(s, 'bad', wallId)).toThrow();
    s.buildings.north.firstFloorVariant = 'open-plan';
    expect(() => addCadOpening(s, 'bad', 'first-wall-0-north')).toThrow();
  });
});