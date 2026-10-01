import { FloorHeightReadout, NumericDraftForm } from './CadFields';
import { Button } from './ui/button';
import { getFloorLevels, measureBetween, type Vec3 } from '../model/cad';
import { FLOOR_NAMES, UNIT_NAMES, type FloorId, type SimulationState, type UnitId } from '../model/types';
import './viewerCad.css';

export function ViewerMeasurementPanel({ state, unit, floor, onUnit, onFloor, points, status, onClear, onNumeric, context }: {
  state: SimulationState; unit: UnitId; floor: FloorId; onUnit: (unit: UnitId) => void; onFloor: (floor: FloorId) => void;
  points: Vec3[]; status: string; onClear: () => void; onNumeric: (a: Vec3, b: Vec3) => void; context: string;
}) {
  const result = points.length === 2 ? measureBetween(points[0], points[1]) : null;
  return <section id="viewer-measurement-panel" className="viewer-measurement-panel" aria-label="כלי מדידה בתלת־ממד" dir="rtl">
    <header className="measurement-summary">
      <output className="viewer-measure-result" aria-live="polite">{result ? `מרחק XYZ ${result.distance.toFixed(2)} מ׳ · אופקי ${result.horizontal.toFixed(2)} מ׳ · אנכי ${result.vertical.toFixed(2)} מ׳` : 'טרם הושלמה מדידה'}</output>
      <FloorHeightReadout floor={floor} building={state.buildings[unit]} />
    </header>
    <div className="measurement-form-scroll">
    <p className="small-note">שתי לחיצות על משטחים גלויים; ניווט ועריכת אובייקטים מושהים. סגרו מדידה כדי לנווט. Y הוא הגובה.</p>
    <div className="cad-fields">
      <label>יחידה למדידה<select value={unit} onChange={e => onUnit(e.target.value as UnitId)}>{(['north', 'south'] as const).map(u => <option key={u} value={u}>{UNIT_NAMES[u]}</option>)}</select></label>
      <label>קומה למדידה<select value={floor} onChange={e => onFloor(e.target.value as FloorId)}>{(['basement', 'ground', 'first'] as const).map(f => <option key={f} value={f}>{FLOOR_NAMES[f]}</option>)}</select></label>
    </div>
    {!getFloorLevels(floor, state.buildings[unit]) && <p className="small-note">אין גובה לקומה לא פעילה; ניתן למדוד משטחים אחרים או XYZ מספרי.</p>}
    <div className="measurement-points">{points.map((p, i) => <div key={i} data-measure-point={i === 0 ? 'A' : 'B'} dir="ltr">{i === 0 ? 'A' : 'B'}: {p.map(n => n.toFixed(2)).join(', ')} m</div>)}</div>
    <p role="status" className="small-note">{status}</p>
    <Button size="sm" variant="secondary" onClick={onClear}>ניקוי מדידה</Button>
    <details><summary>חלופה נגישה: נקודות XYZ מספריות</summary>
      <p className="small-note">קואורדינטות עולם במטרים, ‎±1000; אינן מוגבלות למשטח. לא נשמרות ולא יוצרות היסטוריה.</p>
      <NumericDraftForm key={`${context}:${JSON.stringify(points)}`} units="m" submitLabel="מדידת XYZ" fields={(['A', 'B'] as const).flatMap((p, i) => (['X', 'Y', 'Z'] as const).map((axis, j) => ({ name: `${p}${axis}`, label: `${p} · ${axis}`, value: points[i]?.[j] ?? 0 })))}
        onApply={v => onNumeric([v.AX, v.AY, v.AZ], [v.BX, v.BY, v.BZ])} />
    </details>
    </div>
  </section>;
}