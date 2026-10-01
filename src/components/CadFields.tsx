import { useId, useState } from 'react';
import { Button } from './ui/button';
import { lengthText, type DisplayUnit } from '../lib/cadEditor';
import { getFloorLevels } from '../model/cad';
import type { BuildingSettings, FloorId } from '../model/types';

export interface NumericField { name: string; label: string; value: number; dimension?: boolean; step?: number }
/** Draft strings stay local. Validation and publication happen once, on submit, never on blur. */
export function NumericDraftForm({ fields, units, onApply, submitLabel = 'החלת מידות', children, skipUnchanged = false }: {
  fields: NumericField[]; units: DisplayUnit; onApply: (values: Record<string, number>) => void;
  submitLabel?: string; children?: React.ReactNode; skipUnchanged?: boolean;
}) {
  const errorId = useId();
  const [error, setError] = useState('');
  const [initial] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.name,
    String(Number((f.value * (f.dimension !== false && units === 'mm' ? 1000 : 1)).toFixed(6)))])));
  const [draft, setDraft] = useState(initial);
  return <form className="cad-numeric-form" noValidate onSubmit={event => {
    event.preventDefault();
    try {
      const values: Record<string, number> = {};
      for (const field of fields) {
        const raw = draft[field.name]?.trim();
        if (!raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(raw))) throw new Error('יש להזין מספר סופי בכל השדות; הערכים הקודמים לא שונו.');
        // Preserve untouched model precision rather than round-tripping display formatting.
        values[field.name] = Number(raw) === Number(initial[field.name]) ? field.value
          : Number(raw) / (field.dimension !== false && units === 'mm' ? 1000 : 1);
      }
      if (skipUnchanged && fields.every(f => values[f.name] === f.value)) { setError(''); return; }
      onApply(values); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'העריכה אינה תקינה. הערכים הקודמים נשמרו.'); }
  }}>
    <div className="cad-fields">{fields.map(field => <label key={field.name}>
      <span>{field.label}{field.dimension !== false ? ` (${units === 'mm' ? 'מ״מ' : 'מ׳'})` : ''}</span>
      <input type="number" inputMode="decimal" dir="ltr" step={field.step ?? (field.dimension !== false ? units === 'mm' ? 10 : .01 : 1)}
        value={draft[field.name]} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        onChange={event => setDraft(previous => ({ ...previous, [field.name]: event.target.value }))} />
    </label>)}</div>
    {children}
    {error && <p id={errorId} role="alert" className="cad-error">{error}</p>}
    <Button type="submit" size="sm">{submitLabel}</Button>
  </form>;
}

export function FloorHeightReadout({ floor, building, units = 'm' }: { floor: FloorId; building: BuildingSettings; units?: DisplayUnit }) {
  const levels = getFloorLevels(floor, building);
  return <div className="cad-floor-levels" aria-label="מפלסים וגובה קומה">{levels ? <>
    <span>מפלס <bdi>{lengthText(levels.elevation, units)}</bdi></span>
    <span>גובה קומה <bdi>{lengthText(levels.storeyHeight, units)}</bdi></span>
    <span>גובה פנוי <bdi>{lengthText(levels.clearHeight, units)}</bdi></span>
  </> : <span>היחידה או הקומה אינן פעילות</span>}</div>;
}