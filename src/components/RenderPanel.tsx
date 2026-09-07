import { useState } from 'react';
import { Download, Image, LoaderCircle, Sparkles, X } from 'lucide-react';
import { Button } from './ui/button';

const ENDPOINT_KEY = 'dori-ai-render-endpoint';

export function RenderPanel({ canvas, onClose }: { canvas: HTMLCanvasElement | null; onClose: () => void }) {
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem(ENDPOINT_KEY) ?? '');
  const [prompt, setPrompt] = useState('Photorealistic architectural visualization, preserve the exact camera, geometry, windows, shadows and site layout. Natural premium materials, realistic Israeli daylight, landscaping and physically plausible reflections.');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const source = () => canvas?.toDataURL('image/jpeg', .94) ?? null;
  const saveSource = () => {
    const image = source(); if (!image) return;
    const link = document.createElement('a'); link.href = image; link.download = 'dori-current-view.jpg'; link.click();
  };
  const generate = async () => {
    const image = source();
    if (!image) { setMessage('התצוגה עדיין לא מוכנה.'); return; }
    let endpointUrl: URL;
    try {
      endpointUrl = new URL(endpoint);
      if (endpointUrl.protocol !== 'https:') throw new Error('HTTPS required');
    } catch { setMessage('יש להגדיר כתובת HTTPS תקינה של שרת מאובטח.'); return; }
    try {
      setBusy(true); setMessage('שולח את המבט הנוכחי ליצירת הדמיה…');
      localStorage.setItem(ENDPOINT_KEY, endpoint);
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Data minimization: do not send coordinates, plans, room names or the
        // editable project. The rendered camera image is sufficient input.
        body: JSON.stringify({ model: 'gpt-image-v2', prompt, sourceImage: image }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { imageUrl?: string; imageBase64?: string };
      const output = data.imageUrl ?? (data.imageBase64 ? `data:image/png;base64,${data.imageBase64}` : null);
      if (!output) throw new Error('No image returned');
      setResult(output); setMessage('ההדמיה הושלמה.');
    } catch (error) { setMessage(`יצירת ההדמיה נכשלה: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`); }
    finally { setBusy(false); }
  };

  return <div className="render-backdrop"><section className="render-panel" role="dialog" aria-modal="true" aria-label="הדמיה ריאליסטית">
    <header><div><Sparkles size={20} /><div><strong>GPT Image v2 · הדמיה סופר־ריאליסטית</strong><small>מבוססת על זווית המצלמה הנוכחית</small></div></div><Button size="icon" variant="ghost" onClick={onClose}><X size={18} /></Button></header>
    <label>כתובת שרת הדמיה מאובטח<input dir="ltr" type="url" value={endpoint} onChange={event => setEndpoint(event.currentTarget.value)} placeholder="https://your-secure-render-endpoint.example/render" /></label>
    <label>הנחיית ההדמיה<textarea dir="ltr" value={prompt} onChange={event => setPrompt(event.currentTarget.value)} rows={5} /></label>
    <p className="info-note">GitHub Pages הוא אתר סטטי. כדי לא לחשוף מפתח OpenAI, השרת שבכתובת זו צריך להחזיק את הסוד ולקרוא ל־GPT Image v2. הוא מקבל רק `sourceImage`, `prompt` ו־`model`—ללא התוכנית, הקואורדינטות או פרטי החדרים—ומחזיר `imageUrl` או `imageBase64`.</p>
    <div className="editor-actions"><Button variant="secondary" onClick={saveSource}><Download size={16} />שמירת תמונת המקור</Button><Button disabled={busy} onClick={generate}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Image size={16} />}יצירת הדמיה</Button></div>
    {message && <p className="small-note" role="status">{message}</p>}
    {result && <a href={result} target="_blank" rel="noreferrer"><img className="render-result" src={result} alt="הדמיה ריאליסטית שנוצרה" /></a>}
  </section></div>;
}
