/** Annotation layout only: never changes model coordinates or stored geometry. */
import type { Vec2 } from '../model/types';
import type { PlanView } from './cadEditor';

export interface AnnotationGutters { left: number; right: number; top: number; bottom: number }
export function dimensionGutters(points: Vec2[]): AnnotationGutters {
  const gutters = { left: 12, right: 12, top: 12, bottom: 12 };
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
    if (dy < -1e-6) gutters.right = 56; if (dy > 1e-6) gutters.left = 56;
    if (dx > 1e-6) gutters.bottom = 56; if (dx < -1e-6) gutters.top = 56;
  }
  return gutters;
}
export function fitAnnotatedPlan(bounds: PlanView, width: number, height: number, margin: number | AnnotationGutters = 56): PlanView {
  const w = Number.isFinite(width) && width > 0 ? width : 800;
  const h = Number.isFinite(height) && height > 0 ? height : 600;
  // Overall dimensions sit 36px outside geometry, plus ticks, text and breathing room.
  // Selected wall chains can request a larger (88px) gutter for their second tier.
  const safe = (n: number) => Number.isFinite(n) && n >= 0 ? n : 56;
  const g = typeof margin === 'number' ? { left: margin, right: margin, top: margin, bottom: margin } : margin;
  const left = safe(g.left), right = safe(g.right), top = safe(g.top), bottom = safe(g.bottom);
  const scale = Math.max(bounds.width / Math.max(1, w - left - right), bounds.height / Math.max(1, h - top - bottom));
  return { x: bounds.x + (bounds.width - scale * (w + left - right)) / 2, y: bounds.y + (bounds.height - scale * (h + top - bottom)) / 2,
    width: scale * w, height: scale * h };
}

/** Cull crowded labels, including selected labels; full names remain in properties/list.
 * All values are display-plan units, including the screen-derived text envelope. */
export function roomLabelFits(center: Vec2, room: Vec2[], obstacles: PlanView[], textWidth: number, textHeight: number): boolean {
  if (room.length < 3 || ![...center, textWidth, textHeight, ...room.flat()].every(Number.isFinite) || textWidth <= 0 || textHeight <= 0) return false;
  const box = { x: center[0] - textWidth / 2, y: center[1] - textHeight / 2, width: textWidth, height: textHeight };
  const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]];
  const inside = corners.every(p => {
    const cross = room.map((a, i) => { const b = room[(i + 1) % room.length]; return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); });
    return cross.every(n => n >= 0) || cross.every(n => n <= 0);
  });
  return inside && !obstacles.some(o => box.x < o.x + o.width && box.x + box.width > o.x && box.y < o.y + o.height && box.y + box.height > o.y);
}