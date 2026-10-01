import { useId } from 'react';
import { Minus, Plus } from 'lucide-react';
import { ZOOM_STEP, zoomKeyDirection } from '../lib/viewNavigation';
import { Button } from './ui/button';

export function ZoomControls({ level, percent, onChange }: {
  level: number;
  percent: number;
  onChange: (level: number) => void;
}) {
  const id = useId();
  const change = (value: number) => onChange(Math.min(100, Math.max(0, value)));
  return <div className="zoom-controls" role="group" aria-label="בקרי זום" dir="ltr">
    <label htmlFor={id}>זום</label>
    <Button size="icon" variant="secondary" aria-label="התקרבות" title="התקרבות (+)"
      disabled={level >= 99.999} onClick={() => change(level + ZOOM_STEP)}><Plus size={20} /></Button>
    <input id={id} type="range" min={0} max={100} step={1} value={level}
      aria-label="זום" aria-orientation="vertical" aria-valuetext={`${percent}%`}
      onChange={event => change(Number(event.currentTarget.value))}
      onKeyDown={event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
        const direction = zoomKeyDirection(event.key, event.code);
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        change(level + direction * ZOOM_STEP);
      }} />
    <Button size="icon" variant="secondary" aria-label="התרחקות" title="התרחקות (−)"
      disabled={level <= .001} onClick={() => change(level - ZOOM_STEP)}><Minus size={20} /></Button>
    <span className="zoom-value" aria-hidden="true">{percent}%</span>
  </div>;
}