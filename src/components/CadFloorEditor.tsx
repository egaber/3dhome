import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as Pointer } from 'react';
import { Grid2X2, X } from 'lucide-react';
import { Button } from './ui/button';
import { HistoryControls, type HistoryControlsProps } from './ActionHistory';
import { isEditableTarget } from '../lib/walkNavigation';
import { FOOTPRINTS, isFloorAvailable, planPoint, resolvedFurniture, resolvedRooms, resolvedWalls } from '../model/plans';
import { applyCadCommand, getWallApertures, resolveStairGeometry, type CadCommand } from '../model/cad';
import { FLOOR_NAMES, UNIT_NAMES, type FloorId, type SimulationState, type UnitId, type Vec2 } from '../model/types';
import { boundsOf, dragCommand, finishCadDrag, furniturePoint, geometryContext, lengthText, planMeasurement, pointsText, snapPlan, zoomPlan,
  FURNITURE_NAMES, type CadSelection, type DisplayUnit, type PlanView } from '../lib/cadEditor';
import { dimensionGutters, fitAnnotatedPlan, roomLabelFits } from '../lib/cadLayout';
import { FloorHeightReadout } from './CadFields';
import { StairControls, StairPlan } from './StairControls';
import { CadProperties, FurniturePalette, deleteSelection } from './CadProperties';
import { FurniturePlan, PlanDimension, WallDimensions, WallPlan } from './CadPlanObjects';
import { PlanMeasurementPanel } from './PlanMeasurementPanel';
import { rotationCommand, rotationInfo, rotationShortcut } from '../lib/cadRotation';
import { normalizeRotation, rotatePlanPoint } from '../model/rotation';
import { rotationDragCommand } from '../lib/cadTransformHandles';
import { CadTransformHandles } from './CadTransformHandles';
import './floorEditor.css';

type Tool = 'select' | 'pan' | 'measure';
type Layers = { grid: boolean; walls: boolean; furniture: boolean; labels: boolean; dimensions: boolean };
type Drag = { base: SimulationState; selection: CadSelection; kind: 'move' | 'rotate'; start: Vec2; pointer: number; screen: Vec2; endpoint?: 'a' | 'b'; command: CadCommand | null };
const FLOORS: FloorId[] = ['basement', 'ground', 'first'];
const LAYERS: [keyof Layers, string][] = [['grid', 'רשת'], ['walls', 'קירות ופתחים'], ['furniture', 'ריהוט'], ['labels', 'תוויות חדרים'], ['dimensions', 'מידות']];
export interface FloorEditor2DProps {
  state: SimulationState; onChange: (state: SimulationState, label?: string) => void; onClose: () => void;
  historyControls: HistoryControlsProps;
  /** Compatibility only: local CAD drafts never begin/end history gestures. */
  onBeginEdit: (label?: string) => void; onEndEdit: () => void;
}

export function CadFloorEditor({ state, onChange, onClose, historyControls }: FloorEditor2DProps) {
  const [floor, setFloor] = useState<FloorId>(state.view.planFloor), [unit, setUnit] = useState<UnitId>(state.buildings.north.enabled ? 'north' : 'south');
  const [selection, setSelection] = useState<CadSelection | null>(null), [snap, setSnap] = useState(true), [units, setUnits] = useState<DisplayUnit>('m');
  const [tool, setTool] = useState<Tool>('select'), [layers, setLayers] = useState<Layers>({ grid: true, walls: true, furniture: true, labels: true, dimensions: true });
  const [connection, setConnection] = useState<'basement' | 'ground'>(floor === 'basement' ? 'basement' : 'ground');
  const [details, setDetails] = useState(false), [error, setError] = useState('');
  const [preview, setPreview] = useState<{ base: SimulationState; next: SimulationState } | null>(null);
  const [measurement, setMeasurement] = useState<{ context: string; points: Vec2[] }>({ context: '', points: [] });
  const [size, setSize] = useState({ width: 800, height: 600 }), [view, setView] = useState<PlanView>({ x: -1, y: -1, width: 14, height: 10 });
  const dialogRef = useRef<HTMLElement>(null), svgRef = useRef<SVGSVGElement>(null), backdropRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null), panRef = useRef<{ screen: Vec2; view: PlanView; pointer: number } | null>(null);
  const currentState = useRef(state); currentState.current = state;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const context = geometryContext(state, unit, floor), shown = preview?.base === state ? preview.next : state;
  const available = isFloorAvailable(floor, state.buildings[unit]);
  const walls = useMemo(() => resolvedWalls(shown).filter(w => w.unit === unit && w.floor === floor), [shown, unit, floor]);
  const furniture = useMemo(() => resolvedFurniture(shown).filter(i => i.unit === unit && i.floor === floor), [shown, unit, floor]);
  const rooms = useMemo(() => resolvedRooms(shown).filter(r => r.unit === unit && r.floor === floor), [shown, unit, floor]);
  const points = measurement.context === context ? measurement.points : [];
  const setPoints = (next: Vec2[]) => setMeasurement({ context, points: next });
  const result = planMeasurement(points, floor, unit, state), stair = available ? resolveStairGeometry(shown, unit, connection) : null;
  const footprint = available ? FOOTPRINTS[floor][unit].map(p => planPoint(p, unit, shown)) : [];
  const localBounds = boundsOf(FOOTPRINTS[floor][unit]);
  const overall = ([[localBounds.x, localBounds.y + localBounds.height], [localBounds.x + localBounds.width, localBounds.y + localBounds.height],
    [localBounds.x + localBounds.width, localBounds.y]] as Vec2[]).map(p => planPoint(p, unit, shown));
  const furnitureFootprints = furniture.map(item => ([[-item.width / 2, -item.depth / 2], [item.width / 2, -item.depth / 2], [item.width / 2, item.depth / 2], [-item.width / 2, item.depth / 2]] as Vec2[]).map(p => planPoint(furniturePoint(item, p), unit, shown)));
  const stairFootprint = stair?.footprint.map(p => planPoint(p, unit, shown)) ?? [];
  const bounds = boundsOf([...footprint, ...walls.flatMap(w => [planPoint(w.a, unit, shown), planPoint(w.b, unit, shown)]),
    ...furnitureFootprints.flat(), ...stairFootprint], .2);
  const labelObstacles = [...(layers.furniture ? furnitureFootprints.map(p => boundsOf(p)) : []), ...(stairFootprint.length ? [boundsOf(stairFootprint)] : [])];
  const unitPerPixel = view.width / Math.max(1, size.width), textSize = 12 * unitPerPixel;
  const patternId = useId().replace(/:/g, ''), gridId = `${patternId}-grid`, hatchId = `${patternId}-hatch`;
  const cancel = useCallback(() => { dragRef.current = null; panRef.current = null; setPreview(null); }, []);
  const close = () => { cancel(); onClose(); };
  const fitMargin = selection?.type === 'wall' || selection?.type === 'opening' ? 88 : dimensionGutters(overall);
  const fit = () => { cancel(); setView(fitAnnotatedPlan(bounds, size.width, size.height, fitMargin)); };
  const initialFit = useRef('');
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(svgRef.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const key = `${unit}-${floor}-${size.width}-${size.height}`;
    if (initialFit.current !== key) { initialFit.current = key; cancel(); setView(fitAnnotatedPlan(bounds, size.width, size.height, fitMargin)); }
  }, [unit, floor, size, cancel]);
  useEffect(() => { cancel(); }, [state, unit, floor, cancel]);
  // Discard storage as well as display: returning through undo must not resurrect old points.
  useEffect(() => { setMeasurement({ context, points: [] }); }, [context]);
  useEffect(() => {
    setSelection(null); setError('');
    setConnection(floor === 'basement' || state.buildings[unit].storeys === 1 ? 'basement' : 'ground');
  }, [unit, floor, state.buildings[unit].storeys]);

  // Ordinary modal, with explicit exception for the nested native history dialog.
  useEffect(() => {
    const previousFocus = document.activeElement, dialog = dialogRef.current!;
    const inert: { element: HTMLElement; previous: boolean }[] = [];
    let branch: HTMLElement = backdropRef.current!;
    while (branch.parentElement && branch !== document.body) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement && sibling.tagName !== 'DIALOG') {
          inert.push({ element: sibling, previous: sibling.inert }); sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement | SVGElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]'))
      .filter(element => element.getClientRects().length > 0 && !element.closest('[hidden]'));
    (dialog.querySelector('[aria-label="סגירת עורך"]') as HTMLElement)?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) cancel();
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dragRef.current || panRef.current) cancel(); else closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusables(), index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0].focus(); }
      }
    };
    const focus = (event: FocusEvent) => {
      if (document.querySelector('dialog[open]')) { cancel(); return; }
      if (event.target instanceof Node && !dialog.contains(event.target)) focusables()[0]?.focus();
    };
    const hide = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', keyboard, true); window.addEventListener('blur', cancel);
    document.addEventListener('focusin', focus); document.addEventListener('visibilitychange', hide);
    return () => {
      dragRef.current = null; panRef.current = null;
      window.removeEventListener('keydown', keyboard, true); window.removeEventListener('blur', cancel);
      document.removeEventListener('focusin', focus); document.removeEventListener('visibilitychange', hide);
      inert.forEach(({ element, previous }) => { element.inert = previous; }); document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [cancel]);

  const command = (command: CadCommand, label: string) => {
    cancel();
    if (state !== currentState.current || !available) throw new Error('המודל השתנה או שהקומה אינה פעילה. יש לבחור מחדש.');
    const next = applyCadCommand(state, command);
    if (next !== state) onChange(next, label);
    setError('');
  };
  const safely = (operation: () => void) => { try { operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'העריכה אינה תקינה; המודל לא שונה.'); } };
  const select = (next: CadSelection | null) => { cancel(); setSelection(next); setError(''); if (next) setDetails(true); };
  const eventPoint = (event: { clientX: number; clientY: number }): Vec2 => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return [view.x, view.y];
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return [p.x, p.y];
  };
  const capture = (event: Pointer<SVGElement>) => {
    try { svgRef.current?.setPointerCapture(event.pointerId); } catch { /* Synthetic inactive pointers have no capture. */ }
  };
  const begin = (event: Pointer<SVGElement>, next: CadSelection, endpoint?: 'a' | 'b', kind: Drag['kind'] = 'move') => {
    if (tool !== 'select' || !available || event.button !== 0 || dragRef.current) return;
    event.stopPropagation(); event.preventDefault(); cancel(); setSelection(next); setError('');
    svgRef.current?.focus(); capture(event);
    dragRef.current = { base: state, selection: next, kind, endpoint, start: eventPoint(event), screen: [event.clientX, event.clientY], pointer: event.pointerId, command: null };
  };
  const move = (event: Pointer<SVGElement>) => {
    const pan = panRef.current;
    if (pan && pan.pointer === event.pointerId) {
      setView({ ...pan.view, x: pan.view.x - (event.clientX - pan.screen[0]) * pan.view.width / size.width,
        y: pan.view.y - (event.clientY - pan.screen[1]) * pan.view.height / size.height }); return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    if (drag.base !== currentState.current) { cancel(); return; }
    if (Math.hypot(event.clientX - drag.screen[0], event.clientY - drag.screen[1]) < 3) { drag.command = null; setPreview(null); return; }
    try {
      const candidate = drag.kind === 'rotate'
        ? rotationDragCommand(drag.base, drag.selection, drag.start, eventPoint(event), event.shiftKey)
        : dragCommand(drag.base, drag.selection, drag.start, eventPoint(event), snap, drag.endpoint);
      const next = candidate ? applyCadCommand(drag.base, candidate) : drag.base;
      drag.command = candidate; setPreview({ base: drag.base, next }); setError('');
    } catch (cause) { drag.command = null; setPreview(null); setError(cause instanceof Error ? cause.message : 'הגרירה אינה תקינה'); }
  };
  const release = (event: Pointer<SVGElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointer !== event.pointerId) return;
    cancel();
    if (drag) safely(() => {
      const current = currentState.current, next = finishCadDrag(drag.base, current, drag.command);
      if (next !== current) onChange(next, drag.kind === 'rotate' ? 'סיבוב אובייקט בתוכנית 2D' : 'הזזת אובייקט בתוכנית 2D');
    });
  };
  const cameraZoom = (factor: number, anchor: Vec2 = [view.x + view.width / 2, view.y + view.height / 2]) => { cancel(); setView(v => zoomPlan(v, anchor, factor)); };
  const wheelRef = useRef<(event: WheelEvent) => void>(() => undefined);
  wheelRef.current = event => { event.preventDefault(); cameraZoom(event.deltaY < 0 ? .85 : 1 / .85, eventPoint(event)); };
  useEffect(() => {
    const svg = svgRef.current!, wheel = (event: WheelEvent) => wheelRef.current(event);
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, []);
  const panBy = (x: number, y: number) => { cancel(); setView(v => ({ ...v, x: v.x + x * v.width / 5, y: v.y + y * v.height / 5 })); };
  const visibleObjects: { selection: CadSelection; label: string }[] = [
    ...(layers.walls ? walls.flatMap(w => [{ selection: { type: 'wall' as const, id: w.id }, label: `קיר ${w.id}` },
      ...getWallApertures(w, shown).map(o => ({ selection: { type: 'opening' as const, id: o.id }, label: `פתח ${o.id}` }))]) : []),
    ...(layers.furniture ? furniture.map(i => ({ selection: { type: 'furniture' as const, id: i.id }, label: `${FURNITURE_NAMES[i.kind]} ${i.id}` })) : []),
    ...(layers.labels ? rooms.map(r => ({ selection: { type: 'room' as const, id: r.id }, label: `חדר ${r.name}` })) : []),
    ...(stair ? [{ selection: { type: 'stair' as const, id: `stair-${unit}-${connection}` }, label: `מדרגות ${FLOOR_NAMES[connection]} אל ${FLOOR_NAMES[stair.toFloor]}` }] : []),
  ];
  const activeSelection = selection && visibleObjects.some(o => o.selection.type === selection.type && o.selection.id === selection.id) ? selection : null;
  const selectedWall = activeSelection?.type === 'wall' ? walls.find(w => w.id === activeSelection.id)
    : activeSelection?.type === 'opening' ? walls.find(w => getWallApertures(w, shown).some(o => o.id === activeSelection.id)) : undefined;
  const wrappedHistory: HistoryControlsProps = { ...historyControls,
    onUndo: () => { cancel(); historyControls.onUndo(); }, onRedo: () => { cancel(); historyControls.onRedo(); }, onShowHistory: () => { cancel(); historyControls.onShowHistory(); } };
  return <div ref={backdropRef} className="editor-backdrop cad-modal-backdrop"><section ref={dialogRef} tabIndex={-1} className="floor-editor cad-editor" role="dialog" aria-modal="true" aria-label="עורך תוכנית דו־ממדית" dir="rtl"
    onKeyDown={event => {
      if (event.defaultPrevented || event.isPropagationStopped() || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
      const turn = rotationShortcut(event.nativeEvent, isEditableTarget(event.target));
      if (turn !== null && activeSelection && tool === 'select' && svgRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        safely(() => {
          const info = rotationInfo(state, activeSelection);
          if (!info) return;
          const next = rotationCommand(state, activeSelection, normalizeRotation(info.angle + turn));
          if (next) command(next, 'סיבוב אובייקט בתוכנית 2D');
        });
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && activeSelection) {
        event.preventDefault(); safely(() => { const remove = deleteSelection(state, activeSelection); if (remove) command(remove, 'מחיקת אובייקט בתוכנית 2D'); select(null); });
      }
    }}>
    <header><div><Grid2X2 size={20} /><strong>עורך תוכנית 2D</strong></div><Button size="icon" variant="ghost" onClick={close} aria-label="סגירת עורך"><X size={18} /></Button></header>
    <div className="cad-top-controls">
      <label>יחידה<select aria-label="יחידה לעריכה" value={unit} onChange={e => { cancel(); setUnit(e.target.value as UnitId); }}>{(['north', 'south'] as const).map(id => <option key={id} value={id} disabled={!state.buildings[id].enabled}>{UNIT_NAMES[id]}{!state.buildings[id].enabled ? ' · לא פעילה' : ''}</option>)}</select></label>
      <label>קומה<select aria-label="קומה לעריכה" value={floor} onChange={e => { cancel(); setFloor(e.target.value as FloorId); }}>{FLOORS.map(id => <option key={id} value={id} disabled={!isFloorAvailable(id, state.buildings[unit])}>{FLOOR_NAMES[id]}</option>)}</select></label>
      <HistoryControls {...wrappedHistory} />
    </div>
    <div className="cad-workspace"><div className="cad-drawing-area">
      <div className="cad-tools" role="toolbar" aria-label="כלי תוכנית">
        {([['select', 'בחירה'], ['pan', 'הזזת מבט'], ['measure', 'מדידה']] as const).map(([id, label]) => <Button key={id} size="sm" variant={tool === id ? 'primary' : 'secondary'} aria-pressed={tool === id} onClick={() => { cancel(); setTool(id); if (id === 'measure') setDetails(true); }}>{label}</Button>)}
        <Button size="sm" variant="secondary" onClick={fit}>התאמה</Button>
        <Button size="sm" variant="secondary" aria-label="התקרבות בתוכנית" onClick={() => cameraZoom(.75)}>+</Button>
        <Button size="sm" variant="secondary" aria-label="התרחקות בתוכנית" onClick={() => cameraZoom(1 / .75)}>−</Button>
      </div>
      <div className="editor-canvas-wrap cad-canvas-wrap">
        <svg ref={svgRef} className={`editor-canvas cad-canvas cad-tool-${tool}`} tabIndex={0} aria-label="תוכנית עריכה — חצים להזזת מבט, פלוס ומינוס לזום" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} preserveAspectRatio="none"
          onKeyDown={event => {
            if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
            const key = event.key;
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(key)) {
              event.preventDefault();
              if (key === 'Home') fit(); else if (key === '+' || key === '=') cameraZoom(.8); else if (key === '-') cameraZoom(1.25);
              else panBy(key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0, key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0);
            }
          }} onPointerMove={move} onPointerUp={release} onPointerCancel={cancel} onLostPointerCapture={cancel}
          onPointerDown={event => {
            if (event.button !== 0 || dragRef.current) return;
            event.preventDefault(); svgRef.current?.focus(); cancel();
            if (tool === 'measure' && available) { const p = snapPlan(eventPoint(event), snap); setPoints(points.length === 1 ? [points[0], p] : [p]); }
            else if (tool === 'pan') { capture(event); panRef.current = { screen: [event.clientX, event.clientY], view, pointer: event.pointerId }; }
            else setSelection(null);
          }}>
          <defs><pattern id={gridId} width=".25" height=".25" patternUnits="userSpaceOnUse"><path d="M .25 0 L 0 0 0 .25" /></pattern>
            <pattern id={hatchId} width=".12" height=".12" patternUnits="userSpaceOnUse"><rect width=".12" height=".12" /><path d="M0 .12 L.12 0" /></pattern></defs>
          {layers.grid && <rect x={view.x} y={view.y} width={view.width} height={view.height} fill={`url(#${gridId})`} pointerEvents="none" />}
          {available && <polygon className="cad-footprint" points={pointsText(footprint)} />}
          {stair && <StairPlan geometry={stair} state={shown} selection={activeSelection} onSelect={tool === 'select' ? next => {
            svgRef.current?.focus(); select(next);
          } : undefined} onBeginMove={tool === 'select' ? begin : undefined} />}
          {layers.furniture && furniture.map(item => <FurniturePlan key={item.id} item={item} state={shown} selection={activeSelection} events={{ begin, select }} />)}
          {layers.walls && walls.map(wall => <WallPlan key={wall.id} wall={wall} state={shown} selection={activeSelection} events={{ begin, select }} hatchId={hatchId} handleSize={8 * unitPerPixel} />)}
          {layers.labels && rooms.map(room => {
            const p = planPoint(room.center, room.unit, shown);
            const polygon = ([[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]] as Vec2[]).map(([x, z]) => planPoint(rotatePlanPoint([room.center[0] + x * room.width, room.center[1] + z * room.depth], room.center, room.rotation ?? 0), room.unit, shown));
            const showLabel = roomLabelFits(p, polygon, labelObstacles, textSize * (room.name.length * .75 + 1), textSize * 1.5);
            return <g key={room.id} role="button" tabIndex={0} aria-label={`חדר ${room.name}`} className="cad-room-label" data-label-culled={!showLabel}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select({ type: 'room', id: room.id }); } }}
            onPointerDown={event => begin(event, { type: 'room', id: room.id })}>
            <title>{room.name}</title>
            {activeSelection?.type === 'room' && activeSelection.id === room.id && <polygon className="cad-room-outline"
              points={pointsText(polygon)} />}
            {showLabel && <text x={p[0]} y={p[1]} style={{ fontSize: textSize }}>{room.name}</text>}</g>; })}
          {layers.dimensions && available && <g className="cad-overall-dimensions">
            <PlanDimension overall a={overall[0]} b={overall[1]} offset={textSize * 3} textSize={textSize} units={units} />
            <PlanDimension overall a={overall[1]} b={overall[2]} offset={textSize * 3} textSize={textSize} units={units} />
          </g>}
          {layers.dimensions && available && selectedWall && <WallDimensions wall={selectedWall} state={shown} textSize={textSize} units={units} />}
          <g className="cad-measurement" pointerEvents="none">
            {points.length === 2 && <path d={`M${points[0].join(',')} L${points[1].join(',')}`} />}
            {points.map((p, i) => <g key={i}><circle cx={p[0]} cy={p[1]} r={5 * unitPerPixel} /><text x={p[0]} y={p[1] - textSize} style={{ fontSize: textSize }}>{i ? 'B' : 'A'}</text></g>)}
            {result && <text x={(points[0][0] + points[1][0]) / 2} y={(points[0][1] + points[1][1]) / 2 + textSize} style={{ fontSize: textSize }}>{lengthText(result.distance, units)}</text>}
          </g>
          {tool === 'select' && activeSelection && <CadTransformHandles state={shown} selection={activeSelection} view={view}
            width={size.width} height={size.height} rotating={dragRef.current?.kind === 'rotate'}
            onBeginRotate={(event, next) => begin(event, next, undefined, 'rotate')}
            onBeginMove={begin}
            onRotate={angle => safely(() => {
              const next = rotationCommand(state, activeSelection, normalizeRotation(angle));
              if (next) command(next, 'סיבוב אובייקט בתוכנית 2D');
            })} />}
        </svg>
      </div>
      <div className="cad-pan-buttons" role="group" aria-label="הזזת מבט ללא גרירה">
          {([[-1, 0, 'שמאלה', '←'], [0, -1, 'למעלה', '↑'], [0, 1, 'למטה', '↓'], [1, 0, 'ימינה', '→']] as const).map(([x, y, label, glyph]) => <Button key={label} size="icon" variant="secondary" aria-label={`מבט ${label}`} onClick={() => panBy(x, y)}>{glyph}</Button>)}
      </div>
      <div className="cad-status"><FloorHeightReadout floor={floor} building={state.buildings[unit]} units={units} /><span>גררו אובייקט להזזה · ידית עגולה לסיבוב · Shift להצמדת 15° · הצמדה {snap ? '25 ס״מ' : 'כבויה'} · תוכנית גלובלית · {stair ? `${FLOOR_NAMES[connection]} ← ${FLOOR_NAMES[stair.toFloor]}` : 'אין חיבור מדרגות פעיל'}</span></div>
    </div>
    <aside className={`cad-side ${details ? 'is-expanded' : ''}`}>
      <Button className="cad-details-toggle" size="sm" variant="secondary" aria-expanded={details} aria-controls={`${patternId}-properties`} onClick={() => setDetails(v => !v)}>מאפיינים, שכבות ומדרגות</Button>
      <div id={`${patternId}-properties`} className="cad-side-scroll">
        <div className="cad-presentation"><label>יחידות תצוגה<select value={units} onChange={e => { cancel(); setUnits(e.target.value as DisplayUnit); }}><option value="m">מטרים</option><option value="mm">מילימטרים</option></select></label>
          <label className="cad-check"><input type="checkbox" checked={snap} onChange={e => { cancel(); setSnap(e.target.checked); }} />הצמדה ל־25 ס״מ</label></div>
        <fieldset className="cad-layers"><legend>שכבות</legend>{LAYERS.map(([key, label]) => <label key={key} className="cad-check"><input type="checkbox" checked={layers[key]} onChange={e => { cancel(); setLayers(previous => ({ ...previous, [key]: e.target.checked })); }} />{label}</label>)}</fieldset>
        <label>בחירת אובייקט<select aria-label="בחירת אובייקט" value={activeSelection ? `${activeSelection.type}:${activeSelection.id}` : ''} onChange={e => select(visibleObjects.find(o => `${o.selection.type}:${o.selection.id}` === e.target.value)?.selection ?? null)}>
          <option value="">ללא בחירה</option>{visibleObjects.map(o => <option key={`${o.selection.type}:${o.selection.id}`} value={`${o.selection.type}:${o.selection.id}`}>{o.label}</option>)}</select></label>
        {error && <p role="alert" className="cad-error">{error}</p>}
        {available ? <>
          <CadProperties key={`${context}-${activeSelection?.id}-${units}`} state={state} selection={activeSelection} units={units} onCommand={command} onSelect={select} onChange={onChange} />
          {tool === 'measure' && <PlanMeasurementPanel points={points} onPoints={setPoints} state={state} floor={floor} unit={unit} units={units} />}
          <details><summary>הוספת ריהוט ומכשירים</summary><FurniturePalette key={`${context}-${units}`} state={state} unit={unit} floor={floor} units={units}
            center={[bounds.x + bounds.width / 2, bounds.y + bounds.height / 2]} onCommand={command} onSelect={next => { setLayers(l => ({ ...l, furniture: true })); select(next); }} /></details>
          <details open><summary>מדרגות — ישר או U</summary><label>חיבור מוצג<select aria-label="חיבור מדרגות" value={connection} onChange={e => { cancel(); setConnection(e.target.value as 'basement' | 'ground'); }}>
            <option value="basement">מרתף ← קומת קרקע</option><option value="ground" disabled={state.buildings[unit].storeys !== 2}>קומת קרקע ← קומה ראשונה</option></select></label>
            <StairControls state={state} unit={unit} fromFloor={connection} units={units} onCommand={(c, label) => safely(() => command(c, label))} /></details>
          <details><summary>עזרה ואיפוס</summary><p className="small-note">גרירה היא תצוגה מקדימה מקומית. שחרור תקין שומר פעולה אחת; Escape, ביטול מצביע או שינוי מודל מבטלים אותה. גלגלת סביב הסמן; חצים ו־+/− כשהתוכנית ממוקדת. מידות מספריות בקפיצות 10 מ״מ. סמלים רעיוניים, לא תוכנית ביצוע.</p>
            <Button size="sm" variant="secondary" onClick={() => { cancel(); onChange({ ...state, openings: {}, addedOpenings: [], design: { wallEdits: {}, roomEdits: {}, furnitureEdits: {}, addedFurniture: [] } }, 'איפוס תוכנית 2D'); }}>איפוס תוכנית 2D</Button></details>
        </> : <p role="status">היחידה או הקומה אינן פעילות. בחרו קומה זמינה; אין עריכת גאומטריה נסתרת.</p>}
      </div>
    </aside></div>
  </section></div>;
}