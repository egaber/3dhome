import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { Button } from './ui/button';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export function ModelChat({ messages, onMessagesChange, onCommand }: {
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  onCommand: (command: string) => string;
}) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const command = draft.trim();
    if (!command) return;
    const answer = onCommand(command);
    const additions: ChatMessage[] = [
      { id: crypto.randomUUID(), role: 'user', text: command },
      { id: crypto.randomUUID(), role: 'assistant', text: answer },
    ];
    onMessagesChange([...messages, ...additions].slice(-40));
    setDraft('');
  };

  if (!open) return <Button className="chat-launcher" onClick={() => setOpen(true)}>
    <MessageCircle size={18} /> הערות למודל
  </Button>;

  return <section className="model-chat" aria-label="צ׳אט לעדכון המודל">
    <header><div><MessageCircle size={17} /><strong>עדכון המודל בצ׳אט</strong></div>
      <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="סגירת הצ׳אט"><X size={16} /></Button>
    </header>
    <div className="chat-context">הפקודות מתבצעות מיד ונשמרות אוטומטית. פקודות לפתחים חלות על הפתח שנבחר בלשונית ״פתחים״ או בקליק כפול במודל.</div>
    <div className="chat-messages" aria-live="polite">
      {messages.length === 0 && <div className="chat-empty">
        נסו: ״גובה קומה ראשונה 3.4 ביחידה א״, ״שנה את הפתח הנבחר לויטרינה״,
        ״רוחב הפתח 2.8״, ״הוסף חלון ביחידה ב״ או ״גובה שכן מזרח 10״.
      </div>}
      {messages.map(message => <div key={message.id} className={`chat-message ${message.role}`}>{message.text}</div>)}
      <div ref={endRef} />
    </div>
    <form onSubmit={submit}>
      <input value={draft} onChange={event => setDraft(event.currentTarget.value)}
        placeholder="כתוב שינוי למודל…" aria-label="פקודה לעדכון המודל" />
      <Button size="icon" type="submit" aria-label="ביצוע הפקודה"><Send size={16} /></Button>
    </form>
  </section>;
}
