/** Display-plan metres only. SVG/camera units never enter the persisted model. */
import { applyCadCommand, inversePlanPoint, measureBetween, modelWorldPoint, getFloorLevels, resolveStairGeometry, type CadCommand } from '../model/cad';
import { stairSelection } from './cadRotation';
import { planPoint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls } from '../model/plans';
import type { FurnitureKind, FurnitureSpec, PlanWall, SimulationState, UnitId, FloorId, Vec2 } from '../model/types';
import type { Aperture } from './wallGeometry';

export type DisplayUnit = 'm' | 'mm';
export type CadSelection = { type: 'wall' | 'opening' | 'furniture' | 'room' | 'stair'; id: string };
export interface PlanView { x: number; y: number; width: number; height: number }
export const FURNITURE_NAMES: Record<FurnitureKind, string> = {
  bed: 'מיטה', sofa: 'ספה', 'coffee-table': 'שולחן סלון', 'dining-table': 'שולחן אוכל', chair: 'כיסא',
  'kitchen-unit': 'ארון מטבח', 'kitchen-island': 'אי מטבח', armchair: 'כורסה', sink: 'כיור מטבח',
  cooktop: 'כיריים', fridge: 'מקרר', dishwasher: 'מדיח', toilet: 'אסלה', basin: 'כיור רחצה', shower: 'מקלחון',
};
export const lengthText = (metres: number, units: DisplayUnit) => units === 'mm' ? `${(metres * 1000).toFixed(0)} מ״מ` : `${metres.toFixed(2)} מ׳`;
export const pointsText = (points: Vec2[]) => points.map(p => p.join(',')).join(' ');
export function snapPlan(point: Vec2, enabled: boolean): Vec2 {
  return point.map(value => enabled ? Math.round(value * 4) / 4 : Math.round(value * 100) / 100) as Vec2;
}
export function boundsOf(points: Vec2[], padding = 0): PlanView {
  if (!points.length || points.some(p => !p.every(Number.isFinite))) return { x: -1, y: -1, width: 14, height: 10 };
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = Math.min(...xs) - padding, y = Math.min(...ys) - padding;
  return { x, y, width: Math.max(.1, Math.max(...xs) + padding - x), height: Math.max(.1, Math.max(...ys) + padding - y) };
}
export function fitPlan(bounds: PlanView, aspect: number): PlanView {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const width = Math.max(bounds.width, bounds.height * ratio), height = width / ratio;
  return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + (bounds.height - height) / 2, width, height };
}
export function zoomPlan(view: PlanView, anchor: Vec2, factor: number): PlanView {
  if (!Number.isFinite(factor) || factor <= 0 || !anchor.every(Number.isFinite)) return view;
  const width = Math.max(.5, Math.min(500, view.width * factor)), scale = width / view.width;
  return { x: anchor[0] - (anchor[0] - view.x) * scale, y: anchor[1] - (anchor[1] - view.y) * scale, width, height: view.height * scale };
}
/** Affine map including anisotropic house scaling; works for rotated furniture too. */
export function svgMatrix(map: (p: Vec2) => Vec2): string {
  const p = map([0, 0]), x = map([1, 0]), y = map([0, 1]);
  return `matrix(${x[0] - p[0]} ${x[1] - p[1]} ${y[0] - p[0]} ${y[1] - p[1]} ${p[0]} ${p[1]})`;
}
export function wallLocalPoint(wall: PlanWall, along: number, across = 0): Vec2 {
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const dx = (wall.b[0] - wall.a[0]) / length, dz = (wall.b[1] - wall.a[1]) / length;
  return [wall.a[0] + dx * along - dz * across, wall.a[1] + dz * along + dx * across];
}
/** Complement of the UNION: overlapping openings never paint a solid pier over a hole. */
export function solidWallSpans(length: number, apertures: Aperture[]): [number, number][] {
  const spans: [number, number][] = [];
  let cursor = 0;
  for (const a of [...apertures].sort((a, b) => a.center - a.width / 2 - (b.center - b.width / 2))) {
    const left = Math.max(0, a.center - a.width / 2), right = Math.min(length, a.center + a.width / 2);
    if (left > cursor) spans.push([cursor, left]);
    cursor = Math.max(cursor, right);
  }
  if (cursor < length) spans.push([cursor, length]);
  return spans;
}
export function wallPolygon(wall: PlanWall, start: number, end: number, state: SimulationState): Vec2[] {
  return ([[start, -wall.thickness / 2], [end, -wall.thickness / 2], [end, wall.thickness / 2], [start, wall.thickness / 2]] as Vec2[])
    .map(([x, z]) => planPoint(wallLocalPoint(wall, x, z), wall.unit, state));
}
export function furniturePoint(item: FurnitureSpec, point: Vec2): Vec2 {
  const r = item.rotation * Math.PI / 180;
  return [item.center[0] + point[0] * Math.cos(r) - point[1] * Math.sin(r), item.center[1] + point[0] * Math.sin(r) + point[1] * Math.cos(r)];
}
export function furnitureScales(item: FurnitureSpec, state: SimulationState): Vec2 {
  const p = planPoint(item.center, item.unit, state);
  return ([[1, 0], [0, 1]] as Vec2[]).map(axis => {
    const q = planPoint(furniturePoint(item, axis), item.unit, state);
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  }) as Vec2;
}
export function planMeasurement(points: Vec2[], floor: FloorId, unit: UnitId, state: SimulationState) {
  const levels = getFloorLevels(floor, state.buildings[unit]);
  if (!levels || points.length !== 2) return null;
  return measureBetween(modelWorldPoint(inversePlanPoint(points[0], unit, state), levels.elevation, unit, state),
    modelWorldPoint(inversePlanPoint(points[1], unit, state), levels.elevation, unit, state));
}
export function geometryContext(state: SimulationState, unit: UnitId, floor: FloorId): string {
  return JSON.stringify([unit, floor, state.buildings, state.design, state.openings, state.addedOpenings, state.northBearing]);
}
const plus = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
/** Called with the gesture's immutable START state, never the previous preview. */
export function dragCommand(state: SimulationState, selection: CadSelection, start: Vec2, point: Vec2, snap: boolean, endpoint?: 'a' | 'b'): CadCommand | null {
  if (![...start, ...point].every(Number.isFinite)) return null;
  if (Math.hypot(point[0] - start[0], point[1] - start[1]) < 1e-8) return null;
  const delta: Vec2 = [point[0] - start[0], point[1] - start[1]];
  if (selection.type === 'stair') {
    const selected = stairSelection(selection);
    const stair = selected && resolveStairGeometry(state, selected.unit, selected.fromFloor);
    if (!selected || !stair) return null;
    const center = snapPlan(plus(planPoint(stair.pivot, selected.unit, state), delta), snap);
    return { type: 'stair-position', unit: selected.unit, position: inversePlanPoint(center, selected.unit, state) };
  }
  if (selection.type === 'wall') {
    const wall = resolvedWalls(state).find(w => w.id === selection.id);
    if (!wall) return null;
    const a = planPoint(wall.a, wall.unit, state), b = planPoint(wall.b, wall.unit, state);
    const anchor = snapPlan(plus(a, delta), snap), translation: Vec2 = [anchor[0] - a[0], anchor[1] - a[1]];
    return { type: 'wall', id: wall.id, edit: {
      a: endpoint === 'b' ? wall.a : inversePlanPoint(endpoint ? snapPlan(point, snap) : anchor, wall.unit, state),
      b: endpoint === 'a' ? wall.b : inversePlanPoint(endpoint ? snapPlan(point, snap) : plus(b, translation), wall.unit, state), deleted: false,
    } };
  }
  if (selection.type === 'opening') {
    const opening = resolvedOpenings(state).find(o => o.id === selection.id);
    const wall = resolvedWalls(state).find(w => w.id === opening?.wallId);
    if (!opening || !wall) return null;
    const a = planPoint(wall.a, wall.unit, state), b = planPoint(wall.b, wall.unit, state);
    const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const center = snapPlan([a[0] + d[0] * opening.position + delta[0], a[1] + d[1] * opening.position + delta[1]], snap);
    return { type: 'opening', id: opening.id, patch: { position: Math.max(0, Math.min(1, ((center[0] - a[0]) * d[0] + (center[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2))) } };
  }
  const item = selection.type === 'furniture' ? resolvedFurniture(state).find(i => i.id === selection.id) : resolvedRooms(state).find(i => i.id === selection.id);
  if (!item) return null;
  const center = inversePlanPoint(snapPlan(plus(planPoint(item.center, item.unit, state), delta), snap), item.unit, state);
  return selection.type === 'furniture' && 'height' in item
    ? { type: 'furniture', id: item.id, edit: { center, rotation: item.rotation, width: item.width, depth: item.depth, height: item.height, deleted: false } }
    : { type: 'room', id: item.id, edit: { center, width: item.width, depth: item.depth,
      ...(item.rotation !== undefined ? { rotation: item.rotation } : {}), deleted: false } };
}
/** Identity barrier prevents release after external change/undo from publishing an old snapshot. */
export function finishCadDrag(startState: SimulationState, currentState: SimulationState, command: CadCommand | null): SimulationState {
  return startState !== currentState || !command ? currentState : applyCadCommand(currentState, command);
}