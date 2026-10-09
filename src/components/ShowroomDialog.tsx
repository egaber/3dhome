import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function ShowroomDialog({ title, children, onClose, wide = false, error }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; error?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog className={`showroom-dialog${wide ? ' is-wide' : ''}`} ref={ref} dir="rtl" aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><button type="button" className="showroom-icon" aria-label={`סגירת ${title}`} onClick={onClose}><X size={20} /></button></header>
    <div className="showroom-dialog-body">{error && <p className="plan-error" role="alert">{error}</p>}{children}</div>
  </dialog>;
}
