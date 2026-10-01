import { useEffect, useId, useRef } from 'react';
import { History, Redo2, Undo2, X } from 'lucide-react';
import { HISTORY_LIMIT, type HistoryEntry } from '../lib/actionHistory';
import { Button } from './ui/button';

export interface HistoryControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onShowHistory: () => void;
}

export function HistoryControls({ canUndo, canRedo, onUndo, onRedo, onShowHistory }: HistoryControlsProps) {
  return <div className="history-controls" role="group" aria-label="ביטול והיסטוריית פעולות">
    <Button size="sm" variant="secondary" disabled={!canUndo} onClick={onUndo} aria-label="ביטול פעולה" title="ביטול פעולה (Ctrl/Cmd+Z)" aria-keyshortcuts="Control+Z Meta+Z"><Undo2 size={16} aria-hidden="true" /><span>ביטול</span></Button>
    <Button size="sm" variant="secondary" disabled={!canRedo} onClick={onRedo} aria-label="ביצוע מחדש" title="ביצוע מחדש (Ctrl/Cmd+Shift+Z / Ctrl+Y)" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"><Redo2 size={16} aria-hidden="true" /><span>שוב</span></Button>
    <Button size="sm" variant="secondary" onClick={onShowHistory} aria-label="היסטוריית פעולות" aria-haspopup="dialog"><History size={16} aria-hidden="true" /><span>היסטוריה</span></Button>
  </div>;
}

export function ActionHistory({ entries, index, onJump, onClose, ...controls }: HistoryControlsProps & {
  entries: HistoryEntry[];
  index: number;
  onJump: (id: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  return <dialog ref={ref} className="action-history" dir="rtl" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      // Native modal inertness does not prevent Tab from moving to browser chrome.
      // Recompute after history navigation changes which controls are enabled.
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        .filter(button => button.tabIndex >= 0 && button.getClientRects().length > 0);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) { event.preventDefault(); buttons[0]?.focus(); }
    }}>
    <header><h2 id={titleId}><History size={20} aria-hidden="true" />היסטוריית פעולות</h2><Button autoFocus size="icon" variant="ghost" aria-label="סגירת היסטוריה" onClick={onClose}><X size={18} /></Button></header>
    <p id={descriptionId}>בחרו שלב כדי לשחזר את המודל עד אליו. שינוי חדש אחרי ביטול מחליף את הפעולות שבוטלו.</p>
    <HistoryControls {...controls} onShowHistory={controls.onShowHistory} />
    <p className="history-position" role="status" aria-live="polite">שלב {index} מתוך {entries.length - 1}</p>
    <ol className="history-list" aria-label="שלבי עריכה">
      {entries.map((entry, position) => <li key={entry.id} className={position > index ? 'history-future' : undefined}>
        <button type="button" aria-current={position === index ? 'step' : undefined}
          onClick={() => onJump(entry.id)} aria-label={`שחזור שלב ${position}: ${position === 0 ? (entry.id === 0 ? 'מצב התחלתי' : 'המצב המוקדם הזמין') : entry.label}`}>
          <bdi className="history-step">{position}</bdi><span>{position === 0 ? (entry.id === 0 ? 'מצב התחלתי' : 'המצב המוקדם הזמין') : entry.label}</span>
          <small>{position === index ? 'נוכחי' : position > index ? 'בוטל' : 'בוצע'}</small>
        </button>
      </li>)}
    </ol>
    {entries.length === 1 && <p className="small-note">אין פעולות עדיין. שינויי המודל יופיעו כאן.</p>}
    <footer>עד {HISTORY_LIMIT} פעולות בסשן הנוכחי. המודל נשמר אוטומטית; המחסנית מתאפסת ברענון. תנועת מצלמה, בחירות ושיחות אינן חלק מהמחסנית.</footer>
  </dialog>;
}