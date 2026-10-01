import { inversePlanPoint, resolveStairGeometry, type CadCommand } from '../model/cad';
import { planPoint, resolvedFurniture, resolvedOpenings, resolvedRooms, resolvedWalls } from '../model/plans';
import { normalizeRotation, rotatePlanPoint } from '../model/rotation';
import type { SimulationState, Vec2 } from '../model/types';
import { rotationCommand, rotationInfo, stairSelection } from './cadRotation';
import type { CadSelection, PlanView } from './cadEditor';

export interface SelectionFrame { outline: Vec2[]; pivot: Vec2; anchor: Vec2; outward: Vec2; angle: number }

/** Selection geometry in displayed plan coordinates; the same affine map as SVG/3D. */
export function selectionFrame(state: SimulationState, selection: CadSelection): SelectionFrame | null {
  const info = rotationInfo(state, selection);
  if (!info) return null;
  let local: Vec2[];
  const stair = stairSelection(selection);
  if (stair) local = resolveStairGeometry(state, stair.unit, stair.fromFloor)!.footprint;
  else if (selection.type === 'furniture' || selection.type === 'room') {
    const item = selection.type === 'furniture' ? resolvedFurniture(state).find(i => i.id === selection.id)!
      : resolvedRooms(state).find(i => i.id === selection.id)!;
    local = ([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]] as Vec2[]).map(([x, z]) =>
      rotatePlanPoint([item.center[0] + x * item.width, item.center[1] + z * item.depth], item.center, info.angle));
  } else {
    const id = selection.type === 'opening' ? resolvedOpenings(state).find(o => o.id === selection.id)!.wallId : selection.id;
    const wall = resolvedWalls(state).find(w => w.id === id)!;
    const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const normal: Vec2 = [-(wall.b[1] - wall.a[1]) / length * wall.thickness / 2, (wall.b[0] - wall.a[0]) / length * wall.thickness / 2];
    local = [[wall.a[0] - normal[0], wall.a[1] - normal[1]], [wall.b[0] - normal[0], wall.b[1] - normal[1]],
      [wall.b[0] + normal[0], wall.b[1] + normal[1]], [wall.a[0] + normal[0], wall.a[1] + normal[1]]];
  }
  const outline = local.map(p => planPoint(p, info.unit, state));
  const anchor: Vec2 = [(outline[0][0] + outline[1][0]) / 2, (outline[0][1] + outline[1][1]) / 2];
  const offset: Vec2 = [(local[0][0] + local[1][0]) / 2, (local[0][1] + local[1][1]) / 2];
  const direction = rotatePlanPoint([0, -1], [0, 0], info.angle);
  const outer = planPoint([offset[0] + direction[0], offset[1] + direction[1]], info.unit, state);
  return { outline, anchor, pivot: planPoint(info.pivot, info.unit, state), outward: [outer[0] - anchor[0], outer[1] - anchor[1]], angle: info.angle };
}

/** Constant 44px target and 38px stem, including zoomed or non-square SVG views. */
export function rotationHandlePoint(frame: SelectionFrame, view: PlanView, pixels: Vec2): Vec2 {
  const xUnit = view.width / Math.max(1, pixels[0]), yUnit = view.height / Math.max(1, pixels[1]);
  const dx = frame.outward[0] / xUnit, dy = frame.outward[1] / yUnit, length = Math.hypot(dx, dy) || 1;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  return [clamp(frame.anchor[0] + dx / length * 38 * xUnit, view.x + 24 * xUnit, view.x + view.width - 24 * xUnit),
    clamp(frame.anchor[1] + dy / length * 38 * yUnit, view.y + 24 * yUnit, view.y + view.height - 24 * yUnit)];
}

/** Always evaluate against the immutable pointer-down state, not the last preview.
 * Inverse dwelling transforms avoid reversed/jumping handles on rotated/scaled units. */
export function rotationDragCommand(state: SimulationState, selection: CadSelection, start: Vec2, point: Vec2, snapAngle: boolean): CadCommand | null {
  if (![...start, ...point].every(Number.isFinite)) return null;
  const info = rotationInfo(state, selection);
  if (!info) return null;
  const a = inversePlanPoint(start, info.unit, state), b = inversePlanPoint(point, info.unit, state);
  const offset = (p: Vec2): Vec2 => [p[0] - info.pivot[0], p[1] - info.pivot[1]];
  const from = offset(a), to = offset(b);
  if (Math.hypot(...from) < 1e-6 || Math.hypot(...to) < 1e-6) return null;
  const delta = normalizeRotation((Math.atan2(to[1], to[0]) - Math.atan2(from[1], from[0])) * 180 / Math.PI);
  let angle = normalizeRotation(info.angle + delta);
  if (snapAngle) angle = normalizeRotation(Math.round(angle / 15) * 15);
  return rotationCommand(state, selection, angle);
}