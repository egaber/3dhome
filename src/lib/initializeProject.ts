import type { SimulationState } from '../model/types';

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
  if (!completed.includes(MIGRATION_KEYS[0])) Object.assign(next.buildings.south, { roofEnabled: true, roofFloorHeight: 2.5, roofPeakHeight: 10.5 });
  return next;
}