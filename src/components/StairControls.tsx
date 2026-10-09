import { resolveStairGeometry, stairPartOrder, type CadCommand, type StairGeometry } from '../model/cad';
import { planPoint } from '../model/plans';
import { LEVEL_NAMES, type FloorId, type SimulationState, type StairPathSettings, type UnitId, type Vec2 } from '../model/types';
import { boundsOf, lengthText, pointsText, svgMatrix, type DisplayUnit } from '../lib/cadEditor';
import type { CadSelection } from '../lib/cadEditor';
import { rotatePlanPoint } from '../model/rotation';
import { useEffect, useState, type PointerEvent } from 'react';
import { ArrowDownUp, ArrowUp, CornerUpLeft, CornerUpRight } from 'lucide-react';
import { DEFAULT_STAIR_PATH, parseStairPath, reverseStairPath } from '../model/stairPath';
import { stairOpeningEdges, stairRailEdges } from '../model/stairSafety';
import { NumericDraftForm } from './CadFields';
import { Button } from './ui/button';
import './stairControls.css';

export function StairPlan({ geometry, state, selection, onSelect, onBeginMove }: {
  geometry: StairGeometry; state: SimulationState; selection?: CadSelection | null; onSelect?: (selection: CadSelection) => void;
  onBeginMove?: (event: PointerEvent<SVGElement>, selection: CadSelection) => void;
}) {
  const map = (p: Vec2) => planPoint(p, geometry.unit, state);
  const target: CadSelection = { type: 'stair', id: `stair-${geometry.unit}-${geometry.fromFloor}` };
  const selected = selection?.type === 'stair' && selection.id === target.id;
  const ordered = stairPartOrder(geometry).map(index => geometry.parts[index]);
  const last = ordered.at(-1)!, previous = ordered.at(-2)!;
  const direction = ordered.map(part => part.center);
  const angle = Math.atan2(last.center[1] - previous.center[1], last.center[0] - previous.center[0]) * 180 / Math.PI;
  const head = [rotatePlanPoint([last.center[0] - .2, last.center[1] - .13], last.center, angle), last.center,
    rotatePlanPoint([last.center[0] - .2, last.center[1] + .13], last.center, angle)];
  const building = state.buildings[geometry.unit];
  const rails = (building.stairRailing ?? (geometry.unit === 'south' && building.southLayout === 'family')) ? stairRailEdges(geometry) : [];
  const glass = building.stairOpeningGlass ? stairOpeningEdges(geometry,
    geometry.toFloor === 'roof' ? null : resolveStairGeometry(state, geometry.unit, geometry.toFloor)) : [];
  return <g className={`cad-stair ${onSelect ? 'cad-stair-selectable' : ''} ${selected ? 'selected' : ''}`} transform={svgMatrix(map)}
    aria-hidden={onSelect ? undefined : true} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
    aria-label={onSelect ? `מדרגות ${LEVEL_NAMES[geometry.fromFloor]} אל ${LEVEL_NAMES[geometry.toFloor]}` : undefined}
    aria-pressed={onSelect ? selected : undefined} data-object-id={onSelect ? target.id : undefined}
    onPointerDown={onBeginMove ? event => onBeginMove(event, target) : onSelect ? event => { event.stopPropagation(); event.preventDefault(); onSelect(target); } : undefined}
    onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(target); } } : undefined}>
    {onSelect && <polygon points={pointsText(geometry.footprint)} className="cad-stair-hit" />}
    <polygon points={pointsText(geometry.footprint)} className="cad-stair-boundary" />
    {geometry.parts.map((part, index) => <rect key={index} data-stair-part={part.kind} x={part.center[0] - part.width / 2} y={part.center[1] - part.depth / 2} width={part.width} height={part.depth}
      transform={`rotate(${part.rotation ?? 0} ${part.center.join(' ')})`} />)}
    {rails.map((edge, index) => <path key={`rail-${index}`} className="cad-stair-rail" data-stair-protection="rail" d={`M${edge.a.join(',')} L${edge.b.join(',')}`} />)}
    {glass.map((edge, index) => <path key={`glass-${index}`} className="cad-stair-glass" data-stair-protection="glass" d={`M${edge.a.join(',')} L${edge.b.join(',')}`} />)}
    <path className="cad-stair-direction" d={`M${direction.map(p => p.join(',')).join(' L')}`} />
    <path d={`M${head.map(p => p.join(',')).join(' L')}`} />
  </g>;
}

export function StairControls({ state, unit, fromFloor, units = 'm', onCommand, onConnectionChange }: {
  state: SimulationState; unit: UnitId; fromFloor: FloorId; units?: DisplayUnit;
  onCommand: (command: CadCommand, label: string) => void;
  onConnectionChange?: (connection: FloorId) => void;
}) {
  const [localConnection, setConnection] = useState(fromFloor);
  useEffect(() => { setConnection(fromFloor); }, [fromFloor, unit]);
  const connection = onConnectionChange ? fromFloor : localConnection;
  const building = state.buildings[unit], path = building.stairPaths?.[connection];
  const current = resolveStairGeometry(state, unit, connection);
  const pathBounds = boundsOf(current?.footprint.map(point => planPoint(point, unit, state)) ?? [], .35);
  const railing = building.stairRailing ?? (unit === 'south' && building.southLayout === 'family');
  const openingGlass = building.stairOpeningGlass ?? false;
  const updatePath = (next: StairPathSettings) => onCommand({ type: 'stair-path', unit, fromFloor: connection, path: parseStairPath(next) }, 'עריכת מסלול מדרגות ופודסט');
  const alternatives = (['straight', 'u-shaped'] as const).map(layout => {
    const settings = { ...building, stairLayout: layout }; delete settings.stairPaths;
    const preview = { ...state, buildings: { ...state.buildings, [unit]: settings } };
    return { layout, preview, geometry: resolveStairGeometry(preview, unit, connection) };
  });
  const bounds = boundsOf(alternatives.flatMap(a => a.geometry?.footprint.map(p => planPoint(p, unit, a.preview)) ?? []), .35);
  return <section className="cad-stair-controls" aria-label="חלופות מדרגות">
    <label className="stair-check"><input type="checkbox" checked={building.stairToRoof ?? false}
      disabled={!building.enabled || building.stairEnabled === false || !building.stairToRoof && (building.storeys !== 2 || !building.roofEnabled)}
      onChange={event => onCommand({ type: 'stair-roof', unit, enabled: event.target.checked }, 'המשך מדרגות לגג')} />המשך מדרגות לגג</label>
    <label className="stair-connection">חיבור לעריכת מסלול<select aria-label="חיבור מדרגות" value={connection} disabled={!building.enabled}
      onChange={event => {
        const next = event.target.value as FloorId;
        if (onConnectionChange) onConnectionChange(next); else setConnection(next);
      }}>
      <option value="ground" disabled={building.storeys !== 2}>קומת קרקע אל קומה ראשונה</option>
      <option value="basement">מרתף אל קומת קרקע</option>
      <option value="first" disabled={building.storeys !== 2 || !building.roofEnabled || !building.stairToRoof}>קומה ראשונה אל הגג</option>
    </select></label>
    <label className="stair-check"><input type="checkbox" checked={!!path} disabled={!current}
      onChange={event => onCommand({ type: 'stair-path', unit, fromFloor: connection, path: event.target.checked ? { ...DEFAULT_STAIR_PATH } : null }, 'הפעלת מסלול מדרגות עם פודסט')} />מסלול עם פודסט</label>
    {path && current && <div className="stair-path-editor">
      <div className="stair-path-toolbar">
        <div role="group" aria-label="כיוון הפנייה בפודסט" className="stair-turns">{([
          ['left', 'פנייה שמאלה', CornerUpLeft], ['straight', 'ללא פנייה', ArrowUp], ['right', 'פנייה ימינה', CornerUpRight],
        ] as const).map(([turn, label, Icon]) => <Button key={turn} size="icon" variant={path.turn === turn ? 'primary' : 'secondary'}
          aria-label={label} title={label} aria-pressed={path.turn === turn} onClick={() => updatePath({ ...path, turn })}><Icon size={18} /></Button>)}</div>
        <Button size="icon" variant={path.reversed ? 'primary' : 'secondary'} aria-label="היפוך כיוון העלייה" title="היפוך כיוון העלייה"
          aria-pressed={path.reversed} onClick={() => updatePath(reverseStairPath(path))}><ArrowDownUp size={18} /></Button>
      </div>
      <label className="stair-check" title={!path.secondLanding && path.landingAfter > 12 ? 'פודסט ראשון עד הרום ה־12 מאפשר גרם נוסף' : undefined}>
        <input type="checkbox" checked={!!path.secondLanding} disabled={!path.secondLanding && path.landingAfter > 12}
          onChange={event => {
            const next = { ...path };
            if (event.target.checked) next.secondLanding = { turn: 'right', landingAfter: 15, landingDepth: path.landingDepth };
            else delete next.secondLanding;
            updatePath(next);
          }} />פודסט ופנייה נוספים</label>
      {path.secondLanding && <div className="stair-turns" role="group" aria-label="כיוון הפנייה בפודסט השני">{([
        ['left', 'פנייה שמאלה בפודסט השני', CornerUpLeft], ['straight', 'ללא פנייה בפודסט השני', ArrowUp], ['right', 'פנייה ימינה בפודסט השני', CornerUpRight],
      ] as const).map(([turn, label, Icon]) => <Button key={turn} size="icon" variant={path.secondLanding!.turn === turn ? 'primary' : 'secondary'}
        aria-label={label} title={label} aria-pressed={path.secondLanding!.turn === turn}
        onClick={() => updatePath({ ...path, secondLanding: { ...path.secondLanding!, turn } })}><Icon size={18} /></Button>)}</div>}
      <svg className="stair-path-preview" role="img" aria-label="תצוגת מסלול מדרגות" viewBox={`${pathBounds.x} ${pathBounds.y} ${pathBounds.width} ${pathBounds.height}`}>
        <StairPlan geometry={current} state={state} />
      </svg>
      <NumericDraftForm key={JSON.stringify([unit, connection, path, units])} units={units} submitLabel="החלת מידות מדרגות" skipUnchanged
        fields={[
          { name: 'landingAfter', label: 'רומים עד הפודסט', value: path.landingAfter, dimension: false, step: 1 },
          { name: 'landingDepth', label: 'עומק הפודסט', value: path.landingDepth },
          { name: 'width', label: 'רוחב גרם', value: path.width },
          { name: 'treadDepth', label: 'עומק שלח', value: path.treadDepth },
          ...(path.secondLanding ? [
            { name: 'secondLandingAfter', label: 'רומים עד הפודסט השני', value: path.secondLanding.landingAfter, dimension: false, step: 1 },
            { name: 'secondLandingDepth', label: 'עומק הפודסט השני', value: path.secondLanding.landingDepth },
          ] : []),
          { name: 'connectionRotation', label: 'סיבוב יחסי של החיבור', value: path.rotation ?? 0, dimension: false, step: 1 },
          { name: 'offsetX', label: 'הזזת החיבור לרוחב', value: path.offset?.[0] ?? 0 },
          { name: 'offsetZ', label: 'הזזת החיבור לאורך', value: path.offset?.[1] ?? 0 },
        ]} onApply={values => updatePath({ ...path, landingAfter: values.landingAfter, landingDepth: values.landingDepth, width: values.width, treadDepth: values.treadDepth,
          ...(path.rotation !== undefined || values.connectionRotation !== 0 ? { rotation: values.connectionRotation } : {}),
          ...(path.offset || values.offsetX !== 0 || values.offsetZ !== 0 ? { offset: [values.offsetX, values.offsetZ] as Vec2 } : {}),
          ...(path.secondLanding ? { secondLanding: { ...path.secondLanding, landingAfter: values.secondLandingAfter, landingDepth: values.secondLandingDepth } } : {}) })} />
      <dl className="stair-path-readout">
        <div><dt>פודסט מעל רצפת המקור</dt><dd><bdi>{lengthText(current.rise * path.landingAfter / current.riserCount, units)}</bdi></dd></div>
        {path.secondLanding && <div><dt>פודסט שני מעל רצפת המקור</dt><dd><bdi>{lengthText(current.rise * path.secondLanding.landingAfter / current.riserCount, units)}</bdi></dd></div>}
        <div><dt>יציאה · {LEVEL_NAMES[current.toFloor]}</dt><dd><bdi>X {lengthText(current.exit!.center[0], units)} · Z {lengthText(current.exit!.center[1], units)}</bdi></dd></div>
        <div><dt>רומים</dt><dd><bdi>{current.riserCount} × {lengthText(current.rise / current.riserCount, units)}</bdi></dd></div>
      </dl>
    </div>}
    <fieldset className="stair-protection"><legend>מעקות ביחידה</legend>
      <label className="stair-check"><input type="checkbox" checked={railing} disabled={!building.enabled || building.stairEnabled === false}
        onChange={event => onCommand({ type: 'stair-protection', unit, railing: event.target.checked, openingGlass }, 'שינוי מעקה מדרגות')} />מעקה ומאחז יד</label>
      <label className="stair-check"><input type="checkbox" checked={openingGlass} disabled={!building.enabled || building.stairEnabled === false}
        onChange={event => onCommand({ type: 'stair-protection', unit, railing, openingGlass: event.target.checked }, 'שינוי זכוכית סביב פתחי מדרגות')} />זכוכית סביב פתחי מדרגות</label>
    </fieldset>
    <p>תבניות בסיס · השינוי חל על כל החיבורים ביחידה ומחליף מסלולים עריכים</p>
    <div className="cad-stair-options">{alternatives.map(({ layout, preview, geometry }) => {
      const footprint = geometry?.footprint.map(p => planPoint(p, unit, preview));
      const width = footprint ? Math.hypot(footprint[1][0] - footprint[0][0], footprint[1][1] - footprint[0][1]) : 0;
      const depth = footprint ? Math.hypot(footprint[3][0] - footprint[0][0], footprint[3][1] - footprint[0][1]) : 0;
      return <button key={layout} type="button" disabled={!geometry} aria-pressed={!building.stairPaths && building.stairLayout === layout}
        onClick={() => onCommand({ type: 'stair', unit, layout }, 'שינוי חלופת מדרגות')}>
        <strong>{layout === 'straight' ? 'גרם ישר רציף' : 'מדרגות U'}</strong>
        <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} aria-hidden="true">{geometry && <StairPlan geometry={geometry} state={preview} />}</svg>
        {geometry ? <><bdi>{lengthText(width, units)} × {lengthText(depth, units)}</bdi><span>{geometry.riserCount} רומים · עלייה {lengthText(geometry.rise, units)}</span><span>רום {lengthText(geometry.rise / geometry.riserCount, units)}</span></> : <span>חיבור לא פעיל</span>}
      </button>;
    })}</div>
    <p className="warning-note">תכנון רעיוני בלבד. קירות, פתחים ומרווח ראש אינם מותאמים אוטומטית למסלול. התאמה מבנית, זכוכית בטיחות ועמידה בתקן טעונות אימות מקצועי.</p>
  </section>;
}