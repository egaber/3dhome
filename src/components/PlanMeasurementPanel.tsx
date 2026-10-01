import { NumericDraftForm } from './CadFields';
import { lengthText, planMeasurement, type DisplayUnit } from '../lib/cadEditor';
import type { FloorId, SimulationState, UnitId, Vec2 } from '../model/types';
import { Button } from './ui/button';

export function PlanMeasurementPanel({ points, onPoints, state, floor, unit, units }: {
  points: Vec2[]; onPoints: (points: Vec2[]) => void; state: SimulationState; floor: FloorId; unit: UnitId; units: DisplayUnit;
}) {
  const result = planMeasurement(points, floor, unit, state);
  return <section aria-label="מדידת מרחק">
    <p className="small-note">שתי לחיצות בתוכנית או נקודות מספריות במסגרת התוכנית הגלובלית, אחרי קנה מידה וסיבוב היחידה. המדידה זמנית ואינה נשמרת.</p>
    <NumericDraftForm key={JSON.stringify([points, units])} units={units} submitLabel="מדידת נקודות" fields={[
      { name: 'ax', label: 'מדידה A · X', value: points[0]?.[0] ?? 0 }, { name: 'az', label: 'מדידה A · Z', value: points[0]?.[1] ?? 0 },
      { name: 'bx', label: 'מדידה B · X', value: points[1]?.[0] ?? 0 }, { name: 'bz', label: 'מדידה B · Z', value: points[1]?.[1] ?? 0 },
    ]} onApply={v => {
      if (Object.values(v).some(n => Math.abs(n) > 1000)) throw new Error('נקודות המדידה חייבות להיות בין ‎-1000 ל־1000 מטר.');
      onPoints([[v.ax, v.az], [v.bx, v.bz]]);
    }} />
    <output className="cad-measure-result" aria-live="polite">{result ? `מרחק ${lengthText(result.distance, units)}` : points.length === 1 ? 'בחרו נקודה שנייה' : 'בחרו שתי נקודות'}</output>
    <Button size="sm" variant="secondary" onClick={() => onPoints([])}>ניקוי מדידה</Button>
  </section>;
}