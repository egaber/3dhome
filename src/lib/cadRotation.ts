import { resolveStairGeometry, type CadCommand } from '../model/cad';
import { number } from '../model/cadValidation';
import { resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls } from '../model/plans';
import { normalizeRotation, rotatePlanPoint } from '../model/rotation';
import type { SimulationState, UnitId, Vec2 } from '../model/types';
import type { CadSelection } from './cadEditor';

export interface RotationInfo { angle: number; pivot: Vec2; unit: UnitId; note: string }
export function stairSelection(selection: CadSelection): { unit: UnitId; fromFloor: 'basement' | 'ground' } | null {
  const match = selection.type === 'stair' ? /^stair-(north|south)-(basement|ground)$/.exec(selection.id) : null;
  return match ? { unit: match[1] as UnitId, fromFloor: match[2] as 'basement' | 'ground' } : null;
}

export function rotationInfo(state: SimulationState, selection: CadSelection): RotationInfo | null {
  const stair = stairSelection(selection);
  if (stair) {
    const geometry = resolveStairGeometry(state, stair.unit, stair.fromFloor);
    return geometry ? { angle: geometry.rotation, pivot: geometry.pivot, unit: stair.unit, note: 'גררו את המדרגות להזזה ואת הידית העגולה לסיבוב. שני החיבורים ופתחי הרצפות ביחידה משתנים יחד.' } : null;
  }
  if (selection.type === 'furniture' || selection.type === 'room') {
    const item = selection.type === 'furniture' ? resolvedFurniture(state).find(i => i.id === selection.id)
      : resolvedRooms(state).find(i => i.id === selection.id);
    return item ? { angle: item.rotation ?? 0, pivot: item.center, unit: item.unit, note: selection.type === 'room'
      ? 'סיבוב תחום החדר והריהוט שלא נערך בנפרד. הקירות אינם משויכים לחדר ואינם מסתובבים איתו.'
      : 'סיבוב הפריט סביב מרכזו; שאר הריהוט אינו משתנה.' } : null;
  }
  const hostId = selection.type === 'opening' ? resolvedOpenings(state).find(o => o.id === selection.id)?.wallId : selection.id;
  const wall = resolvedWalls(state).find(w => w.id === hostId);
  return wall ? {
    angle: normalizeRotation(Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0]) * 180 / Math.PI),
    unit: wall.unit,
    pivot: [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2],
    note: selection.type === 'opening' ? 'הפתח מחובר לקיר: הסיבוב חל על הקיר המארח ועל כל פתחיו יחד.' : 'סיבוב סביב אמצע הקיר, יחד עם כל הדלתות והחלונות המחוברים אליו.',
  } : null;
}

/** One existing model command, one shared undo step. Never mutate a selected seed. */
export function rotationCommand(state: SimulationState, selection: CadSelection, angle: number): CadCommand | null {
  const normalized = normalizeRotation(number(angle, 'rotation', -180, 180));
  const info = rotationInfo(state, selection);
  if (!info) throw new Error('יש לבחור אובייקט פעיל לסיבוב.');
  const delta = normalizeRotation(normalized - info.angle);
  if (Math.abs(delta) < 1e-9) return null;
  const stair = stairSelection(selection);
  if (stair) return { type: 'stair-rotation', unit: stair.unit, rotation: normalized };
  if (selection.type === 'furniture') {
    const item = resolvedFurniture(state).find(i => i.id === selection.id)!;
    const edit = state.design.furnitureEdits[item.id];
    return { type: 'furniture', id: item.id, edit: {
      ...(Object.hasOwn(state.design.furnitureEdits, item.id) ? edit : {}), center: [...item.center], rotation: normalized, deleted: false,
    } };
  }
  if (selection.type === 'room') {
    const room = resolvedRooms(state).find(r => r.id === selection.id)!;
    return { type: 'room', id: room.id, edit: { center: [...room.center], width: room.width, depth: room.depth, rotation: normalized, deleted: false } };
  }
  const hostId = selection.type === 'opening' ? resolvedOpenings(state).find(o => o.id === selection.id)!.wallId : selection.id;
  const wall = resolvedWalls(state).find(w => w.id === hostId)!;
  return { type: 'wall', id: wall.id, edit: { a: rotatePlanPoint(wall.a, info.pivot, delta), b: rotatePlanPoint(wall.b, info.pivot, delta), deleted: false } };
}

export function rotationShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing' | 'defaultPrevented'>, editable: boolean): number | null {
  if (editable || event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return null;
  return event.code === 'KeyR' || event.key.toLowerCase() === 'r' ? (event.shiftKey ? -15 : 15) : null;
}