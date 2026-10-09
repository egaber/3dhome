import { DEFAULT_STAIR_PATH } from './stairPath';
import type { SimulationState } from './types';

export function northEntranceStairProposal(state: SimulationState): SimulationState {
  return { ...state, buildings: { ...state.buildings, north: { ...state.buildings.north,
    stairLayout: 'straight', stairPosition: [4.83, 4.655], stairRotation: -90, stairScale: 1, stairEnabled: true,
    stairRailing: true, stairOpeningGlass: true,
    stairPaths: {
      ground: { ...DEFAULT_STAIR_PATH, landingAfter: 7, landingDepth: .92, treadDepth: .24,
        secondLanding: { turn: 'right', landingAfter: 11, landingDepth: .92 } },
      basement: { ...DEFAULT_STAIR_PATH, turn: 'straight', landingAfter: 9, landingDepth: .92, treadDepth: .25,
        rotation: 90, offset: [.3, .39] },
    },
  } } };
}