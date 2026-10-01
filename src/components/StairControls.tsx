import { resolveStairGeometry, type CadCommand, type StairGeometry } from '../model/cad';
import { planPoint } from '../model/plans';
import { FLOOR_NAMES, type SimulationState, type UnitId, type Vec2 } from '../model/types';
import { boundsOf, lengthText, pointsText, svgMatrix, type DisplayUnit } from '../lib/cadEditor';
import type { CadSelection } from '../lib/cadEditor';
import { rotatePlanPoint } from '../model/rotation';
import type { PointerEvent } from 'react';

export function StairPlan({ geometry, state, selection, onSelect, onBeginMove }: {
  geometry: StairGeometry; state: SimulationState; selection?: CadSelection | null; onSelect?: (selection: CadSelection) => void;
  onBeginMove?: (event: PointerEvent<SVGElement>, selection: CadSelection) => void;
}) {
  const map = (p: Vec2) => planPoint(p, geometry.unit, state);
  const target: CadSelection = { type: 'stair', id: `stair-${geometry.unit}-${geometry.fromFloor}` };
  const selected = selection?.type === 'stair' && selection.id === target.id;
  const first = geometry.parts[0], last = geometry.parts[17];
  const middle = geometry.parts.find(p => p.kind === 'landing');
  const local = (p: Vec2) => rotatePlanPoint(p, geometry.pivot, -geometry.rotation);
  const rotate = (p: Vec2) => rotatePlanPoint(p, geometry.pivot, geometry.rotation);
  const a = local(first.center), b = local(last.center), m = middle ? local(middle.center) : null;
  const direction = [first.center, ...(m ? [rotate([a[0], m[1]]), rotate([b[0], m[1]])] : []), last.center];
  const head = [rotate([b[0] - .13, b[1] + (geometry.layout === 'straight' ? .2 : -.2)]), last.center,
    rotate([b[0] + .13, b[1] + (geometry.layout === 'straight' ? .2 : -.2)])];
  return <g className={`cad-stair ${onSelect ? 'cad-stair-selectable' : ''} ${selected ? 'selected' : ''}`} transform={svgMatrix(map)}
    aria-hidden={onSelect ? undefined : true} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
    aria-label={onSelect ? `מדרגות ${FLOOR_NAMES[geometry.fromFloor]} אל ${FLOOR_NAMES[geometry.toFloor]}` : undefined}
    aria-pressed={onSelect ? selected : undefined} data-object-id={onSelect ? target.id : undefined}
    onPointerDown={onBeginMove ? event => onBeginMove(event, target) : onSelect ? event => { event.stopPropagation(); event.preventDefault(); onSelect(target); } : undefined}
    onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(target); } } : undefined}>
    {onSelect && <polygon points={pointsText(geometry.footprint)} className="cad-stair-hit" />}
    <polygon points={pointsText(geometry.footprint)} className="cad-stair-boundary" />
    {geometry.parts.map((part, index) => <rect key={index} x={part.center[0] - part.width / 2} y={part.center[1] - part.depth / 2} width={part.width} height={part.depth}
      transform={`rotate(${part.rotation ?? 0} ${part.center.join(' ')})`} />)}
    <path className="cad-stair-direction" d={`M${direction.map(p => p.join(',')).join(' L')}`} />
    <path d={`M${head.map(p => p.join(',')).join(' L')}`} />
  </g>;
}

/** Same scale, explicit connection. A per-unit command changes both available connections. */
export function StairControls({ state, unit, fromFloor, units = 'm', onCommand }: {
  state: SimulationState; unit: UnitId; fromFloor: 'basement' | 'ground'; units?: DisplayUnit;
  onCommand: (command: CadCommand, label: string) => void;
}) {
  const alternatives = (['straight', 'u-shaped'] as const).map(layout => {
    const preview = { ...state, buildings: { ...state.buildings, [unit]: { ...state.buildings[unit], stairLayout: layout } } };
    return { layout, preview, geometry: resolveStairGeometry(preview, unit, fromFloor) };
  });
  const bounds = boundsOf(alternatives.flatMap(a => a.geometry?.footprint.map(p => planPoint(p, unit, a.preview)) ?? []), .35);
  return <section className="cad-stair-controls" aria-label="חלופות מדרגות">
    <p>{FLOOR_NAMES[fromFloor]} ← {FLOOR_NAMES[fromFloor === 'basement' ? 'ground' : 'first']} · השינוי חל על שני החיבורים ביחידה</p>
    <div className="cad-stair-options">{alternatives.map(({ layout, preview, geometry }) => {
      const footprint = geometry?.footprint.map(p => planPoint(p, unit, preview));
      const width = footprint ? Math.hypot(footprint[1][0] - footprint[0][0], footprint[1][1] - footprint[0][1]) : 0;
      const depth = footprint ? Math.hypot(footprint[3][0] - footprint[0][0], footprint[3][1] - footprint[0][1]) : 0;
      return <button key={layout} type="button" disabled={!geometry} aria-pressed={state.buildings[unit].stairLayout === layout}
        onClick={() => onCommand({ type: 'stair', unit, layout }, 'שינוי חלופת מדרגות')}>
        <strong>{layout === 'straight' ? 'גרם ישר רציף' : 'מדרגות U'}</strong>
        <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} aria-hidden="true">{geometry && <StairPlan geometry={geometry} state={preview} />}</svg>
        {geometry ? <><bdi>{lengthText(width, units)} × {lengthText(depth, units)}</bdi><span>18 רומים · עלייה {lengthText(geometry.rise, units)}</span><span>רום {lengthText(geometry.rise / 18, units)}</span></> : <span>חיבור לא פעיל</span>}
      </button>;
    })}</div>
    <p className="warning-note">חלופות רעיוניות בלבד. הגרם הישר ארוך יותר ועלול לחצות חדרים וקירות; התאמה, התנגשות, מרווח ראש ותקן לא נבדקו.</p>
  </section>;
}