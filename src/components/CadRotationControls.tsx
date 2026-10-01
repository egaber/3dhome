import { RotateCcw, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { rotationCommand, rotationInfo } from '../lib/cadRotation';
import type { CadSelection } from '../lib/cadEditor';
import type { CadCommand } from '../model/cad';
import { normalizeRotation } from '../model/rotation';
import type { SimulationState } from '../model/types';
import { Button } from './ui/button';
import { NumericDraftForm } from './CadFields';

export function CadRotationControls({ state, selection, onCommand }: {
  state: SimulationState; selection: CadSelection; onCommand: (command: CadCommand, label: string) => void;
}) {
  const [error, setError] = useState('');
  const info = rotationInfo(state, selection);
  if (!info) return null;
  const apply = (angle: number) => {
    const command = rotationCommand(state, selection, angle);
    if (command) onCommand(command, 'סיבוב אובייקט בתוכנית 2D');
  };
  return <section className="cad-rotation" aria-label="סיבוב אובייקט">
    <h3>סיבוב</h3>
    <div className="cad-rotation-buttons" role="group" aria-label="סיבוב מהיר">
      {([-90, -15, 15, 90] as const).map(step => <Button key={step} size="sm" variant="secondary"
        aria-label={`סיבוב ${step > 0 ? 'ימינה' : 'שמאלה'} ${Math.abs(step)} מעלות`}
        onClick={() => { try { apply(normalizeRotation(info.angle + step)); setError(''); } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'לא ניתן לסובב את האובייקט.');
        } }}>
        {step > 0 ? <RotateCw size={16} /> : <RotateCcw size={16} />}<bdi>{Math.abs(step)}°</bdi>
      </Button>)}
    </div>
    {error && <p role="alert" className="cad-error">{error}</p>}
    <NumericDraftForm key={info.angle} units="m" submitLabel="החלת סיבוב"
      fields={[{ name: 'angle', label: 'זווית סיבוב °', value: info.angle, dimension: false }]}
      onApply={v => apply(v.angle)} />
    <p className="small-note">{info.note} זווית מקומית לפני שינוי מידות/סיבוב היחידה; מידות מקומיות נשמרות. <bdi>R / Shift+R</bdi> לסיבוב של 15° כשהתוכנית ממוקדת.</p>
  </section>;
}