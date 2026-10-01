import { useRef, useState } from 'react';
import { Move, Scaling, Trash2, X } from 'lucide-react';
import { Button } from './ui/button';
import type { SimulationState, UnitId } from '../model/types';
import { applyCadCommand, type CadCommand } from '../model/cad';
import { CadProperties } from './CadProperties';
import { StairControls } from './StairControls';
import { stairSelection } from '../lib/cadRotation';
import type { SceneSelection } from '../lib/viewerMeasurement';
import './viewerCad.css';
import { ObjectActions } from './ObjectActions';

export type PickedObject = SceneSelection;

export function QuickObjectEditor({ picked, state, onChange, onClose, onSelect }: {
  picked: PickedObject;
  state: SimulationState;
  onChange: (state: SimulationState, label?: string) => void;
  onClose: () => void;
  onSelect: (picked: PickedObject) => void;
}) {
  const [error, setError] = useState('');
  const accepted = useRef(true);
  const command = (next: CadCommand, label: string) => {
    try { const value = applyCadCommand(state, next); accepted.current = true; onChange(value, label); setError(''); }
    catch (cause) { accepted.current = false; setError(cause instanceof Error ? cause.message : 'העריכה לא בוצעה'); }
  };
  const step = .25;
  if (picked.type === 'building') {
    const unit = picked.id as UnitId;
    const item = state.buildings[unit];
    const patch = (next: Partial<typeof item>) => onChange({ ...state, buildings: { ...state.buildings, [unit]: { ...item, ...next } } });
    return <section className="quick-editor" aria-label="עריכה מהירה של מבנה">
      <header><strong>מבנה {unit === 'north' ? 'א׳' : 'ב׳'}</strong><Button size="icon" variant="ghost" onClick={onClose}><X size={15} /></Button></header>
      <div className="quick-actions"><span><Move size={14} /> הזזה</span>
        <Button size="sm" onClick={() => patch({ x: item.x - step })}>←</Button><Button size="sm" onClick={() => patch({ x: item.x + step })}>→</Button>
        <Button size="sm" onClick={() => patch({ z: item.z - step })}>↑</Button><Button size="sm" onClick={() => patch({ z: item.z + step })}>↓</Button></div>
      <div className="quick-actions"><span><Scaling size={14} /> גודל</span>
        <Button size="sm" onClick={() => patch({ width: Math.max(5, item.width - step), depth: Math.max(3, item.depth - step) })}>−</Button>
        <Button size="sm" onClick={() => patch({ width: Math.min(18, item.width + step), depth: Math.min(20, item.depth + step) })}>+</Button></div>
      <Button variant="ghost" onClick={() => patch({ enabled: false })}><Trash2 size={15} /> הסתרת המבנה</Button>
      <ObjectActions state={state} selection={picked} onChange={onChange} />
    </section>;
  }
  if (picked.type === 'neighbor') {
    const item = state.neighbors.find(neighbor => neighbor.id === picked.id);
    if (!item) return null;
    const patch = (next: Partial<typeof item>) => onChange({ ...state, neighbors: state.neighbors.map(neighbor => neighbor.id === item.id ? { ...neighbor, ...next } : neighbor) });
    return <section className="quick-editor" aria-label="עריכה מהירה של שכן">
      <header><strong>{item.name}</strong><Button size="icon" variant="ghost" onClick={onClose}><X size={15} /></Button></header>
      <div className="quick-actions"><span><Move size={14} /> הזזה</span>
        <Button size="sm" onClick={() => patch({ x: item.x - step })}>←</Button><Button size="sm" onClick={() => patch({ x: item.x + step })}>→</Button>
        <Button size="sm" onClick={() => patch({ z: item.z - step })}>↑</Button><Button size="sm" onClick={() => patch({ z: item.z + step })}>↓</Button></div>
      <div className="quick-actions"><span><Scaling size={14} /> גודל</span>
        <Button size="sm" onClick={() => patch({ width: Math.max(1, item.width - step), depth: Math.max(1, item.depth - step) })}>−</Button>
        <Button size="sm" onClick={() => patch({ width: Math.min(45, item.width + step), depth: Math.min(45, item.depth + step) })}>+</Button></div>
      <Button variant="ghost" onClick={() => patch({ enabled: false })}><Trash2 size={15} /> הסתרת השכן</Button>
      <ObjectActions state={state} selection={picked} onChange={onChange} />
    </section>;
  }
  if (picked.type === 'floor' || picked.type === 'ceiling') return <section className="quick-editor cad-quick-editor" aria-label="עריכת חומר משטח">
    <header><strong>{picked.type === 'floor' ? 'רצפה' : 'תקרה'}</strong><Button aria-label="סגירת עריכה מהירה" size="icon" variant="ghost" onClick={onClose}><X size={15} /></Button></header>
    <div className="cad-quick-scroll"><ObjectActions state={state} selection={picked} onChange={onChange} /><p className="small-note">משטח מבני: המידות והמיקום נגזרים מהמבנה. אין שכפול/מחיקה כרהיט.</p></div>
  </section>;
  const selection = { type: picked.type, id: picked.id };
  const stair = stairSelection(selection);
  return <section className="quick-editor cad-quick-editor" aria-label="עריכה מהירה של אובייקט">
    <header><strong>עריכה מדויקת</strong><Button size="icon" variant="ghost" aria-label="סגירת עריכה מהירה" onClick={onClose}><X size={15} /></Button></header>
    <div className="cad-quick-scroll">
    {error && <p role="alert" className="cad-error">{error}</p>}
    <CadProperties key={JSON.stringify([picked, state.design, state.buildings, state.openings, state.addedOpenings])}
      state={state} selection={selection} units="m" onCommand={command} onChange={onChange} onSelect={selection => {
        if (!accepted.current) return;
        if (!selection) onClose();
        else if (selection.type !== 'room') onSelect({ type: selection.type, id: selection.id, unit: picked.unit });
      }} />
    {stair && <StairControls state={state} unit={stair.unit} fromFloor={stair.fromFloor} onCommand={command} />}
    </div>
  </section>;
}
