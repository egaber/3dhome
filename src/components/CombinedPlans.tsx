import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { Box, Download, Grid2X2, Layers, Printer, X, ZoomIn, ZoomOut } from 'lucide-react';
import { combinedFloorPlan, type CombinedPlan } from '../lib/combinedPlan';
import { boundsOf, pointsText } from '../lib/cadEditor';
import type { DuplexPreset } from '../lib/duplexPresentation';
import { floorElevation } from '../model/plans';
import { FLOOR_NAMES, UNIT_NAMES, type FloorId, type SimulationState, type UnitId } from '../model/types';
import { Button } from './ui/button';
import { FurniturePlan, PlanDimension, WallPlan } from './CadPlanObjects';
import { StairPlan } from './StairControls';
import './combinedPlans.css';

type FloorSelection = 'both' | 'ground' | 'first';
type PlanLayers = { furniture: boolean; labels: boolean; dimensions: boolean };

function PlanDrawing({ state, plan, bounds, layers, svgRef }: {
  state: SimulationState; plan: CombinedPlan; bounds: CombinedPlan['bounds']; layers: PlanLayers; svgRef: Ref<SVGSVGElement>;
}) {
  const hatchId = `combined-${useId().replace(/:/g, '')}`;
  const { x, y, width, height } = bounds;
  const envelope = boundsOf(plan.units.flatMap(unit => unit.footprint));
  return <svg ref={svgRef} className="combined-plan-drawing" xmlns="http://www.w3.org/2000/svg" role="img"
    aria-label={`תוכנית משולבת · ${FLOOR_NAMES[plan.floor]}`} viewBox={`${x - 2} ${y - 2.6} ${width + 4} ${height + 6}`}>
    <title>{FLOOR_NAMES[plan.floor]} · {plan.units.length === 1 ? UNIT_NAMES[plan.units[0].id] : 'שתי היחידות'}</title>
    <desc>שרטוט לפי המודל הקיים. המידות במטרים; סימוני החללים תואמים לטבלה. להמחשה בלבד, לא לביצוע.</desc>
    <rect className="plan-paper" x={x - 2} y={y - 2.6} width={width + 4} height={height + 6} />
    <defs><pattern id={hatchId} width=".12" height=".12" patternUnits="userSpaceOnUse"><rect className="plan-wall-fill" width=".12" height=".12" /></pattern></defs>
    <text className="plan-svg-title" x={x + width} y={y - 1.85} textAnchor="end">{FLOOR_NAMES[plan.floor]} · {plan.units.length === 1 ? plan.units[0].id === 'south' ? 'דרומית קדמית' : 'צפונית עורפית' : 'דו־משפחתי'}</text>
    <text className="plan-svg-subtitle" x={x + width} y={y - 1.24} textAnchor="end">{plan.floor === 'ground' && state.buildings.north.northGroundLayout === 'attached' && plan.units.some(unit => unit.id === 'north')
      ? 'קרקע צפונית לפי התמונה המצורפת · מטבח מערבי ואוכל עגול'
      : plan.floor === 'first' && state.buildings.north.firstFloorVariant === 'bedrooms' && plan.units.some(unit => unit.id === 'north')
      ? 'צפונית לפי התמונה המצורפת · 3 חדרים ו־3 רחצות'
      : state.buildings.south.southLayout === 'family' && plan.units.some(unit => unit.id === 'south')
      ? plan.floor === 'first' ? 'חלופה מוצעת · הורים, שני ילדים ושתי רחצות' : 'חלופה דרומית · מטבח ואי, מדרגות מערביות'
      : state.buildings.south.southLayout === 'west-stair' && plan.floor === 'ground' && plan.units.some(unit => unit.id === 'south') ? 'תמונה מצורפת · מדרגות מערביות ואוכל עגול'
      : plan.floor === 'ground' ? 'בסיס קרקע מעודכן · עריכות שמורות כלולות' : 'בסיס הקומה הקיים · שיוך וחיבור לאימות'}</text>
    {plan.units.map(unit => <g key={unit.id} data-plan-unit={unit.id} className={`plan-unit-${unit.id}`}>
      <polygon className="combined-footprint" points={pointsText(unit.footprint)} />
      {layers.furniture && unit.furniture.map(item => <FurniturePlan key={item.id} item={item} state={state} selection={null} />)}
      {unit.stair && <StairPlan geometry={unit.stair} state={state} />}
      {unit.walls.map(wall => <WallPlan key={wall.id} wall={wall} state={state} selection={null} hatchId={hatchId} handleSize={0} />)}
      {layers.labels && unit.rooms.map(({ room, center }, index) => <g key={room.id} className="plan-room-index" data-room-id={room.id} transform={`translate(${center.join(' ')})`}>
        <title>{UNIT_NAMES[unit.id]} · {room.name}</title><circle r=".39" /><text y=".02">{index + 1}</text>
        {plan.units.length === 1 && room.depth >= 1.9 && room.width >= 2 && <text className="plan-room-name" y=".75">{room.name.replace('סוויטת הורים · חדר שינה', 'חדר הורים').replace('שירותים ואמבטיה כללית', 'רחצה כללית').replace('רחצה פרטית הורים', 'רחצה הורים').replace('חדר ארונות הורים', 'ארונות')}</text>}
      </g>)}
    </g>)}
    {layers.dimensions && plan.units.length > 0 && <g className="plan-overall-dimensions">
      <PlanDimension a={[envelope.x, envelope.y]} b={[envelope.x + envelope.width, envelope.y]} offset={-.58} textSize={.4} units="m" overall />
      <PlanDimension a={[envelope.x + envelope.width, envelope.y]} b={[envelope.x + envelope.width, envelope.y + envelope.height]} offset={-1.1} textSize={.4} units="m" overall />
    </g>}
    <g className="plan-north" transform={`translate(${x - 1.15} ${y + .9})`}>
      <text y="-1">N</text><path transform={`rotate(${-state.northBearing})`} d="M0,.6 V-.6 M-.18,-.25 L0,-.6 L.18,-.25" />
    </g>
    <g className="plan-scale" transform={`translate(${x} ${y + height + 1.1})`}>
      {[0, 1, 2, 3, 4].map(index => <rect key={index} x={index} y="0" width="1" height=".15" className={index % 2 ? 'plan-scale-light' : 'plan-scale-dark'} />)}
      {[0, 1, 2, 3, 4, 5].map(index => <text key={index} x={index} y=".6">{index}</text>)}<text x="6.1" y=".6">מ׳</text>
    </g>
    <text className="plan-svg-note" x={x + width} y={y + height + 2.3} textAnchor="end">מידות מודל במטרים · סימוני החדרים לפי יחידה</text>
    <text className="plan-svg-note" x={x + width} y={y + height + 2.87} textAnchor="end">להמחשה בלבד · מידות, צפון וחיבור קומות טעונים אימות</text>
  </svg>;
}

function downloadDrawings(drawings: { drawing: SVGSVGElement; plan: CombinedPlan }[]) {
  if (!drawings.length) return;
  const namespace = 'http://www.w3.org/2000/svg', output = document.createElementNS(namespace, 'svg');
  const panelWidth = 800, panelHeight = 1160;
  const rowCount = Math.max(0, ...drawings.flatMap(({ plan }) => plan.units.map(unit => unit.rooms.length)));
  const totalHeight = panelHeight + 160 + rowCount * 28;
  const theme = getComputedStyle(document.documentElement);
  const textColor = theme.getPropertyValue('--cp-text').trim(), paperColor = theme.getPropertyValue('--cp-surface').trim();
  output.setAttribute('xmlns', namespace);
  output.setAttribute('viewBox', `0 0 ${panelWidth * drawings.length} ${totalHeight}`);
  output.setAttribute('width', String(panelWidth * drawings.length));
  output.setAttribute('height', String(totalHeight));
  const background = document.createElementNS(namespace, 'rect');
  background.setAttribute('width', '100%'); background.setAttribute('height', '100%'); background.setAttribute('fill', paperColor); output.appendChild(background);
  const properties = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'paint-order', 'vector-effect', 'direction', 'unicode-bidi', 'opacity'];
  drawings.forEach(({ drawing, plan }, index) => {
    const clone = drawing.cloneNode(true) as SVGSVGElement;
    const originals = [drawing, ...drawing.querySelectorAll<SVGElement>('*')], copies = [clone, ...clone.querySelectorAll<SVGElement>('*')];
    originals.forEach((original, elementIndex) => {
      const computed = getComputedStyle(original), copy = copies[elementIndex];
      for (const property of properties) {
        const localFill = property === 'fill' && original.getAttribute('fill')?.startsWith('url(#') ? original.getAttribute('fill') : null;
        copy.style.setProperty(property, localFill ?? computed.getPropertyValue(property));
      }
    });
    clone.setAttribute('x', String(index * panelWidth)); clone.setAttribute('y', '0');
    clone.setAttribute('width', String(panelWidth)); clone.setAttribute('height', String(panelHeight));
    output.appendChild(clone);
    const text = (value: string, horizontal: number, vertical: number, anchor = 'end', size = 16, color = textColor) => {
      const label = document.createElementNS(namespace, 'text');
      label.setAttribute('x', String(index * panelWidth + horizontal)); label.setAttribute('y', String(vertical));
      label.setAttribute('text-anchor', anchor); label.setAttribute('font-size', String(size));
      label.setAttribute('font-family', 'Segoe UI, Aptos, Calibri, sans-serif'); label.setAttribute('fill', color);
      label.textContent = value; output.appendChild(label);
    };
    plan.units.forEach((unit, unitIndex) => {
      const start = unitIndex === 0 ? 400 : 0;
      const color = theme.getPropertyValue(unit.id === 'north' ? '--cp-accent' : '--cp-link').trim();
      text(UNIT_NAMES[unit.id], start + 376, panelHeight + 26, 'end', 18, color);
      text('מידות אזורים במודל · רוחב × עומק במטרים', start + 376, panelHeight + 54, 'end', 14);
      unit.rooms.forEach(({ room, width, depth }, roomIndex) => {
        const row = panelHeight + 86 + roomIndex * 28;
        text(String(roomIndex + 1), start + 367, row, 'middle', 16, color);
        text(room.name, start + 338, row);
        text(`${width.toFixed(2)} × ${depth.toFixed(2)}`, start + 24, row, 'start', 15);
      });
      text(`מעטפת במודל: ${unit.envelopeArea.toFixed(1)} מ״ר`, start + 376, panelHeight + 116 + rowCount * 28);
    });
  });
  const blob = new Blob([new XMLSerializer().serializeToString(output)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'duplex-combined-plans.svg'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CombinedPlans({ state, onClose, onView, unitScope, onUnitScope, onSouthFamily, onSouthWest }: {
  state: SimulationState; onClose: () => void; onView: (preset: DuplexPreset) => void;
  unitScope: 'both' | UnitId; onUnitScope: (unit: 'both' | UnitId) => void; onSouthFamily: () => void; onSouthWest: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null), drawingRefs = useRef<Partial<Record<FloorId, SVGSVGElement | null>>>({});
  const [selection, setSelection] = useState<FloorSelection>('both'), [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState<PlanLayers>({ furniture: true, labels: true, dimensions: true });
  const plans = (['ground', 'first'] as const).map(floor => combinedFloorPlan(state, floor, unitScope));
  const visible = plans.filter(plan => selection === 'both' || selection === plan.floor);
  const occupied = plans.filter(plan => plan.units.length);
  const left = occupied.length ? Math.min(...occupied.map(plan => plan.bounds.x)) : 0, top = occupied.length ? Math.min(...occupied.map(plan => plan.bounds.y)) : 0;
  const bounds = { x: left, y: top, width: occupied.length ? Math.max(...occupied.map(plan => plan.bounds.x + plan.bounds.width)) - left : 1,
    height: occupied.length ? Math.max(...occupied.map(plan => plan.bounds.y + plan.bounds.height)) - top : 1 };
  useEffect(() => {
    const dialog = dialogRef.current!, previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialogRef} className="combined-plans" aria-labelledby="combined-plan-heading" dir="rtl"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'))
        .filter(element => element.getClientRects().length > 0);
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0]?.focus(); }
    }}>
    <header className="combined-plan-header">
      <div className="combined-plan-heading"><Grid2X2 size={22} /><div><h2 id="combined-plan-heading">{unitScope === 'south' ? 'יחידה דרומית · קרקע וקומה ראשונה' : unitScope === 'north' ? 'יחידה צפונית · קרקע וקומה ראשונה' : 'דו־משפחתי · שתי היחידות'}</h2><p>{state.buildings.south.southLayout === 'family' && unitScope !== 'north' ? 'חלופה מוצעת · סוויטת הורים + שני חדרי ילדים' : 'קרקע וקומה ראשונה · תוכנית משולבת'}</p></div></div>
      <div className="combined-plan-actions">
        <Button variant="primary" onClick={() => onView('exterior')}><Box size={17} /> הדמיה תלת־ממדית</Button>
        <Button size="icon" variant="secondary" title="הורדת תוכנית SVG" aria-label="הורדת תוכנית SVG" onClick={() => downloadDrawings(visible.flatMap(plan => drawingRefs.current[plan.floor] ? [{ drawing: drawingRefs.current[plan.floor]!, plan }] : []))}><Download size={18} /></Button>
        <Button size="icon" variant="secondary" title="הדפסה או שמירה כ-PDF" aria-label="הדפסה או שמירה כ-PDF" onClick={() => window.print()}><Printer size={18} /></Button>
        <Button size="icon" variant="ghost" title="סגירת התוכנית המשולבת" aria-label="סגירת התוכנית המשולבת" onClick={onClose}><X size={20} /></Button>
      </div>
    </header>
    <div className="combined-plan-tools">
      <label className="combined-unit-select">יחידות<select aria-label="יחידות בתוכנית" value={unitScope} onChange={event => { onUnitScope(event.target.value as 'both' | UnitId); setZoom(1); }}>
        <option value="both">שתי היחידות</option><option value="south">הדרומית בלבד</option><option value="north">הצפונית בלבד</option>
      </select></label>
      <Button variant="secondary" onClick={onSouthFamily}><Layers size={16} /> חלופה דרומית</Button>
      <Button variant={state.buildings.south.southLayout === 'west-stair' ? 'primary' : 'secondary'} aria-pressed={state.buildings.south.southLayout === 'west-stair'}
        onClick={() => { onSouthWest(); setSelection('ground'); setZoom(1); }}><Layers size={16} /> תוכנית מצורפת</Button>
      <div className="combined-plan-tabs" role="group" aria-label="קומות בתוכנית המשולבת">
        {([['both', 'שתי הקומות'], ['ground', 'קומת קרקע'], ['first', 'קומה ראשונה']] as const).map(([id, label]) => <Button key={id} variant={selection === id ? 'primary' : 'ghost'} aria-pressed={selection === id} onClick={() => { setSelection(id); setZoom(1); }}>{label}</Button>)}
      </div>
      <div className="combined-plan-layers">
        {([['furniture', 'ריהוט'], ['labels', 'סימוני חללים'], ['dimensions', 'מידות']] as const).map(([id, label]) => <label key={id}><input type="checkbox" checked={layers[id]} onChange={event => setLayers(current => ({ ...current, [id]: event.target.checked }))} />{label}</label>)}
      </div>
      <div className="combined-plan-zoom">
        <Button size="icon" variant="ghost" title="הקטנת התוכנית" aria-label="הקטנת התוכנית" disabled={zoom <= 1} onClick={() => setZoom(current => Math.max(1, current - .25))}><ZoomOut size={18} /></Button>
        <output aria-label="קנה מידת תצוגה"><bdi>{Math.round(zoom * 100)}%</bdi></output>
        <Button size="icon" variant="ghost" title="הגדלת התוכנית" aria-label="הגדלת התוכנית" disabled={zoom >= 2.5} onClick={() => setZoom(current => Math.min(2.5, current + .25))}><ZoomIn size={18} /></Button>
      </div>
    </div>
    <div className="combined-plan-scroll">
      <div className={`combined-plan-grid ${visible.length === 1 ? 'single-floor' : ''}`}>
        {visible.map(plan => <section key={plan.floor} className="combined-floor" aria-label={`גיליון ${FLOOR_NAMES[plan.floor]}`}>
          <div className="combined-floor-title"><h3><span>{plan.floor === 'ground' ? '01' : '02'}</span> {FLOOR_NAMES[plan.floor]}</h3><Button variant="secondary" onClick={() => onView(plan.floor as 'ground' | 'first')}><Layers size={16} /> תלת־ממד לקומה</Button></div>
          <div className="combined-unit-legend">{plan.units.map(unit => <span key={unit.id} className={`plan-unit-${unit.id}`}><i />{UNIT_NAMES[unit.id]}<bdi>{floorElevation(plan.floor, state.buildings[unit.id]).toFixed(2)} מ׳</bdi></span>)}</div>
          {plan.units.length ? <>
            <div className="combined-drawing-scroll" tabIndex={zoom > 1 ? 0 : undefined} aria-label="גיליון שרטוט"><div style={{ width: `${zoom * 100}%` }}><PlanDrawing state={state} plan={plan} bounds={bounds} layers={layers} svgRef={element => { drawingRefs.current[plan.floor] = element; }} /></div></div>
            <div className="combined-room-schedules">{plan.units.map(unit => <section key={unit.id} className={`plan-unit-${unit.id}`}>
              <h4><i />{UNIT_NAMES[unit.id]}</h4>
              <table><caption>מידות אזורים במודל · מטרים</caption><thead><tr><th scope="col">סימון</th><th scope="col">חלל</th><th scope="col">רוחב × עומק</th></tr></thead>
                <tbody>{unit.rooms.map(({ room, width, depth }, index) => <tr key={room.id}><td>{index + 1}</td><th scope="row">{room.name}</th><td><bdi>{width.toFixed(2)} × {depth.toFixed(2)}</bdi></td></tr>)}</tbody>
              </table>
              <p>מעטפת במודל: <bdi>{unit.envelopeArea.toFixed(1)} מ״ר</bdi></p>
              {unit.id === 'south' && plan.floor === 'first' && state.buildings.south.southLayout === 'family' && <p className="combined-suite-size">אזור מקור: <bdi>5.90 × 3.65 מ׳</bdi> · חלקו הוקצה למבואת מדרגות; הסוויטה מדורגת</p>}
            </section>)}</div>
          </> : <p className="combined-empty">אין יחידות פעילות בקומה זו.</p>}
        </section>)}
      </div>
      <footer className="combined-plan-notes">
        <strong>בסיס התכנון והנחות</strong>
        {state.buildings.north.northGroundLayout === 'attached' && unitScope !== 'south' && <p>קרקע צפונית לפי התמונה המצורפת: מטבח מערבי ואי במידות 1.10 × 2.65 מ׳, שולחן עגול בקוטר 1.30 מ׳ וסלון מזרחי. במתווה המדרגות המוצע שני גרמים מקבילים ופודסט דרומי. המיקומים והמידות שלא סומנו בתמונה משוערים; תמונת ה־PDF המקורית אינה התוכנית החדשה.</p>}
        {state.buildings.north.firstFloorVariant === 'bedrooms' && unitScope !== 'south' && <p>קומה ראשונה צפונית לפי התמונה המצורפת: שלושה חדרי שינה, שלוש רחצות, כביסה ומסדרון לצד המדרגות. האגף הדרום־מזרחי משויך לצפונית בחלופה זו בלבד. המידות והיישור במודל משוערים; תמונת ה־PDF המקורית אינה התוכנית החדשה.</p>}
        {state.buildings.south.southLayout === 'family' ? <>
          <p>הדרומית: סוויטת הורים מדורגת עם ארונות ורחצה פרטית; שני חדרי ילדים עם מיטה, שולחן עבודה ואחסון; אמבטיה כללית. בקרקע מטבח מלא ואי, שישה מקומות אוכל, סלון, כביסה ושירותי אורחים. המעטפת החיצונית נשמרה; הצפונית מוצגת לפי החלופה שנבחרה עבורה.</p>
          <p>בגרם U המוצע: 20 רומים, שלחים כ־27 ס״מ, מהלך ברוחב 100 ס״מ ופודסט 110 ס״מ. בגובה קומה 3.40 מ׳ הרום הוא 17 ס״מ. מעברים עיקריים 90–110 ס״מ ומרווח עבודה מול האי כ־121 ס״מ במידות הבסיס. חלק מאזור המקור 5.90 × 3.65 מ׳ הוקצה לרחבת מדרגות.</p>
          <p>אלו מידות תכנון, לא אישור תקן. יש לאמת מדידה, מרווח ראש, מעקות, נגישות, אוורור, תשתיות, מפתחים וחיבור למרתף. שיוך הממ״ד וחדר הרחצה הסמוכים לקרקע נשאר לפי המודל הקודם.</p>
        </> : state.buildings.south.southLayout === 'west-stair' ? <>
          <p>קרקע דרומית לפי התמונה המצורפת: גרם ישר לאורך הקיר המערבי מול הכניסה, מטבח רחב עם אי ושולחן אוכל עגול בקוטר 1.30 מ׳. מעטפת הקרקע ושירותי האורחים נשמרו; הצפונית מוצגת לפי החלופה שנבחרה עבורה.</p>
          <p>מיקום הריהוט ומעטפת המטבח הם שחזור סכמטי מהתמונה. המדרגות משתמשות בגבהי המודל וב־18 רומים; חיבורן לקומה הראשונה ולמרתף, מרווח הראש והתקן לא אומתו מקצועית.</p>
        </> : <p>קומת הקרקע לפי הבסיס המעודכן שבפרויקט, עם שירותי אורחים ליד מבואת יחידה ב׳. יתר הקומות לפי החלופות שנבחרו במודל; זו אינה מדידה מוסמכת של התמונות המצורפות.</p>}
        <p>המעטפת כוללת קירות ושטחים פתוחים במודל; אינה שטח נטו או חישוב זכויות. מידות החללים הן מידות אזורי המודל. גבהים, מדרגות, גגות, ריהוט, פיתוח וצפון משוערים. נדרש אימות אדריכלי ומדידה לפני ביצוע.</p>
      </footer>
    </div>
  </dialog>;
}