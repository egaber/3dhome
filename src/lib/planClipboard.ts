import { applyCadCommand } from '../model/cad';
import { emptyAppearance, type MaterialAssignment } from '../model/appearance';
import { resolvedFurniture, resolvedOpenings, resolvedWalls } from '../model/plans';
import type { FloorId, FurnitureSpec, OpeningSpec, PlanWall, SimulationState, UnitId, Vec2 } from '../model/types';
import { serializeProject } from './project';
import type { CadSelection } from './cadEditor';

export type PlanClipboard =
  | { type: 'furniture'; item: FurnitureSpec; material?: MaterialAssignment; model?: string }
  | { type: 'wall'; item: PlanWall; openings: OpeningSpec[]; material?: MaterialAssignment };

export function copyPlanObject(state: SimulationState, selection: CadSelection): PlanClipboard {
  if (selection.type === 'furniture') {
    const item = resolvedFurniture(state).find(item => item.id === selection.id);
    if (!item) throw new Error('הריהוט שנבחר אינו קיים.');
    return structuredClone({ type: 'furniture', item, material: state.appearance?.assignments[`furniture-${item.id}`], model: state.appearance?.models[item.id] });
  }
  if (selection.type === 'wall') {
    const item = resolvedWalls(state).find(wall => wall.id === selection.id);
    if (!item) throw new Error('הקיר שנבחר אינו קיים.');
    return structuredClone({ type: 'wall', item, openings: resolvedOpenings(state).filter(opening => opening.wallId === item.id && opening.width > 0 && opening.height > 0),
      material: state.appearance?.assignments[`wall-${item.id}`] });
  }
  throw new Error('העתקה והדבקה תומכות בריהוט ובקירות עם פתחיהם. לפתחים בודדים השתמשו בכפתור השכפול.');
}

export function pastePlanObject(state: SimulationState, clipboard: PlanClipboard, id: string, unit: UnitId, floor: FloorId, offset: Vec2 = [.5, .5]): { state: SimulationState; selection: CadSelection } {
  if (!offset.every(Number.isFinite)) throw new Error('מיקום ההדבקה אינו תקין.');
  let next: SimulationState;
  const move = (point: Vec2): Vec2 => [point[0] + offset[0], point[1] + offset[1]];
  if (clipboard.type === 'furniture') {
    const item: FurnitureSpec = { ...clipboard.item, id, unit, floor, center: move(clipboard.item.center), source: 'added' };
    delete item.layout;
    next = applyCadCommand(state, { type: 'add-furniture', item });
  } else {
    next = applyCadCommand(state, { type: 'add-wall', item: { id, sourceId: 'custom', unit, floor, a: move(clipboard.item.a), b: move(clipboard.item.b),
      thickness: clipboard.item.thickness, exterior: clipboard.item.exterior, retaining: false, openings: [] } });
    if (next.addedOpenings.length + clipboard.openings.length > 200) throw new Error('ההדבקה חורגת ממגבלת 200 פתחים.');
    next = { ...next, addedOpenings: [...next.addedOpenings, ...clipboard.openings.map((opening, index): OpeningSpec => ({
      ...opening, id: `${id}-opening-${index}`, wallId: id, unit, floor, source: 'added',
    }))] };
  }
  const appearance = next.appearance ?? emptyAppearance();
  if (clipboard.material || clipboard.type === 'furniture' && clipboard.model) next = { ...next, appearance: {
    ...appearance,
    assignments: clipboard.material ? { ...appearance.assignments, [`${clipboard.type}-${id}`]: { ...clipboard.material } } : appearance.assignments,
    models: clipboard.type === 'furniture' && clipboard.model ? { ...appearance.models, [id]: clipboard.model } : appearance.models,
  } };
  serializeProject(next);
  return { state: next, selection: { type: clipboard.type, id } };
}
