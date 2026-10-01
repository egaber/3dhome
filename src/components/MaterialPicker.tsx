import { useEffect, useRef, useState } from 'react';
import type { SimulationState } from '../model/types';
import { assignMaterial, emptyAppearance, FINISHES, FINISH_NAMES } from '../model/appearance';
import { importMaterialImage } from '../lib/materialImage';
import { saveProject, serializeProject } from '../lib/project';
import { Button } from './ui/button';
import '../components/materialLibrary.css';

export function MaterialPicker({ state, target, onChange }: { state: SimulationState; target: string; onChange: (state: SimulationState, label?: string) => void }) {
  const appearance = state.appearance ?? emptyAppearance(), assigned = appearance.assignments[target];
  const [material, setMaterial] = useState(assigned?.material ?? ''), [metres, setMetres] = useState(assigned?.metres ?? 1);
  const [roughness, setRoughness] = useState(assigned?.roughness ?? .6), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const current = useRef(state); current.current = state;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const input = useRef<HTMLInputElement>(null);
  const publish = (next: SimulationState, label: string) => {
    serializeProject(next); onChange(next, label); setError('');
  };
  return <section className="object-material" aria-label="חומר האובייקט">
    <h3>חומר וגימור</h3>
    <label>חומר<select aria-label="חומר האובייקט" value={material} onChange={e => setMaterial(e.target.value)}>
      <option value="">ברירת מחדל / חומרי המודל המקוריים</option>
      {FINISHES.map(id => <option key={id} value={id}>{FINISH_NAMES[id]}</option>)}
      {appearance.images.map(image => <option key={image.id} value={image.id}>{image.name}</option>)}
    </select></label>
    <div className="material-fields"><label>חזרה במטרים<input aria-label="חזרת חומר במטרים" type="number" min="0.05" max="20" step="0.05" value={metres} onChange={e => setMetres(e.target.valueAsNumber)} /></label>
      <label>חספוס 0–1<input aria-label="חספוס חומר" type="number" min="0" max="1" step="0.05" value={roughness} onChange={e => setRoughness(e.target.valueAsNumber)} /></label></div>
    <Button size="sm" onClick={() => {
      try { publish(assignMaterial(state, target, material ? { material, metres, roughness } : null), 'שינוי חומר אובייקט'); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'חומר לא תקין'); }
    }}>החלת חומר</Button>
    <Button size="sm" variant="secondary" disabled={busy || appearance.images.length >= 12} onClick={() => input.current?.click()}>{busy ? 'מעבד תמונה…' : 'הוספת חומר מתמונה'}</Button>
    <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="תמונת חומר" onChange={async event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return;
      const base = state; setBusy(true); setError('');
      try {
        const image = await importMaterialImage(file);
        if (!mounted.current) return;
        if (current.current !== base) throw new Error('הפרויקט השתנה בזמן עיבוד התמונה; בחרו שוב את התמונה.');
        const id = `image-${crypto.randomUUID()}`, next = { ...base, appearance: { ...appearance, images: [...appearance.images, { id, name: file.name.slice(0, 180), image }] } };
        const applied = assignMaterial(next, target, { material: id, metres: 1, roughness: .6 });
        serializeProject(applied);
        if (!saveProject(applied)) throw new Error('אין מקום בשמירת הדפדפן; החומר לא נוסף. שמרו גיבוי ופנו מקום.');
        publish(applied, 'הוספת חומר מתמונה'); setMaterial(id); setMetres(1); setRoughness(.6);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'לא ניתן לקרוא תמונה'); }
      finally { setBusy(false); }
    }} />
    {material.startsWith('image-') && <img className="custom-material-preview" src={appearance.images.find(i => i.id === material)?.image} alt="תצוגה מקדימה של החומר" />}
    {material.startsWith('image-') && <Button size="sm" variant="secondary" onClick={() => {
      const assignments = Object.fromEntries(Object.entries(appearance.assignments).filter(([, a]) => a.material !== material));
      publish({ ...state, appearance: { ...appearance, assignments, images: appearance.images.filter(i => i.id !== material) } }, 'הסרת חומר מהספרייה'); setMaterial('');
    }}>הסרת התמונה מכל ההקצאות</Button>}
    <small>הגימור מוצג במצב ריאליסטי. תמונה מוסיפה צבע בלבד — לא מפות עומק/PBR. עד 12 תמונות מוקטנות; כל התמונות נכללות בקובץ הפרויקט.</small>
    {error && <p role="alert" className="cad-error">{error}</p>}
  </section>;
}