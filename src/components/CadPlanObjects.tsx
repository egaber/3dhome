import type { PointerEvent as ReactPointerEvent } from 'react';
import { getWallApertures } from '../model/cad';
import { furnitureParts } from '../model/furnitureParts';
import { planPoint, resolvedOpenings } from '../model/plans';
import type { FurnitureSpec, PlanWall, SimulationState, Vec2 } from '../model/types';
import { FURNITURE_NAMES, furniturePoint, lengthText, pointsText, solidWallSpans, svgMatrix, wallLocalPoint, wallPolygon, type CadSelection, type DisplayUnit } from '../lib/cadEditor';
import { OPENING_NAMES } from './CadProperties';

export interface ObjectEvents {
  select: (selection: CadSelection) => void;
  begin: (event: ReactPointerEvent<SVGElement>, selection: CadSelection, endpoint?: 'a' | 'b') => void;
}
function keyboardSelect(event: React.KeyboardEvent<SVGGElement>, select: () => void) {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(); }
}
export function WallPlan({ wall, state, selection, hatchId, events, handleSize }: {
  wall: PlanWall; state: SimulationState; selection: CadSelection | null; hatchId: string; events: ObjectEvents; handleSize: number;
}) {
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const apertures = getWallApertures(wall, state), openings = resolvedOpenings(state).filter(o => o.wallId === wall.id);
  const selected = selection?.type === 'wall' && selection.id === wall.id;
  const target: CadSelection = { type: 'wall', id: wall.id };
  const select = () => events.select(target);
  const map = (p: Vec2) => planPoint(wallLocalPoint(wall, p[0], p[1]), wall.unit, state);
  return <>
    <g role="button" tabIndex={0} aria-label={`קיר ${wall.id}`} aria-pressed={selected} data-object-id={wall.id} onKeyDown={event => keyboardSelect(event, select)}>
      {solidWallSpans(length, apertures).map(([a, b], i) => <polygon key={i} points={pointsText(wallPolygon(wall, a, b, state))}
        fill={`url(#${hatchId})`} className={`editor-wall cad-wall-polygon ${selected ? 'selected' : ''}`}
        onPointerDown={event => events.begin(event, target)} />)}
      {/* Fully glazed hosts remain list selectable, without an invisible wall hit over the aperture. */}
      {selected && (['a', 'b'] as const).map(end => { const p = planPoint(wall[end], wall.unit, state); return <circle key={end}
        className="cad-endpoint" cx={p[0]} cy={p[1]} r={handleSize} onPointerDown={event => events.begin(event, target, end)} />; })}
    </g>
    {apertures.map(aperture => {
      const opening = openings.find(o => o.id === aperture.id)!;
      const start = aperture.center - aperture.width / 2, end = aperture.center + aperture.width / 2, t = wall.thickness;
      const next: CadSelection = { type: 'opening', id: aperture.id };
      return <g key={aperture.id} role="button" tabIndex={0} aria-label={`${OPENING_NAMES[opening.kind]} ${opening.label}`} data-object-id={opening.id}
        className={`cad-opening ${selection?.id === aperture.id ? 'selected' : ''}`} aria-pressed={selection?.id === aperture.id}
        transform={svgMatrix(map)} onKeyDown={event => keyboardSelect(event, () => events.select(next))} onPointerDown={event => events.begin(event, next)}>
        <rect className="cad-opening-hit" x={start} y={-t / 2} width={aperture.width} height={t} />
        <path d={`M${start},${-t / 2} V${t / 2} M${end},${-t / 2} V${t / 2}`} />
        {opening.kind === 'door' ? <>
          <path className="cad-door-swing" d={`M${end},0 A${aperture.width},${aperture.width} 0 0 0 ${start},${-aperture.width}`} />
          <path d={`M${start},0 V${-aperture.width}`} />
        </> : opening.kind !== 'void' ? <>
          <rect x={start} y={-t * .32} width={aperture.width} height={t * .64} />
          <path d={`M${start},0 H${end} M${aperture.center},${-t * .32} V${t * .32}`} />
          {opening.kind === 'glazing' && <path d={`M${start + aperture.width / 3},${-t * .32} V${t * .32} M${end - aperture.width / 3},${-t * .32} V${t * .32}`} />}
        </> : <path className="cad-door-swing" d={`M${start},0 H${end}`} />}
      </g>;
    })}
  </>;
}
export function FurniturePlan({ item, state, selection, events }: {
  item: FurnitureSpec; state: SimulationState; selection: CadSelection | null; events: ObjectEvents;
}) {
  const target: CadSelection = { type: 'furniture', id: item.id };
  return <g className={`cad-furniture ${selection?.id === item.id ? 'selected' : ''}`} data-object-id={item.id} data-kind={item.kind}
    role="button" tabIndex={0} aria-label={`${FURNITURE_NAMES[item.kind]} ${item.id}`} aria-pressed={selection?.id === item.id}
    transform={svgMatrix(p => planPoint(furniturePoint(item, p), item.unit, state))}
    onKeyDown={event => keyboardSelect(event, () => events.select(target))} onPointerDown={event => events.begin(event, target)}>
    <rect className="cad-furniture-hit" x={-item.width / 2} y={-item.depth / 2} width={item.width} height={item.depth} />
    {/* Line-only projection keeps table legs and independent overlaid appliances legible. */}
    {furnitureParts(item).map((part, i) => part.shape === 'cylinder'
      ? <ellipse key={i} cx={part.center[0]} cy={part.center[1]} rx={part.width / 2} ry={part.depth / 2} />
      : <rect key={i} x={part.center[0] - part.width / 2} y={part.center[1] - part.depth / 2} width={part.width} height={part.depth} />)}
  </g>;
}

/** Screen-legible labels, model-derived metric values. Omit short chain labels rather than pile them up. */
export function PlanDimension({ a, b, offset, textSize, units, overall = false }: { a: Vec2; b: Vec2; offset: number; textSize: number; units: DisplayUnit; overall?: boolean }) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  const n: Vec2 = [-dz / length, dx / length];
  const p: Vec2 = [a[0] + n[0] * offset, a[1] + n[1] * offset], q: Vec2 = [b[0] + n[0] * offset, b[1] + n[1] * offset];
  const label = lengthText(length, units), tick = textSize * .3;
  let angle = Math.atan2(dz, dx) * 180 / Math.PI;
  if (angle > 90) angle -= 180; if (angle < -90) angle += 180;
  return <g className="cad-dimension" aria-hidden="true">
    <path d={`M${a.join(',')} L${p.join(',')} M${b.join(',')} L${q.join(',')} M${p.join(',')} L${q.join(',')}
      M${p[0] - tick},${p[1] - tick} l${2 * tick},${2 * tick} M${q[0] - tick},${q[1] - tick} l${2 * tick},${2 * tick}`} />
    {(overall || length > textSize * label.length * .6) && <text x={(p[0] + q[0]) / 2} y={(p[1] + q[1]) / 2} style={{ fontSize: textSize }}
      transform={`rotate(${angle} ${(p[0] + q[0]) / 2} ${(p[1] + q[1]) / 2})`}>{label}</text>}
  </g>;
}
export function WallDimensions({ wall, state, textSize, units }: { wall: PlanWall; state: SimulationState; textSize: number; units: DisplayUnit }) {
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const edges = [...new Set([0, length, ...getWallApertures(wall, state).flatMap(a => [a.center - a.width / 2, a.center + a.width / 2])])].sort((a, b) => a - b);
  const p = (x: number) => planPoint(wallLocalPoint(wall, x), wall.unit, state);
  return <g data-testid="selected-dimensions">
    {edges.slice(1).map((edge, i) => <PlanDimension key={i} a={p(edges[i])} b={p(edge)} offset={-textSize * 3} textSize={textSize} units={units} />)}
    <PlanDimension a={p(0)} b={p(length)} offset={-textSize * 6} textSize={textSize} units={units} />
  </g>;
}