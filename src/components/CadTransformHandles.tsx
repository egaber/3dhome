import { useId, type PointerEvent } from 'react';
import { rotationHandlePoint, selectionFrame } from '../lib/cadTransformHandles';
import type { CadSelection, PlanView } from '../lib/cadEditor';
import type { SimulationState } from '../model/types';

export function CadTransformHandles({ state, selection, view, width, height, rotating, onBeginRotate, onBeginMove, onRotate }: {
  state: SimulationState; selection: CadSelection; view: PlanView; width: number; height: number; rotating: boolean;
  onBeginRotate: (event: PointerEvent<SVGElement>, selection: CadSelection) => void;
  onBeginMove: (event: PointerEvent<SVGElement>, selection: CadSelection) => void;
  onRotate: (angle: number) => void;
}) {
  const id = useId();
  const frame = selectionFrame(state, selection);
  if (!frame) return null;
  const handle = rotationHandlePoint(frame, view, [width, height]);
  const xUnit = view.width / Math.max(1, width), yUnit = view.height / Math.max(1, height);
  return <g className={`cad-transform-handles ${rotating ? 'is-rotating' : ''}`} data-selection-id={selection.id}>
    {selection.type === 'stair' && <polygon className="cad-stair-move-hit" points={frame.outline.map(p => p.join(',')).join(' ')}
      onPointerDown={event => onBeginMove(event, selection)} />}
    <polygon className="cad-selection-frame" points={frame.outline.map(p => p.join(',')).join(' ')} />
    <path className="cad-rotation-stem" d={`M${frame.anchor.join(',')} L${handle.join(',')}`} />
    <g className="cad-pivot" transform={`translate(${frame.pivot.join(' ')}) scale(${xUnit} ${yUnit})`} aria-hidden="true">
      <path d="M-5 0 H5 M0 -5 V5" />
    </g>
    <g className="cad-rotate-handle" role="slider" tabIndex={0} aria-label="ידית סיבוב" aria-valuemin={-180} aria-valuemax={180}
      aria-valuenow={Number(frame.angle.toFixed(1))} aria-valuetext={`${frame.angle.toFixed(1)}°`} aria-describedby={id}
      transform={`translate(${handle.join(' ')}) scale(${xUnit} ${yUnit})`}
      onPointerDown={event => onBeginRotate(event, selection)}
      onKeyDown={event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
        const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 0;
        if (!direction && event.key !== 'Home') return;
        event.preventDefault(); event.stopPropagation();
        onRotate(event.key === 'Home' ? 0 : frame.angle + direction * (event.shiftKey ? 15 : 1));
      }}>
      <title id={id}>גררו לסיבוב · Shift להצמדה ל־15° · חצים לסיבוב מדויק · Escape לביטול</title>
      <circle className="cad-rotate-hit" r={22} />
      <circle className="cad-rotate-disc" r={14} />
      <path className="cad-rotate-icon" d="M6 -4 A7 7 0 1 0 7 3 M6 -9 V-3 H0" />
    </g>
    {rotating && <g className="cad-angle-badge" transform={`translate(${handle.join(' ')}) scale(${xUnit} ${yUnit})`} aria-hidden="true">
      <rect x={27} y={-13} width={62} height={26} rx={6} /><text x={58} y={0}>{frame.angle.toFixed(1)}°</text>
    </g>}
  </g>;
}