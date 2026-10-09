import { useRef, useState } from 'react';
import { Plus, Trash2, TreePine, X } from 'lucide-react';
import { applyLandscapeCommand, LANDSCAPE_KINDS, LANDSCAPE_NAMES, resolvedLandscape, type LandscapeCommand } from '../model/landscape';
import { FLOOR_NAMES, type LandscapeKind, type LandscapeSpec, type SimulationState, type UnitId, type Vec2 } from '../model/types';
import { LIGHT_WELLS, SITE, planPoint, resolvedFootprint, resolvedWalls } from '../model/plans';
import { inversePlanPoint } from '../model/cad';
import { boundsOf, pointsText } from '../lib/cadEditor';
import { ShowroomDialog } from './ShowroomDialog';
import { NumericDraftForm } from './CadFields';
import { Button } from './ui/button';
import { HistoryControls, type HistoryControlsProps } from './ActionHistory';
import './landscape.css';

export function LandscapeProperties({ state, id, onChange, onDelete }: {
  state: SimulationState; id: string; onChange: (state: SimulationState, label?: string) => void; onDelete: () => void;
}) {
  const item = resolvedLandscape(state).find(item => item.id === id), [error, setError] = useState('');
  if (!item) return <p>הצמח שנבחר אינו זמין.</p>;
  return <section className="landscape-properties" aria-label="מאפייני צמחייה">
    <h3>{LANDSCAPE_NAMES[item.kind]}</h3><p>{item.level === 'garden' ? 'גינה' : FLOOR_NAMES[item.level]} · {item.unit === 'north' ? 'צפונית' : 'דרומית'}</p>
    <NumericDraftForm key={JSON.stringify(item)} units="m" fields={[
      { name: 'x', label: 'מיקום צמח X', value: item.center[0] }, { name: 'z', label: 'מיקום צמח Z', value: item.center[1] },
      { name: 'height', label: 'גובה צמח', value: item.height }, { name: 'spread', label: 'רוחב צמח', value: item.spread },
      { name: 'rotation', label: 'סיבוב צמח', value: item.rotation, dimension: false },
    ]} submitLabel="החלת שינוי בצמח" skipUnchanged onApply={values => {
      onChange(applyLandscapeCommand(state, { type: 'update', item: { ...item, center: [values.x, values.z], height: values.height, spread: values.spread, rotation: values.rotation } }), 'עריכת צמחייה');
    }} />
    <Button variant="secondary" onClick={() => {
      try { onChange(applyLandscapeCommand(state, { type: 'delete', id }), 'מחיקת צמחייה'); onDelete(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'המחיקה לא בוצעה.'); }
    }}><Trash2 size={16} /> מחיקת הצמח</Button>
    <small>המיקום במטרי תוכנית מקומיים, לפני סיבוב ומתיחת הבית. המחיקה והעריכה נשמרות בחלופה זו בלבד.</small>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function LandscapeQuickEditor({ state, id, onChange, onClose }: {
  state: SimulationState; id: string; onChange: (state: SimulationState, label?: string) => void; onClose: () => void;
}) {
  return <section className="quick-editor cad-quick-editor" dir="rtl" aria-label="עריכת עציץ או עץ">
    <header><strong>עצים ועציצים</strong><Button variant="ghost" size="icon" aria-label="סגירת עריכת צמחייה" onClick={onClose}><X size={18} /></Button></header>
    <div className="cad-quick-scroll"><LandscapeProperties state={state} id={id} onChange={onChange} onDelete={onClose} /></div>
  </section>;
}

export function LandscapeEditor({ state, onChange, onClose, selectedUnit = 'north', historyControls, persistenceError }: {
  state: SimulationState; onChange: (state: SimulationState, label?: string) => void; onClose: () => void; selectedUnit?: UnitId; historyControls?: HistoryControlsProps; persistenceError?: string;
}) {
  const [unit, setUnit] = useState(selectedUnit), [level, setLevel] = useState<LandscapeSpec['level']>('garden');
  const [kind, setKind] = useState<LandscapeKind>('olive-tree'), [selected, setSelected] = useState<string | null>(null), [error, setError] = useState('');
  const [draft, setDraft] = useState<{ id: string; center: Vec2 } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; item: LandscapeSpec; base: SimulationState; start: Vec2; next: Vec2 } | null>(null);
  const current = useRef(state); current.current = state;
  const items = resolvedLandscape(state).filter(item => item.unit === unit && item.level === level);
  const floor = level === 'garden' ? 'ground' : level;
  const outline = resolvedFootprint(floor, unit, state).map(point => planPoint(point, unit, state));
  const garden = [[SITE.left, SITE.back], [SITE.right, SITE.back], [SITE.right, SITE.front], [SITE.left, SITE.front]] as Vec2[];
  const bounds = boundsOf([...(level === 'garden' ? garden : outline), ...items.map(item => planPoint(item.center, unit, state))], 1);
  const cancel = () => { drag.current = null; setDraft(null); };
  const publish = (command: LandscapeCommand, label: string) => {
    try { onChange(applyLandscapeCommand(state, command), label); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'השינוי לא בוצע.'); }
  };
  const coordinate = (event: { clientX: number; clientY: number }): Vec2 => {
    const matrix = svg.current!.getScreenCTM(); if (!matrix) throw new Error('התוכנית אינה מוכנה לגרירה.');
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return inversePlanPoint([p.x, p.y], unit, state);
  };
  return <ShowroomDialog title="גינה וצמחייה" onClose={() => { cancel(); onClose(); }} error={error || persistenceError} wide>
    <p>עציצים, שרכים ועצים הם פריטים עצמאיים. בחרו ברשימה או בתוכנית; גררו להזזה, ערכו מידות או מחקו. אין שחזור אוטומטי של צמח שנמחק.</p>
    {historyControls && <HistoryControls {...historyControls} onUndo={() => { cancel(); historyControls.onUndo(); }} onRedo={() => { cancel(); historyControls.onRedo(); }} />}
    <div className="landscape-layout">
      <aside>
        <label>יחידה לצמחייה<select aria-label="יחידה לצמחייה" value={unit} onChange={event => { cancel(); setSelected(null); setUnit(event.target.value as UnitId); }}>
          <option value="north" disabled={!state.buildings.north.enabled}>צפונית</option><option value="south" disabled={!state.buildings.south.enabled}>דרומית</option>
        </select></label>
        <label>מיקום צמחייה<select aria-label="מיקום צמחייה" value={level} onChange={event => { cancel(); setSelected(null); const level = event.target.value as LandscapeSpec['level']; setLevel(level); if (level !== 'garden') setKind('potted-plant'); }}>
          <option value="garden">גינה</option>{Object.entries(FLOOR_NAMES).map(([id, name]) => <option key={id} value={id} disabled={id === 'first' && state.buildings[unit].storeys !== 2}>{name}</option>)}
        </select></label>
        <label>סוג צמח להוספה<select aria-label="סוג צמח להוספה" value={kind} onChange={event => setKind(event.target.value as LandscapeKind)}>
          {LANDSCAPE_KINDS.filter(kind => level === 'garden' || !['olive-tree', 'cypress'].includes(kind)).map(kind => <option key={kind} value={kind}>{LANDSCAPE_NAMES[kind]}</option>)}
        </select></label>
        <Button onClick={() => {
          const id = `plant-${crypto.randomUUID()}`, tree = kind === 'olive-tree' || kind === 'cypress';
          const center: Vec2 = level === 'garden' ? [unit === 'north' ? 6 : 8, unit === 'north' ? -5 : 17.8]
            : inversePlanPoint([(bounds.x + bounds.width / 2), (bounds.y + bounds.height / 2)], unit, state);
          publish({ type: 'add', item: { id, kind, unit, level, center, height: tree ? 3.4 : kind === 'fern' ? .55 : 1.1, spread: tree ? kind === 'cypress' ? 1 : 2.5 : .7, rotation: 0 } }, 'הוספת צמחייה'); setSelected(id);
        }}><Plus size={16} /> הוספת {LANDSCAPE_NAMES[kind]}</Button>
        <label>בחירת צמח<select aria-label="בחירת צמח" value={selected ?? ''} onChange={event => { cancel(); setSelected(event.target.value || null); }}>
          <option value="">בחרו צמח לעריכה</option>{items.map((item, index) => <option key={item.id} value={item.id}>{LANDSCAPE_NAMES[item.kind]} · {index + 1}</option>)}
        </select></label>
        {selected && <LandscapeProperties state={state} id={selected} onChange={onChange} onDelete={() => setSelected(null)} />}
        <Button variant="secondary" onClick={() => {
          if (window.confirm('למחוק את כל הצמחייה בגינה בחלופה זו? ניתן לבטל דרך היסטוריית הפעולות.')) {
            publish({ type: 'clear', gardenOnly: true }, 'ניקוי צמחיית הגינה'); setSelected(null);
          }
        }}><Trash2 size={16} /> ניקוי כל צמחיית הגינה</Button>
      </aside>
      <svg className="landscape-plan" ref={svg} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="img" aria-label="תוכנית עצים ועציצים" tabIndex={0}
        onKeyDown={event => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); } }}
        onPointerMove={event => {
          const active = drag.current; if (!active || active.id !== event.pointerId) return;
          if (active.base !== current.current) { cancel(); return; }
          try {
            const p = coordinate(event); active.next = [active.item.center[0] + p[0] - active.start[0], active.item.center[1] + p[1] - active.start[1]];
            setDraft({ id: active.item.id, center: active.next });
          } catch (cause) { cancel(); setError(cause instanceof Error ? cause.message : 'הגרירה לא בוצעה.'); }
        }}
        onPointerUp={event => {
          const active = drag.current; if (!active || active.id !== event.pointerId) return;
          if (active.base === current.current && Math.hypot(active.next[0] - active.item.center[0], active.next[1] - active.item.center[1]) > .01) {
            publish({ type: 'update', item: { ...active.item, center: active.next } }, 'הזזת צמחייה');
          }
          cancel();
        }} onPointerCancel={cancel} onLostPointerCapture={cancel} onBlur={cancel}>
        <polygon className="landscape-site" points={pointsText(garden)} />
        <polygon className="landscape-house" points={pointsText(outline)} />
        {resolvedWalls(state).filter(wall => wall.unit === unit && wall.floor === floor).map(wall => {
          const a = planPoint(wall.a, unit, state), b = planPoint(wall.b, unit, state);
          return <line key={wall.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
        })}
        {level === 'garden' && LIGHT_WELLS[unit].map((ring, index) => <polygon key={index} className="landscape-well" points={pointsText(ring.map(point => planPoint(point, unit, state)))} />)}
        {items.map((item, index) => {
          const point = planPoint(draft?.id === item.id ? draft.center : item.center, unit, state);
          return <g key={item.id} role="button" tabIndex={0} aria-label={`בחירת ${LANDSCAPE_NAMES[item.kind]} ${index + 1}`} data-landscape-id={item.id}
            className={selected === item.id ? 'selected' : ''} transform={`translate(${point.join(' ')})`}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(item.id); }
            }} onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault(); event.stopPropagation(); cancel(); setSelected(item.id); svg.current?.focus();
              try { drag.current = { id: event.pointerId, item, base: state, start: coordinate(event), next: item.center }; svg.current?.setPointerCapture(event.pointerId); }
              catch (cause) { cancel(); setError(cause instanceof Error ? cause.message : 'הגרירה אינה זמינה.'); }
            }}>
            <circle r={Math.max(.4, item.spread / 2)} /><TreePine x={-.3} y={-.3} width=".6" height=".6" />
          </g>;
        })}
      </svg>
    </div>
  </ShowroomDialog>;
}
