import { defaultState } from '../model/plans';
import { OCTOBER_PLAN_ID, OCTOBER_PLAN_NAME } from '../model/octoberGroundPlan';
import { showroomProject } from './showroom';
import { activateDesign, duplicateDesign, type DesignLibrary } from './designLibrary';

export function octoberProject() {
  const state = defaultState();
  state.design.groundPlan = 'october-2026';
  state.date = '2026-10-08'; state.minutes = 660;
  state.buildings.north.stairRotation = 180;
  return showroomProject(state);
}

export function installOctoberAlternative(library: DesignLibrary, now: string): DesignLibrary {
  const existing = library.options.find(option => option.id === OCTOBER_PLAN_ID);
  return existing ? activateDesign(library, existing.id)
    : duplicateDesign(library, octoberProject(), OCTOBER_PLAN_NAME, OCTOBER_PLAN_ID, now);
}
