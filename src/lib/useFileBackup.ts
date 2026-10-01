import { useEffect, useRef, useState } from 'react';

interface Writable { write: (data: string) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }
interface BackupHandle { name: string; createWritable: () => Promise<Writable> }
type FileWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<BackupHandle> };

/** User-granted disk access only. Serialize writes; debounced edits never race writes. */
export function useFileBackup(content: () => Promise<string>, revision: unknown) {
  const latest = useRef(content); latest.current = content;
  const latestRevision = useRef(revision); latestRevision.current = revision;
  const handle = useRef<BackupHandle | null>(null), chain = useRef(Promise.resolve()), alive = useRef(true);
  const [status, setStatus] = useState(''), [connected, setConnected] = useState(false), [dirty, setDirty] = useState(false);
  const supported = typeof window !== 'undefined' && !!(window as FileWindow).showSaveFilePicker;
  useEffect(() => { alive.current = true; return () => { alive.current = false; handle.current = null; }; }, []);
  const write = () => {
    const destination = handle.current; if (!destination) return;
    chain.current = chain.current.then(async () => {
      if (!alive.current || handle.current !== destination) return;
      const snapshot = latestRevision.current;
      setStatus('כותב גיבוי עם נכסים…');
      const data = await latest.current();
      if (!alive.current || handle.current !== destination) return;
      const stream = await destination.createWritable();
      try { await stream.write(data); await stream.close(); }
      catch (error) { await stream.abort().catch(() => {}); throw error; }
      if (alive.current && handle.current === destination) {
        const changed = snapshot !== latestRevision.current;
        setDirty(changed); setStatus(changed ? 'שינויים חדשים ממתינים לגיבוי…' : `גיבוי עודכן: ${destination.name}`);
      }
    }).catch(error => { if (alive.current) setStatus(`גיבוי הקובץ נכשל: ${error instanceof Error ? error.message : 'שגיאה'}. הורידו גיבוי ידני.`); });
  };
  useEffect(() => {
    if (!connected) return;
    setDirty(true); setStatus('שינויים ממתינים לגיבוי קובץ…');
    const timer = window.setTimeout(write, 1200); return () => window.clearTimeout(timer);
  }, [revision, connected]);
  useEffect(() => {
    if (!connected || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [connected, dirty]);
  const connect = async () => {
    try {
      const pick = (window as FileWindow).showSaveFilePicker;
      if (!pick) { setStatus('הדפדפן אינו תומך בגיבוי מתעדכן; השתמשו בשמירת קובץ.'); return; }
      const selected = await pick.call(window, { suggestedName: 'dori-project-with-assets.json', types: [{ description: 'Dori project backup', accept: { 'application/json': ['.json'] } }] });
      handle.current = selected; setConnected(true);
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('לא ניתן לפתוח קובץ גיבוי; השתמשו בשמירת קובץ.'); }
  };
  const disconnect = () => { handle.current = null; setConnected(false); setDirty(false); setStatus('גיבוי מתעדכן נותק. הקובץ הקיים לא נמחק.'); };
  return { connect, disconnect, connected, supported, status };
}