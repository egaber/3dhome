import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';
import { MODEL_ASSETS, SURFACE_ASSETS, surfaceUrl } from '../scene/materialLibrary';
import './materialLibrary.css';
import { EXTRA_MODELS, type CatalogModel } from '../model/modelCatalog';
import { emptyAppearance, surfaceTarget } from '../model/appearance';
import { FLOOR_NAMES, UNIT_NAMES, type FloorId, type SimulationState, type UnitId } from '../model/types';
import { resolvedFurniture, resolvedOpenings, resolvedWalls, FOOTPRINTS } from '../model/plans';
import { applyCadCommand } from '../model/cad';
import { serializeProject } from '../lib/project';
import { FURNITURE_NAMES } from '../lib/cadEditor';
import { MaterialPicker } from './MaterialPicker';
import { assetUrl } from '../scene/materialLibrary';

export function MaterialLibrary({ onClose, onEnable, state, onChange, selectedUnit = 'north', onPick, backup, onBackup }: {
  onClose: () => void; onEnable: () => void; state?: SimulationState;
  onChange?: (state: SimulationState, label?: string) => void; selectedUnit?: UnitId;
  onPick?: (selection: { type: 'furniture'; id: string; unit: UnitId }) => void;
  backup?: { connect: () => Promise<void>; disconnect: () => void; connected: boolean; supported: boolean; status: string };
  onBackup?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState('materials'), [unit, setUnit] = useState<UnitId>(selectedUnit), [floor, setFloor] = useState<FloorId>(state?.view.planFloor ?? 'ground');
  const [target, setTarget] = useState(surfaceTarget('floor', selectedUnit, state?.view.planFloor ?? 'ground'));
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [error, setError] = useState('');
  const add = (model: CatalogModel) => {
    if (!state || !onChange) return;
    try {
      const ring = FOOTPRINTS[floor][unit], center: [number, number] = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      const id = `catalog-${crypto.randomUUID()}`, [width, depth, height] = model.dimensions;
      const next = applyCadCommand(state, { type: 'add-furniture', item: { id, kind: model.kind, unit, floor, center, width, depth, height, rotation: 0, source: 'added' } });
      next.appearance = { ...(state.appearance ?? emptyAppearance()), models: { ...state.appearance?.models, [id]: model.id } };
      next.view = { ...next.view, renderMode: 'realistic' };
      serializeProject(next); onChange(next, `הוספת ${model.name}`); onPick?.({ type: 'furniture', id, unit }); setError(''); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'לא ניתן להוסיף פריט'); }
  };
  useEffect(() => {
    const previous = document.activeElement, dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="material-library" dir="rtl" aria-labelledby="material-library-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not([hidden]), select')).filter(el => el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header><div><h2 id="material-library-title">חומרים וריהוט מציאותיים</h2><p>חומרי PBR אמיתיים · ריהוט glTF · ללא שרת AI</p></div>
      <Button autoFocus size="icon" variant="ghost" aria-label="סגירת ספריית חומרים" onClick={onClose}><X size={20} /></Button></header>
    {state && onChange && <>
      <div className="library-tabs" role="group" aria-label="תוכן ספרייה"><Button variant={tab === 'materials' ? 'primary' : 'secondary'} onClick={() => setTab('materials')}>חומרים ומשטחים</Button><Button variant={tab === 'models' ? 'primary' : 'secondary'} onClick={() => setTab('models')}>קטלוג ריהוט ומכשירים ({EXTRA_MODELS.length})</Button></div>
      <div className="catalog-controls"><label>יחידה<select aria-label="יחידת ספרייה" value={unit} onChange={e => { const next = e.target.value as UnitId; setUnit(next); setTarget(surfaceTarget('floor', next, floor)); }}>{Object.entries(UNIT_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>קומה<select aria-label="קומת ספרייה" value={floor} onChange={e => { const next = e.target.value as FloorId; setFloor(next); setTarget(surfaceTarget('floor', unit, next)); }}>{Object.entries(FLOOR_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
      {tab === 'materials' ? <div className="library-target"><label>משטח או אובייקט<select aria-label="אובייקט לחומר" value={target} onChange={e => setTarget(e.target.value)}>
        {(['basement', 'ground', 'first', 'roof'] as const).flatMap(f => (['floor', 'ceiling'] as const).map(kind => <option key={`${kind}-${f}`} value={surfaceTarget(kind, unit, f)}>{kind === 'floor' ? 'רצפה' : 'תקרה'} · {f === 'roof' ? 'גג' : FLOOR_NAMES[f]}</option>))}
        {['basement', 'ground'].map(f => <option key={f} value={`stair-stair-${unit}-${f}`}>מדרגות · {f === 'ground' ? 'קרקע–ראשונה' : 'מרתף–קרקע'}</option>)}
        {resolvedWalls(state).filter(i => i.unit === unit && i.floor === floor).map(i => <option key={i.id} value={`wall-${i.id}`}>קיר · {i.id}</option>)}
        {resolvedOpenings(state).filter(i => i.unit === unit && i.floor === floor && i.width > 0).map(i => <option key={i.id} value={`opening-${i.id}`}>{i.label}</option>)}
        {resolvedFurniture(state).filter(i => i.unit === unit && i.floor === floor).map(i => <option key={i.id} value={`furniture-${i.id}`}>{FURNITURE_NAMES[i.kind]} · {i.id}</option>)}
      </select></label><MaterialPicker key={JSON.stringify([target, state.appearance?.assignments[target]])} state={state} target={target} onChange={onChange} /></div>
      : <><div className="catalog-controls"><label>חיפוש בקטלוג<input aria-label="חיפוש ריהוט" value={search} onChange={e => setSearch(e.target.value)} placeholder="מקרר, מיטה, modern…" /></label>
        <label>קטגוריה<select aria-label="קטגוריית ריהוט" value={category} onChange={e => setCategory(e.target.value)}><option value="all">הכול</option>{Object.entries(FURNITURE_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
        <p className="small-note">33 מודלים נוספים מקומיים: 32 גאומטריות קלות של Kenney וכורסת עץ/עור PBR של Poly Haven. הפריטים הקלים אינם סריקות פוטוריאליסטיות. מידות הן הצעות לעריכה; חלק מהמכשירים משתמשים בסמל 2D כללי.</p>
        <div className="catalog-grid">{EXTRA_MODELS.filter(m => (category === 'all' || m.kind === category) && `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase())).map(model => <article className="catalog-card" key={model.id}>
          {model.id.startsWith('kenney-') && <img src={assetUrl(model.file.replace('.glb', '.png'))} alt={model.name} loading="lazy" />}
          <strong>{model.name}</strong><small>{model.style} · {model.author} · CC0</small><a href={model.source} target="_blank" rel="noreferrer">מקור ורישיון</a><Button size="sm" onClick={() => add(model)}>הוספת {model.name}</Button>
        </article>)}</div>
        {!EXTRA_MODELS.some(m => (category === 'all' || m.kind === category) && `${m.name} ${m.id}`.toLowerCase().includes(search.toLowerCase())) && <p role="status">לא נמצאו פריטים. נסו חיפוש אחר או קטגוריה אחרת.</p>}
        <p>חיפוש במקור חיצוני (נפתח באתר הספק, אינו מייבא אוטומטית): <a href={`https://polyhaven.com/models?s=${encodeURIComponent(search || 'modern furniture')}`} target="_blank" rel="noreferrer">Poly Haven</a> · <a href={`https://ambientcg.com/list?q=${encodeURIComponent(search || 'wood')}`} target="_blank" rel="noreferrer">ambientCG</a></p>
      </>}
      {error && <p role="alert" className="cad-error">{error}</p>}
    </>}
    <p>במצב ריאליסטי החומרים משויכים אוטומטית: טיח לקירות, אריחים לרצפה, עץ לדלתות ולרהיטים, שיש למשטחי המטבח ובד לריפוד ולמיטות. כלים סניטריים מקבלים קרמיקה מבריקה; כיורים ומכשירים מקבלים מתכת.</p>
    <div className="material-grid">{SURFACE_ASSETS.map(asset => <article key={asset.id}>
      <img src={surfaceUrl(asset.id, 'color')} alt={`דוגמת ${asset.name}`} loading="lazy" width={160} height={100} />
      <h3>{asset.name}</h3><small>צבע · נורמל OpenGL · חספוס · 1K</small>
      <a href={`https://polyhaven.com/a/${asset.id}`} target="_blank" rel="noreferrer">Poly Haven · {asset.author} · CC0</a>
    </article>)}</div>
    <h3>מודלים מפורטים מהרשת</h3>
    <ul>{MODEL_ASSETS.map(asset => <li key={asset.id}><a href={asset.source} target="_blank" rel="noreferrer">{asset.name}</a> — {asset.author} · <a href={asset.license === 'CC0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/licenses/by/4.0/'} target="_blank" rel="noreferrer">{asset.license}</a></li>)}</ul>
    <p className="small-note">אפשר להוסיף מודלים מהקטלוג ולערוך את המידות, המיקום, הסיבוב והחומר של כל פריט. חומר כוללני על רהיט מחליף את כל חלקיו; חזרה לברירת מחדל משחזרת את חומרי המקור. אין ייבוא של קובץ GLB אישי.</p>
    <p className="small-note">כ־21 MB נטענים מהאתר רק בהפעלת מצב ריאליסטי (דוגמיות נטענות בפתיחת הספרייה). אין פנייה לספק חיצוני. תקלה בטעינה משאירה את הגאומטריה הבסיסית. גימורי התצוגה אינם משנים את חישוב השמש. זו תצוגת זמן־אמת, לא הדמיית Path Tracing.</p>
    {backup && <section className="library-target"><h3>גיבוי ושמירת נכסים</h3><p className="small-note">התמונות נשמרות בפרויקט; מודלים וטקסטורות נשמרים במטמון IndexedDB. מטמון דפדפן יכול להימחק — קובץ הגיבוי כולל את הנכסים עצמם. אין התחייבות לאי־אובדן נתונים בלי גיבוי חיצוני.</p>
      <div className="library-tabs"><Button onClick={onBackup}>הורדת גיבוי עם נכסים</Button>{backup.supported && <Button variant="secondary" onClick={backup.connected ? backup.disconnect : backup.connect}>{backup.connected ? 'ניתוק גיבוי מתעדכן' : 'בחירת קובץ לגיבוי מתעדכן'}</Button>}</div>
      <small>גיבוי מתעדכן דורש בחירת קובץ והרשאת דפדפן בכל סשן; השינוי נכתב לאחר השהיה קצרה. שימו לב למצב השמירה לפני סגירה.</small><p role="status">{backup.status}</p></section>}
    <footer><Button onClick={onEnable}>הפעלת חומרים וריהוט ריאליסטיים</Button></footer>
  </dialog>;
}