import { describe, expect, it } from 'vitest';
import { applyCadCommand } from '../model/cad';
import { defaultState } from '../model/plans';
import { octoberProject } from './octoberAlternative';
import { openingContext, openingLeaves } from './doorInteraction';
import { parseProject, serializeProject } from './project';

describe('door swing contracts', () => {
  it('opens the safe-room leaf into the room and reverses the exact mesh/collider orientation when edited', () => {
    const state = octoberProject(), id = 'october-ground-48-north-opening-0', context = openingContext(state, id)!;
    expect(context.opening.swing).toBe('negative');
    const [inside] = openingLeaves(context.opening, context.aperture);
    expect(inside.z).toBeLessThan(0); expect(inside.rotation).toBe(Math.PI / 2);
    const edited = applyCadCommand(state, { type: 'opening', id, patch: { swing: 'positive' } });
    const changed = openingContext(edited, id)!;
    const [outside] = openingLeaves(changed.opening, changed.aperture);
    expect(outside.z).toBe(-inside.z); expect(outside.rotation).toBe(-inside.rotation);
    expect(parseProject(serializeProject(edited))).toEqual(edited);
    expect(state.openings[id]).toBeUndefined();
  });
  it('preserves legacy files and rejects invalid swing values rather than silently guessing', () => {
    const original = defaultState();
    expect(parseProject(serializeProject(original))).toEqual(original);
    const state = octoberProject(), id = 'october-ground-48-north-opening-0';
    for (const swing of ['unknown', 1, null]) {
      expect(() => parseProject(JSON.stringify({ ...state, openings: { [id]: { swing } } }))).toThrow();
    }
    const context = openingContext(state, id)!;
    expect(openingLeaves({ ...context.opening, open: false, swing: 'negative' }, context.aperture))
      .toEqual(openingLeaves({ ...context.opening, open: false, swing: 'positive' }, context.aperture));
  });
});
