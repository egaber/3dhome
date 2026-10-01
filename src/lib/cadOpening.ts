import { applyCadCommand, type OpeningPatch } from '../model/cad';
import type { SimulationState } from '../model/types';

/** Validate both steps before publishing anything to the sole app history. */
export function addCadOpening(state: SimulationState, id: string, wallId: string, patch: OpeningPatch = {}): SimulationState {
  const added = applyCadCommand(state, { type: 'add-window', id, wallId, position: .5 });
  return applyCadCommand(added, { type: 'opening', id, patch });
}