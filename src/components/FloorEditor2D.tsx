import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Grid2X2, Redo2, RotateCcw, Save, Trash2, Undo2, X } from 'lucide-react';
import { Button } from './ui/button';
import { FOOTPRINTS, resolvedRooms, resolvedWalls } from '../model/plans';
import { FLOOR_NAMES, UNIT_NAMES, type FloorId, type SimulationState, type UnitId, type Vec2 } from '../model/types';

type Selection = { type: 'wall' | 'room'; id: string } | null;
type Snapshot = SimulationState['design'];
type Drag = { selection: NonNullable<Selection>; start: Vec2; design: Snapshot; endpoint?: 'a' | 'b' };
const FLOORS: FloorId[] = ['basement', 'ground', 'first'];
const cloneDesign = (design: Snapshot): Snapshot => structuredClone(design);
const snap = (value: number, enabled: boolean) => enabled ? Math.round(value * 4) / 4 : Math.round(value * 100) / 100;

export function FloorEditor2D({ state, onChange, onClose }: { state: SimulationState; onChange: (state: SimulationState) => void; onClose: () => void }) {
  const [floor, setFloor] = useState<FloorId>(state.view.planFloor);
  const [unit, setUnit] = useState<UnitId>('north');
  const [selection, setSelection] = useState<Selection>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const walls = useMemo(() => resolvedWalls(state).filter(wall => wall.floor === floor && wall.unit === unit), [floor, state, unit]);
  const rooms = useMemo(() => resolvedRooms(state).filter(room => room.floor === floor && room.unit === unit), [floor, state, unit]);
  const selectedWall = selection?.type === 'wall' ? walls.find(wall => wall.id === selection.id) : undefined;
  const selectedRoom = selection?.type === 'room' ? rooms.find(room => room.id === selection.id) : undefined;

  const eventPoint = (event: ReactPointerEvent<SVGElement>): Vec2 => {
    const svg = svgRef.current!;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return [transformed.x, transformed.y];
  };
  const begin = (event: ReactPointerEvent<SVGElement>, next: NonNullable<Selection>, endpoint?: 'a' | 'b') => {
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic and older Safari events may not expose an active pointer. */ }
    setSelection(next);
    dragRef.current = { selection: next, endpoint, start: eventPoint(event), design: cloneDesign(state.design) };
  };
  const move = (event: ReactPointerEvent<SVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const current = eventPoint(event);
    const design = cloneDesign(drag.design);
    if (drag.selection.type === 'wall') {
      const base = resolvedWalls({ ...state, design: drag.design }).find(wall => wall.id === drag.selection.id);
      if (!base) return;
      const edit = { a: [...base.a] as Vec2, b: [...base.b] as Vec2, deleted: false };
      if (drag.endpoint) edit[drag.endpoint] = [snap(current[0], snapEnabled), snap(current[1], snapEnabled)];
      else {
        const dx = snap(current[0] - drag.start[0], snapEnabled), dz = snap(current[1] - drag.start[1], snapEnabled);
        edit.a = [base.a[0] + dx, base.a[1] + dz]; edit.b = [base.b[0] + dx, base.b[1] + dz];
      }
      design.wallEdits[base.id] = edit;
    } else {
      const base = resolvedRooms({ ...state, design: drag.design }).find(room => room.id === drag.selection.id);
      if (!base) return;
      design.roomEdits[base.id] = {
        center: [base.center[0] + snap(current[0] - drag.start[0], snapEnabled), base.center[1] + snap(current[1] - drag.start[1], snapEnabled)],
        width: base.width, depth: base.depth, deleted: false,
      };
    }
    onChange({ ...state, design });
  };
  const end = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const snapshot = cloneDesign(drag.design);
    dragRef.current = null;
    setHistory(items => [...items.slice(-19), snapshot]);
    setFuture([]);
  };
  const commit = (design: Snapshot) => {
    setHistory(items => [...items.slice(-29), cloneDesign(state.design)]); setFuture([]); onChange({ ...state, design });
  };
  const undo = () => {
    const previous = history.at(-1); if (!previous) return;
    setHistory(items => items.slice(0, -1)); setFuture(items => [cloneDesign(state.design), ...items]); onChange({ ...state, design: cloneDesign(previous) });
  };
  const redo = () => {
    const next = future[0]; if (!next) return;
    setFuture(items => items.slice(1)); setHistory(items => [...items, cloneDesign(state.design)]); onChange({ ...state, design: cloneDesign(next) });
  };
  const remove = () => {
    if (!selection) return;
    const design = cloneDesign(state.design);
    if (selectedWall) design.wallEdits[selectedWall.id] = { a: [...selectedWall.a], b: [...selectedWall.b], deleted: true };
    if (selectedRoom) design.roomEdits[selectedRoom.id] = { center: [...selectedRoom.center], width: selectedRoom.width, depth: selectedRoom.depth, deleted: true };
    commit(design); setSelection(null);
  };
  const resizeRoom = (factor: number) => {
    if (!selectedRoom) return;
    const design = cloneDesign(state.design);
    design.roomEdits[selectedRoom.id] = { center: [...selectedRoom.center], width: Math.max(.4, selectedRoom.width * factor), depth: Math.max(.4, selectedRoom.depth * factor), deleted: false };
    commit(design);
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selection) {
        event.preventDefault(); remove();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [future, history, selection, state.design]);
  const viewWidth = 20 / zoom, viewHeight = 24 / zoom;
  const viewBox = `${8 - viewWidth / 2} ${9 - viewHeight / 2} ${viewWidth} ${viewHeight}`;

  return <div className="editor-backdrop"><section className="floor-editor" role="dialog" aria-modal="true" aria-label="עורך תוכנית דו־ממדית">
    <header><div><Grid2X2 size={20} /><div><strong>עורך תוכנית 2D</strong><small>גרירה באצבע או בעכבר · הצמדת 25 ס״מ</small></div></div><Button size="icon" variant="ghost" onClick={onClose} aria-label="סגירת עורך"><X size={18} /></Button></header>
    <div className="editor-toolbar">
      <div className="segmented">{FLOORS.map(item => <Button key={item} size="sm" variant={floor === item ? 'primary' : 'secondary'} onClick={() => { setFloor(item); setSelection(null); }}>{FLOOR_NAMES[item]}</Button>)}</div>
      <div className="segmented">{(['north', 'south'] as UnitId[]).map(item => <Button key={item} size="sm" variant={unit === item ? 'primary' : 'secondary'} onClick={() => { setUnit(item); setSelection(null); }}>{UNIT_NAMES[item]}</Button>)}</div>
      <div className="editor-actions"><Button size="sm" variant="secondary" disabled={!history.length} onClick={undo}><Undo2 size={15} />ביטול</Button><Button size="sm" variant="secondary" disabled={!future.length} onClick={redo}><Redo2 size={15} />חזרה</Button><Button size="sm" variant={snapEnabled ? 'primary' : 'secondary'} onClick={() => setSnapEnabled(value => !value)}>הצמדה</Button><Button size="sm" variant="secondary" onClick={() => setZoom(value => Math.max(1, value / 1.25))}>− זום</Button><Button size="sm" variant="secondary" onClick={() => setZoom(value => Math.min(4, value * 1.25))}>+ זום</Button><Button size="sm" variant="secondary" onClick={() => commit({ wallEdits: {}, roomEdits: {} })}><RotateCcw size={15} />איפוס</Button></div>
    </div>
    <div className="editor-canvas-wrap"><svg ref={svgRef} className="editor-canvas" viewBox={viewBox} onWheel={event => { event.preventDefault(); setZoom(value => Math.min(4, Math.max(1, value * (event.deltaY < 0 ? 1.12 : .89)))); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerDown={() => setSelection(null)}>
      <defs><pattern id="grid-small" width=".25" height=".25" patternUnits="userSpaceOnUse"><path d="M .25 0 L 0 0 0 .25" /></pattern><pattern id="grid-large" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="url(#grid-small)" /><path d="M 1 0 L 0 0 0 1" /></pattern></defs>
      <rect x="-2" y="-3" width="20" height="24" fill="url(#grid-large)" />
      <polygon className="editor-footprint" points={FOOTPRINTS[floor][unit].map(([x,z]) => `${x},${z}`).join(' ')} />
      {rooms.map(room => <g key={room.id} role="button" tabIndex={0} aria-label={`חדר ${room.name}`} onKeyDown={event => { if (event.key === 'Enter') setSelection({ type: 'room', id: room.id }); }} onPointerDown={event => begin(event, { type: 'room', id: room.id })}><rect className={`editor-room ${selection?.id === room.id ? 'selected' : ''}`} x={room.center[0]-room.width/2} y={room.center[1]-room.depth/2} width={room.width} height={room.depth} /><text x={room.center[0]} y={room.center[1]}>{room.name}</text></g>)}
      {walls.map(wall => <g key={wall.id} role="button" tabIndex={0} aria-label={`קיר ${wall.id}`} onKeyDown={event => { if (event.key === 'Enter') setSelection({ type: 'wall', id: wall.id }); }}><line className={`editor-wall ${selection?.id === wall.id ? 'selected' : ''}`} x1={wall.a[0]} y1={wall.a[1]} x2={wall.b[0]} y2={wall.b[1]} strokeWidth={Math.max(.10, wall.thickness)} onPointerDown={event => begin(event, { type: 'wall', id: wall.id })} />{selection?.type === 'wall' && selection.id === wall.id && <><circle className="editor-handle" cx={wall.a[0]} cy={wall.a[1]} r=".24" onPointerDown={event => begin(event, selection, 'a')} /><circle className="editor-handle" cx={wall.b[0]} cy={wall.b[1]} r=".24" onPointerDown={event => begin(event, selection, 'b')} /></>}</g>)}
    </svg></div>
    <footer><div><strong>{selectedWall ? 'קיר נבחר' : selectedRoom ? selectedRoom.name : 'בחרו קיר או חדר'}</strong><small>{selectedWall ? `אורך ${Math.hypot(selectedWall.b[0]-selectedWall.a[0], selectedWall.b[1]-selectedWall.a[1]).toFixed(2)} מ׳` : selectedRoom ? `${selectedRoom.width.toFixed(2)} × ${selectedRoom.depth.toFixed(2)} מ׳` : 'גררו להזזה; בקיר גררו ידית קצה'}</small></div><div className="editor-actions">{selectedRoom && <><Button size="sm" variant="secondary" onClick={() => resizeRoom(.9)}>הקטן</Button><Button size="sm" variant="secondary" onClick={() => resizeRoom(1.1)}>הגדל</Button></>}<Button size="sm" variant="ghost" disabled={!selection} onClick={remove}><Trash2 size={15} />מחיקה</Button><Button size="sm" onClick={onClose}><Save size={15} />סיום</Button></div></footer>
  </section></div>;
}
