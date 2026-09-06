import { DoorOpen, Move, Scaling, Trash2, X } from 'lucide-react';
import { Button } from './ui/button';
import type { SimulationState, UnitId } from '../model/types';
import { resolvedOpenings } from '../model/plans';

export type PickedObject = { type: 'opening' | 'building' | 'neighbor'; id: string; unit?: UnitId };

export function QuickObjectEditor({ picked, state, onChange, onClose }: {
  picked: PickedObject;
  state: SimulationState;
  onChange: (state: SimulationState) => void;
  onClose: () => void;
}) {
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
    </section>;
  }
  const opening = resolvedOpenings(state).find(item => item.id === picked.id);
  if (!opening) return null;
  const patch = (next: Partial<typeof opening>) => onChange({ ...state, openings: { ...state.openings, [opening.id]: { ...state.openings[opening.id], ...next } } });
  return <section className="quick-editor" aria-label="עריכה מהירה של פתח">
    <header><strong><DoorOpen size={15} /> {opening.label}</strong><Button size="icon" variant="ghost" onClick={onClose}><X size={15} /></Button></header>
    <div className="quick-actions"><span><Move size={14} /> מיקום</span>
      <Button size="sm" onClick={() => patch({ position: Math.max(0, opening.position - .025) })}>←</Button>
      <Button size="sm" onClick={() => patch({ position: Math.min(1, opening.position + .025) })}>→</Button></div>
    <div className="quick-actions"><span><Scaling size={14} /> גודל</span>
      <Button size="sm" onClick={() => patch({ width: Math.max(.2, opening.width - step), height: Math.max(.2, opening.height - step) })}>−</Button>
      <Button size="sm" onClick={() => patch({ width: Math.min(45, opening.width + step), height: Math.min(6, opening.height + step) })}>+</Button></div>
    <Button variant="ghost" onClick={() => patch({ width: 0, height: 0 })}><Trash2 size={15} /> מחיקת הפתח</Button>
  </section>;
}
