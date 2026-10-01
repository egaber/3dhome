import { useState } from 'react';
import { applyObjectCommand } from '../model/cad';
import type { SimulationState } from '../model/types';
import { serializeProject } from '../lib/project';
import { stairSelection } from '../lib/cadRotation';
import { MaterialPicker } from './MaterialPicker';
import { Button } from './ui/button';
import { EXTRA_MODELS } from '../model/modelCatalog';
import { emptyAppearance } from '../model/appearance';
import { MODEL_ASSETS } from '../scene/materialLibrary';

export function ObjectActions({ state, selection, onChange, onSelect }: {
  state: SimulationState; selection: { type: string; id: string };
  onChange: (state: SimulationState, label?: string) => void; onSelect?: (selection: { type: 'furniture' | 'opening'; id: string }) => void;
}) {
  const [error, setError] = useState('');
  const stair = selection.type === 'stair' ? stairSelection({ type: 'stair', id: selection.id }) : null;
  const target = selection.type === 'floor' || selection.type === 'ceiling' ? selection.id : `${selection.type}-${selection.id}`;
  return <>
    {selection.type === 'furniture' && <label className="object-material">מודל תלת־ממד<select aria-label="מודל רהיט" value={state.appearance?.models[selection.id] ?? ''} onChange={e => {
      const appearance = state.appearance ?? emptyAppearance(), models = { ...appearance.models };
      if (e.target.value) models[selection.id] = e.target.value; else delete models[selection.id];
      const next = { ...state, appearance: { ...appearance, models } }; serializeProject(next); onChange(next, 'החלפת מודל רהיט');
    }}><option value="">ברירת מחדל לפי סוג</option><option value="parametric">גאומטריה בסיסית</option>{MODEL_ASSETS.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}{EXTRA_MODELS.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}</select><small>החלפת המודל שומרת על מידות הפריט הקיים. עדכנו מידות כדי לשמור על פרופורציות.</small></label>}
    {(selection.type === 'furniture' || selection.type === 'opening') && <Button size="sm" variant="secondary" onClick={() => {
      try {
        const type = selection.type as 'furniture' | 'opening', id = `copy-${crypto.randomUUID()}`;
        const next = applyObjectCommand(state, { type: type === 'furniture' ? 'duplicate-furniture' : 'duplicate-opening', id: selection.id, newId: id });
        serializeProject(next); onChange(next, 'שכפול אובייקט'); onSelect?.({ type, id }); setError('');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'לא ניתן לשכפל'); }
    }}>שכפול אובייקט</Button>}
    {stair && <div className="object-material"><label>קנה מידה אופקי של מדרגות<input aria-label="קנה מידה מדרגות" type="number" min="0.5" max="2" step="0.1" defaultValue={state.buildings[stair.unit].stairScale ?? 1} onBlur={event => {
      try { const next = applyObjectCommand(state, { type: 'stair-options', unit: stair.unit, scale: event.target.valueAsNumber, enabled: true }); serializeProject(next); onChange(next, 'שינוי גודל מדרגות'); setError(''); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'גודל לא תקין'); }
    }} /></label><Button size="sm" variant="secondary" onClick={() => onChange(applyObjectCommand(state, { type: 'stair-options', unit: stair.unit, scale: state.buildings[stair.unit].stairScale ?? 1, enabled: false }), 'הסרת מדרגות')}>הסרת מדרגות היחידה</Button>
    <small>משנה את שני החיבורים ואת החורים בתקרות. החזרה באמצעות Undo. אין שכפול לגרם מבני נוסף.</small></div>}
    {selection.type !== 'room' && <MaterialPicker key={JSON.stringify([target, state.appearance?.assignments[target]])} state={state} target={target} onChange={onChange} />}
    {error && <p role="alert" className="cad-error">{error}</p>}
  </>;
}