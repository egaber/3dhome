import { useMemo, useState } from 'react';
import { Compass, Map, Minus, Plus } from 'lucide-react';
import { getWallApertures } from '../model/cad';
import { SITE, planPoint, resolvedFootprint, resolvedRooms, resolvedWalls } from '../model/plans';
import { LEVEL_NAMES, type SimulationState, type Vec2 } from '../model/types';
import type { VisitorPosition } from '../lib/showroom';
import { boundsOf, pointsText } from '../lib/cadEditor';

export function WalkMinimap({ state, visitor }: { state: SimulationState; visitor: VisitorPosition | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const unit = visitor?.unit ?? 'north', floor = visitor?.floor ?? 'ground';
  const shownFloor = floor === 'roof' ? 'first' : floor;
  const outside = visitor?.outside ?? false;
  const geometry = useMemo(() => {
    const walls = resolvedWalls(state).filter(wall => (outside || wall.unit === unit) && wall.floor === shownFloor);
    const outline = resolvedFootprint(shownFloor, unit, state).map(point => planPoint(point, unit, state));
    const garden: Vec2[] = outside ? [[SITE.left, SITE.back], [SITE.right, SITE.back], [SITE.right, SITE.front], [SITE.left, SITE.front]] : [];
    const bounds = boundsOf([...garden, ...outline, ...walls.flatMap(wall => [planPoint(wall.a, wall.unit, state), planPoint(wall.b, wall.unit, state)])], .6);
    return { walls, outline, bounds, rooms: resolvedRooms(state).filter(room => room.unit === unit && room.floor === shownFloor) };
  }, [state, unit, shownFloor, outside]);
  const { bounds } = geometry;
  const marker = Math.max(bounds.width, bounds.height) * .028;
  return <aside className={`walk-minimap${collapsed ? ' is-collapsed' : ''}`} aria-label="מפת מיקום וכיוון מבט">
    <header><span><Map size={15} /> {outside ? 'גינה וחוץ' : LEVEL_NAMES[floor]}</span><button type="button" aria-label={collapsed ? 'הרחבת מפת מיקום' : 'צמצום מפת מיקום'}
      aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? <Plus size={16} /> : <Minus size={16} />}</button></header>
    {!collapsed && <>
      <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="img" aria-label="תוכנית הקומה עם המיקום וכיוון המבט" data-testid="walk-minimap">
        {outside && <rect className="minimap-garden" x={SITE.left} y={SITE.back} width={SITE.right - SITE.left} height={SITE.front - SITE.back} />}
        {(outside ? (['north', 'south'] as const).filter(id => state.buildings[id].enabled).map(id => resolvedFootprint('ground', id, state).map(point => planPoint(point, id, state))) : [geometry.outline])
          .map((outline, index) => <polygon key={index} className="minimap-floor" points={pointsText(outline)} />)}
        {floor !== 'roof' && geometry.walls.map(wall => {
          const a = planPoint(wall.a, wall.unit, state), b = planPoint(wall.b, wall.unit, state);
          const point = (ratio: number): Vec2 => [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
          const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
          return <g key={wall.id}><line className="minimap-wall" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
            {getWallApertures(wall, state).map(opening => {
              const from = point((opening.center - opening.width / 2) / length), to = point((opening.center + opening.width / 2) / length);
              return <line className="minimap-opening" key={opening.id} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />;
            })}</g>;
        })}
        {visitor && <g transform={`translate(${visitor.point.join(' ')}) rotate(${visitor.heading})`} data-testid="visitor-marker"
          data-x={visitor.point[0].toFixed(3)} data-z={visitor.point[1].toFixed(3)} data-heading={visitor.heading.toFixed(2)}>
          <path className="minimap-cone" d={`M 0 0 L ${-marker * 2.7} ${-marker * 4.8} A ${marker * 5.5} ${marker * 5.5} 0 0 1 ${marker * 2.7} ${-marker * 4.8} Z`} />
          <circle className="minimap-position" r={marker} />
          <path className="minimap-arrow" d={`M ${-marker / 3} 0 L 0 ${-marker / 2} L ${marker / 3} 0`} />
        </g>}
      </svg>
      <footer><span>אתם כאן · {unit === 'north' ? 'הבית הצפוני' : 'הבית הדרומי'}</span><Compass size={14} style={{ transform: `rotate(${-state.northBearing}deg)` }} aria-label="צפון" /></footer>
    </>}
  </aside>;
}
