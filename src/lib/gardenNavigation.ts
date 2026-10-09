import { planPoint, trueWorldPoint } from '../model/plans';
import type { SimulationState, UnitId } from '../model/types';
import type { Viewpoint } from './showroom';
import type { WalkPose, WalkWorld } from './supportedWalk';
import { openingContext } from './doorInteraction';

export function gardenViewpoint(state: SimulationState, unit: UnitId): Viewpoint {
  const passage = unit === 'north' && state.design.groundPlan === 'october-2026'
    ? openingContext(state, 'october-ground-1-north-opening-1') : null;
  const entranceX = passage ? passage.local(passage.aperture.center + passage.aperture.width * .25, 0)[0] : 6;
  const position = trueWorldPoint(planPoint(unit === 'north' ? [entranceX, -3] : [7.5, 16.8], unit, state), state);
  const target = trueWorldPoint(planPoint(unit === 'north' ? [entranceX, 1.5] : [5, 14.2], unit, state), state);
  return { position: [position[0], state.view.eyeHeight, position[1]], target: [target[0], state.view.eyeHeight - .05, target[1]], up: [0, 1, 0], zoom: 1 };
}

export function isOutside(world: WalkWorld | null, pose: WalkPose | null): boolean {
  const support = world?.supports.find(support => support.id === pose?.supportId);
  return support?.kind === 'terrain' || support?.kind === 'grate';
}
