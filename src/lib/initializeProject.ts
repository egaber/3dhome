import type { OpeningSpec, SimulationState } from '../model/types';

export const MIGRATION_KEYS = ['dori-south-attic-v1', 'dori-south-east-room-windows-v1', 'dori-north-corner-glazing-v1'] as const;
export type MigrationKey = typeof MIGRATION_KEYS[number];

/** Pure startup migration. Explicit tombstones beat EVERY default/facade migration,
 * even in fresh storage after import. Never consume more than 200 addition slots. */
export function initializeProject(state: SimulationState, completed: readonly MigrationKey[] = []): SimulationState {
  const next: SimulationState = { ...state, buildings: { ...state.buildings, south: { ...state.buildings.south } },
    openings: { ...state.openings }, addedOpenings: [...state.addedOpenings] };
  // Imported added-record tombstones also win over old positive facade overrides.
  // Preserve both records and all unrelated fields rather than removing either.
  for (const opening of next.addedOpenings) {
    const override = next.openings[opening.id];
    if (!override) continue;
    for (const key of ['width', 'height'] as const) if (opening[key] === 0 && override[key] !== undefined && override[key] !== 0) {
      next.openings[opening.id] = { ...next.openings[opening.id], [key]: 0 };
    }
  }
  const deleted = (id: string) => [next.openings[id], next.addedOpenings.find(o => o.id === id)]
    .some(o => o?.width === 0 || o?.height === 0);
  const patch = (id: string, value: Partial<OpeningSpec>, force = false) => {
    if (!deleted(id) && (force || !next.openings[id])) next.openings[id] = { ...next.openings[id], ...value };
  };
  const add = (opening: OpeningSpec) => {
    if (!deleted(opening.id) && next.addedOpenings.length < 200 && !next.addedOpenings.some(o => o.id === opening.id)) next.addedOpenings.push(opening);
  };
  if (!completed.includes(MIGRATION_KEYS[0])) Object.assign(next.buildings.south, { roofEnabled: true, roofFloorHeight: 2.5, roofPeakHeight: 10.5 });
  const eastId = 'ground-wall-12-south-opening-0';
  patch(eastId, { kind: 'window', width: 1.4, height: 1.35, sill: .95, label: 'חלון מזרחי · החדר הסמוך לבית הצפוני' }, !completed.includes(MIGRATION_KEYS[1]));
  add({ id: 'added-south-room-south-window', wallId: 'ground-wall-13-south',
    label: 'חלון דרומי גדול · החדר המזרחי', unit: 'south', floor: 'ground', kind: 'window',
    position: .5, width: 1.8, height: 1.5, sill: .8, open: false, shutter: false, overhang: 0, source: 'added' });
  const northEastId = 'added-north-east-glazing';
  add({ id: northEastId, wallId: 'ground-wall-2-north', label: 'ויטרינה מזרחית · הבית הצפוני', unit: 'north', floor: 'ground',
    kind: 'glazing', position: .5, width: 4, height: 2.5, sill: 0, open: false, shutter: false, overhang: 0, source: 'added' });
  if (next.addedOpenings.some(o => o.id === northEastId)) patch(northEastId, { width: 4, position: .5, height: 2.65, sill: 0 }, !completed.includes(MIGRATION_KEYS[2]));
  for (const [index, width] of [[0, 3.45], [1, 3.45], [2, 3.55]] as const) {
    patch(`ground-wall-0-north-opening-${index}`, { kind: 'glazing', width, height: 2.65, sill: 0 }, !completed.includes(MIGRATION_KEYS[2]));
  }
  return next;
}