import { useRef, useState } from 'react';
import { Check, Pencil, Ruler, Trash2, Upload } from 'lucide-react';
import { ShowroomDialog } from './ShowroomDialog';
import { calibratedScale, detectImageLines, extractVectorPdf, reconstructPlan, type PlanSegment, type PlanSource } from '../lib/planReconstruction';
import type { SimulationState, Vec2 } from '../model/types';
import './planImport.css';

export function PlanImportDialog({ onClose, onApply, persistenceError }: { state: SimulationState; onClose: () => void; onApply: (state: SimulationState, name: string) => void; persistenceError?: string }) {
  const [source, setSource] = useState<PlanSource | null>(null), [segments, setSegments] = useState<PlanSegment[]>([]);
  const [calibration, setCalibration] = useState<Vec2[]>([]), [metres, setMetres] = useState('5'), [thickness, setThickness] = useState('.18');
  const [tool, setTool] = useState<'calibrate' | 'draw' | 'select'>('calibrate'), [start, setStart] = useState<Vec2 | null>(null);
  const [selected, setSelected] = useState<number | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState('תוכנית חדשה'), [minimum, setMinimum] = useState('40'), [confirmed, setConfirmed] = useState(false);
  const [pageNumber, setPageNumber] = useState(1), [pageCount, setPageCount] = useState(1);
  const pdf = useRef<Uint8Array | null>(null), pixels = useRef<ImageData | null>(null), sequence = useRef(0), svg = useRef<SVGSVGElement>(null);
  let scale: number | null = null;
  if (calibration.length === 2) {
    try { scale = calibratedScale(calibration[0], calibration[1], Number(metres)); } catch { /* Draft calibration is shown as incomplete below. */ }
  }
  const currentScale = scale;
  const filter = (input: PlanSegment[], length = Number(minimum)) => input.filter(line => Math.hypot(line.a[0] - line.b[0], line.a[1] - line.b[1]) >= length);
  const reset = (next: PlanSource) => {
    setSource(next); setSegments(filter(next.segments)); setCalibration([]); setSelected(null); setStart(null);
    setConfirmed(false); setTool('calibrate'); setName(next.name.replace(/\.(pdf|jpe?g|png|webp)$/i, '').slice(0, 80));
  };
  const load = async (file: File) => {
    const job = ++sequence.current;
    setBusy(true); setError(''); pdf.current = null; pixels.current = null;
    try {
      if (file.size > 12_000_000) throw new Error('בחרו קובץ עד 12 MB.');
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer()), page = await extractVectorPdf(bytes);
        if (job !== sequence.current) return;
        pdf.current = bytes; setPageCount(page.pageCount); setPageNumber(1); reset({ ...page, name: file.name });
      } else {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('נתמכים PDF וקטורי, JPEG, PNG או WebP בלבד.');
        const bitmap = await createImageBitmap(file);
        try {
          if (bitmap.width * bitmap.height > 32_000_000) throw new Error('התמונה גדולה מדי. הקטינו אותה לפחות מ־32 מיליון פיקסלים.');
          const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
          canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
          const context = canvas.getContext('2d'); if (!context) throw new Error('פענוח תמונה אינו זמין בדפדפן.');
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          if (job !== sequence.current) return;
          pixels.current = image; setPageCount(1);
          reset({ name: file.name, width: canvas.width, height: canvas.height, image: canvas.toDataURL('image/jpeg', .88),
            segments: detectImageLines(image.data, image.width, image.height, Number(minimum)),
            warnings: ['זיהוי התמונה מוצא קווים אופקיים ואנכיים בלבד. קווים אלכסוניים, פתחים והפרדה מטקסט דורשים תיקון ידני. צילום בפרספקטיבה אינו מדידה מדויקת.'] });
        } finally { bitmap.close(); }
      }
    } catch (cause) { if (job === sequence.current) setError(cause instanceof Error ? cause.message : 'הקובץ לא נטען.'); }
    finally { if (job === sequence.current) setBusy(false); }
  };
  const point = (event: { clientX: number; clientY: number }): Vec2 | null => {
    const matrix = svg.current?.getScreenCTM(); if (!matrix) return null;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [Math.max(0, Math.min(source!.width, p.x)), Math.max(0, Math.min(source!.height, p.y))];
  };
  return <ShowroomDialog title="מתוכנית לבית · ייבוא וכיול" error={persistenceError} onClose={() => { sequence.current++; onClose(); }} wide>
    <p>1. בחרו קובץ · 2. סמנו שני קצוות של מידה ידועה · 3. בדקו ותקנו את הקווים · 4. שמרו כחלופה חדשה.</p>
    <div className="plan-import-layout">
      <aside>
        <label className="plan-file"><Upload size={18} /> PDF / JPEG / PNG<input aria-label="קובץ תוכנית" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
          disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void load(file); event.currentTarget.value = ''; }} /></label>
        {pageCount > 1 && <label>עמוד PDF<select disabled={busy} value={pageNumber} onChange={async event => {
          const n = Number(event.target.value), bytes = pdf.current; if (!bytes) return;
          const job = ++sequence.current; setBusy(true); setError('');
          try { const page = await extractVectorPdf(bytes, n); if (job === sequence.current) { setPageNumber(n); reset(page); } }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'טעינת העמוד נכשלה.'); }
          finally { if (job === sequence.current) setBusy(false); }
        }}>{Array.from({ length: pageCount }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>}
        <div className="plan-import-tools" role="group" aria-label="כלי שחזור תוכנית">
          <button className={tool === 'calibrate' ? 'is-active' : ''} onClick={() => { setTool('calibrate'); setCalibration([]); setConfirmed(false); }}><Ruler size={16} /> כיול</button>
          <button className={tool === 'draw' ? 'is-active' : ''} onClick={() => { setTool('draw'); setStart(null); }}><Pencil size={16} /> קיר</button>
          <button className={tool === 'select' ? 'is-active' : ''} onClick={() => setTool('select')}>בחירה</button>
        </div>
        <label>המרחק האמיתי בין הנקודות (מטרים)<input type="number" min=".01" max="100" step=".01" value={metres} onChange={event => { setMetres(event.target.value); setConfirmed(false); }} /></label>
        <p className="plan-calibration" role="status">{currentScale ? `כויל: יחידת מקור = ${(currentScale * 1000).toFixed(2)} מ״מ` : 'סמנו שתי נקודות והזינו את המרחק ביניהן.'}</p>
        <label>עובי קירות (מטרים)<input type="number" min=".05" max="1" step=".01" value={thickness} onChange={event => setThickness(event.target.value)} /></label>
        <label>אורך קו מינימלי במקור<input type="number" min="5" step="5" value={minimum} onChange={event => setMinimum(event.target.value)} /></label>
        <button disabled={!source || busy} onClick={() => {
          try {
            const length = Number(minimum); if (!Number.isFinite(length) || length < 5) throw new Error('אורך מינימלי חייב להיות לפחות 5.');
            const image = pixels.current;
            setSegments(image ? detectImageLines(image.data, image.width, image.height, length) : filter(source!.segments, length));
            setConfirmed(false); setSelected(null); setError('');
          } catch (cause) { setError(cause instanceof Error ? cause.message : 'זיהוי הקווים נכשל.'); }
        }}>זיהוי קווים מחדש</button>
        <button disabled={selected === null} onClick={() => { setSegments(previous => previous.filter((_, index) => index !== selected)); setSelected(null); setConfirmed(false); }}><Trash2 size={15} /> הסרת הקו הנבחר</button>
        <button disabled={!source} onClick={() => { setSegments([]); setSelected(null); setConfirmed(false); }}>ניקוי קווים לשרטוט ידני</button>
      </aside>
      <div className="plan-preview">
        {busy && <p role="status">קורא ומפענח את התוכנית במכשיר…</p>}
        {!source && !busy && <div className="plan-empty"><GridIcon /><h3>התוכנית שלכם. בשליטה שלכם.</h3><p>הקבצים מפוענחים מקומית. לא נשלחים לשרת.</p></div>}
        {source && <svg ref={svg} viewBox={`0 0 ${source.width} ${source.height}`} aria-label="תצוגה מקדימה לכיול ועריכת התוכנית"
          onPointerDown={event => {
            if (event.button !== 0 || busy) return; const p = point(event); if (!p) return;
            setConfirmed(false);
            if (tool === 'calibrate') setCalibration(previous => previous.length === 1 ? [previous[0], p] : [p]);
            else if (tool === 'draw') {
              if (start && Math.hypot(p[0] - start[0], p[1] - start[1]) >= 5) { setSegments(previous => [...previous, { a: start, b: p }]); setStart(null); }
              else setStart(p);
            }
          }}>
          {source.image && <image href={source.image} width={source.width} height={source.height} opacity=".55" />}
          {segments.map((line, index) => <line key={index} className={selected === index ? 'selected' : ''}
            x1={line.a[0]} y1={line.a[1]} x2={line.b[0]} y2={line.b[1]} vectorEffect="non-scaling-stroke"
            onPointerDown={event => { if (tool === 'select') { event.stopPropagation(); setSelected(index); } }} />)}
          {calibration.length === 2 && <line className="calibration" x1={calibration[0][0]} y1={calibration[0][1]} x2={calibration[1][0]} y2={calibration[1][1]} vectorEffect="non-scaling-stroke" />}
          {[...calibration, ...(start ? [start] : [])].map((p, index) => <circle className="calibration" key={index} cx={p[0]} cy={p[1]} r={Math.max(source.width, source.height) * .007} />)}
        </svg>}
        {source && <p>{segments.length} קווים · קנה מידה אחיד · עובי וגובה הם ערכי תכנון, לא נתונים שזוהו מהקובץ.</p>}
      </div>
    </div>
    {source?.warnings.map(warning => <p className="plan-warning" key={warning}>{warning}</p>)}
    <p className="showroom-note">PDF: ייבוא קווים וקטוריים ישרים מעמודים פשוטים; לא OCR. JPEG: זיהוי ראשוני ועקיבה ידנית. הרצפה הראשונית היא מלבן תחום סביב הקירות. חלונות, דלתות וגבהים עורכים בעורך 2D. יש לאמת מידות לפני שימוש מקצועי.</p>
    {error && <p role="alert" className="plan-error">{error}</p>}
    <div className="plan-import-submit"><label>שם החלופה<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <label className="plan-approve"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> בדקתי את קנה המידה והקווים; זו תוכנית ראשונית לעריכה.</label>
      <button className="showroom-primary" disabled={!source || !currentScale || !segments.length || segments.length > 200 || busy || !confirmed || !name.trim()} onClick={() => {
        try { onApply(reconstructPlan(source!, segments, currentScale!, Number(thickness)), name.trim()); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'לא ניתן ליצור את התוכנית.'); }
      }}><Check size={16} /> יצירת חלופה ב־2D וב־3D</button>
    </div>
  </ShowroomDialog>;
}

function GridIcon() { return <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><path d="M8 8H40V40H8ZM8 24H28V8M28 24V40" fill="none" stroke="currentColor" strokeWidth="2" /></svg>; }
