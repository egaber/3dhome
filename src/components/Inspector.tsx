import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowUpRight,
  Building2,
  ChartColumn,
  Compass,
  DoorOpen,
  Eye,
  FileText,
  Layers,
  LoaderCircle,
  MapPin,
  Move,
  Moon,
  Plus,
  RotateCcw,
  Ruler,
  Sun,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import {
  ROOMS,
  WALLS,
  buildingArea,
  floorAreaSchedule,
  resolvedOpenings,
  wallHeight,
  wallScale,
} from '../model/plans';
import { FLOOR_NAMES, UNIT_NAMES } from '../model/types';
import type {
  BuildingSettings,
  DailyExposure,
  FloorId,
  NeighborSettings,
  OpeningKind,
  OpeningSpec,
  PlanWall,
  RoomExposure,
  SimulationState,
  UnitId,
} from '../model/types';
import { calculateSolar, resolveLocalDateTime, TIME_ZONE } from '../lib/solar';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

export interface InspectorProps {
  state: SimulationState;
  onChange: (next: SimulationState) => void;
  selectedUnit: UnitId;
  onSelectUnit: (id: UnitId) => void;
  selectedOpening: string | null;
  onSelectOpening: (id: string | null) => void;
  selectedRoom: string;
  onSelectRoom: (id: string) => void;
  onEnterRoom: (id: string) => void;
  onAnalyze: () => void;
  analyzing: boolean;
  daily: DailyExposure | null;
  exposure: RoomExposure | null;
  onShowSources: () => void;
  onReferenceUpload: (file: File) => void;
}

const UNITS: readonly UnitId[] = ['north', 'south'];
const FLOORS: readonly FloorId[] = ['basement', 'ground', 'first'];
const FLOOR_OPTIONS = FLOORS.map(value => ({ value, label: FLOOR_NAMES[value] }));
const KIND_NAMES: Record<OpeningKind, string> = {
  window: 'חלון', glazing: 'ויטרינה', door: 'דלת', void: 'פתח חופשי',
};
const KIND_OPTIONS = (['window', 'glazing', 'door', 'void'] as const)
  .map(value => ({ value, label: KIND_NAMES[value] }));
const SORTED_ROOMS = [...ROOMS].sort((a, b) => (
  UNITS.indexOf(a.unit) - UNITS.indexOf(b.unit)
  || FLOORS.indexOf(a.floor) - FLOORS.indexOf(b.floor)
  || a.name.localeCompare(b.name, 'he')
));
const TABS = [
  { id: 'sun', label: 'שמש', icon: Sun },
  { id: 'model', label: 'מבנה', icon: Building2 },
  { id: 'openings', label: 'פתחים', icon: DoorOpen },
  { id: 'site', label: 'מגרש', icon: MapPin },
] as const;
type TabId = typeof TABS[number]['id'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function numberLabel(value: number, digits = 2): string {
  return Number.isFinite(value)
    ? value.toLocaleString('he-IL', { maximumFractionDigits: digits, numberingSystem: 'latn' })
    : '—';
}

function timeLabel(minutes: number): string {
  const whole = clamp(Math.round(minutes), 0, 1440);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function actualWallLength(wall: PlanWall, state: SimulationState): number {
  return Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) * wallScale(wall, state);
}

export interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  step?: number;
  unit?: string;
  context?: string;
  description?: string;
  disabled?: boolean;
}

/** Keep an editable decimal draft, but never emit empty, nonfinite or unbounded values. */
export function NumberField({
  label, value, min, max, onChange, step = 0.01, unit,
  context, description, disabled = false,
}: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<{ text: string; committed: number } | null>(null);
  const upper = Number.isFinite(max) ? max : 0;
  const lower = Number.isFinite(min) ? Math.min(min, upper) : Math.min(0, upper);
  const safeValue = clamp(value, lower, upper);
  const name = `${context ? `${context} · ` : ''}${label}${unit ? ` (${unit})` : ''}`;
  const descriptionId = description ? `${id}-note` : undefined;
  // An external update wins over a draft. No effect or render-time state mutation
  // is needed, and typing "-", an empty string, or a decimal does not corrupt state.
  const text = draft && Object.is(draft.committed, value)
    ? draft.text
    : String(Number.isFinite(value) ? value : safeValue);
  const emit = (next: number) => {
    if (!Object.is(next, value)) onChange(next);
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-number`}>
        <span>{label}</span>{unit && <span className="small-note">{unit}</span>}
      </label>
      <div className="range-pair">
        <input
          id={`${id}-range`}
          type="range"
          dir="ltr"
          min={lower}
          max={upper}
          step={Number.isFinite(step) && step > 0 ? step : 0.01}
          value={safeValue}
          disabled={disabled}
          aria-label={`${name} — מחוון`}
          aria-describedby={descriptionId}
          onChange={event => {
            const next = event.currentTarget.valueAsNumber;
            if (!Number.isFinite(next)) return;
            setDraft(null);
            emit(clamp(next, lower, upper));
          }}
        />
        <input
          id={`${id}-number`}
          type="number"
          dir="ltr"
          inputMode="decimal"
          min={lower}
          max={upper}
          step="any"
          value={text}
          disabled={disabled}
          aria-label={`${name} — ערך מספרי`}
          aria-describedby={descriptionId}
          onChange={event => {
            const raw = event.currentTarget.value;
            const parsed = event.currentTarget.valueAsNumber;
            const next = raw !== '' && Number.isFinite(parsed)
              ? clamp(parsed, lower, upper) : value;
            setDraft({ text: raw, committed: next });
            if (raw !== '' && Number.isFinite(parsed)) emit(next);
          }}
          onBlur={event => {
            const parsed = event.currentTarget.valueAsNumber;
            setDraft(null);
            emit(clamp(Number.isFinite(parsed) ? parsed : value, lower, upper));
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      </div>
      {description && <p id={descriptionId} className="small-note">{description}</p>}
    </div>
  );
}

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  context?: string;
  description?: string;
  disabled?: boolean;
  icon?: LucideIcon;
}

export function Toggle({ label, checked, onChange, context, description, disabled, icon: Icon }: ToggleProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="option-row" htmlFor={id}>
        <span>{Icon && <Icon size={16} aria-hidden="true" />} {label}</span>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={context ? `${context} · ${label}` : label}
          aria-describedby={description ? `${id}-note` : undefined}
          onChange={event => onChange(event.currentTarget.checked)}
        />
      </label>
      {description && <p id={`${id}-note`} className="small-note">{description}</p>}
    </div>
  );
}

interface SelectOption<T extends string> { value: T; label: string; }

function SelectField<T extends string>({
  label, value, options, onChange, disabled = false, context,
}: {
  label: string;
  value: T | '';
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  context?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled || options.length === 0}
        aria-label={context ? `${context} · ${label}` : label}
        onChange={event => {
          const option = options.find(item => item.value === event.currentTarget.value);
          if (option) onChange(option.value);
        }}
      >
        {!options.some(option => option.value === value) && <option value={value}>אין אפשרות זמינה</option>}
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function SectionHeading({
  id, icon: Icon, title, source,
}: { id?: string; icon: LucideIcon; title: string; source?: string }) {
  return (
    <div className="section-heading">
      <Icon size={18} aria-hidden="true" />
      <h3 id={id}>{title}</h3>
      {source && <span className="source-tag">{source}</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="stat-pair"><span>{label}</span><strong><bdi>{value}</bdi></strong></div>;
}

function UnitPicker({ selectedUnit, onSelectUnit }: Pick<InspectorProps, 'selectedUnit' | 'onSelectUnit'>) {
  return (
    <div className="segmented" role="group" aria-label="בחירת יחידת דיור לעריכה">
      {UNITS.map(unit => (
        <Button
          key={unit}
          variant={selectedUnit === unit ? 'primary' : 'ghost'}
          size="sm"
          aria-pressed={selectedUnit === unit}
          onClick={() => onSelectUnit(unit)}
        >{UNIT_NAMES[unit]}</Button>
      ))}
    </div>
  );
}

function DailyChart({
  daily, minutes, roomName, busy,
}: { daily: DailyExposure | null; minutes: number; roomName: string; busy: boolean }) {
  const id = useId();
  const step = daily && Number.isFinite(daily.stepMinutes) && daily.stepMinutes > 0
    ? Math.min(1440, daily.stepMinutes) : 10;
  const samples = (daily?.samples ?? [])
    .filter(sample => Number.isFinite(sample.minutes) && sample.minutes >= 0 && sample.minutes < 1440
      && Number.isFinite(sample.fraction))
    .slice().sort((a, b) => a.minutes - b.minutes);
  const hasSun = samples.some(sample => sample.fraction > 0);
  const emptyMessage = busy ? 'הניתוח היומי מתבצע…'
    : !daily ? 'טרם בוצע ניתוח יומי לחדר זה'
      : samples.length === 0 ? 'לא התקבלו דגימות ליום זה'
        : !hasSun ? 'אין שמש ישירה בדגימות היום' : '';
  const left = 40;
  const top = 20;
  const width = 304;
  const height = 96;
  const xAt = (minute: number) => left + clamp(minute, 0, 1440) / 1440 * width;

  return (
    <div className="field" aria-busy={busy}>
      <svg
        viewBox="0 0 360 156"
        role="img"
        direction="ltr"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      >
        <title id={`${id}-title`}>שמש ישירה לאורך היום — {roomName}</title>
        <desc id={`${id}-description`}>
          ציר השעות הוא 00:00 עד 24:00 בשעון ירושלים. גובה כל עמודה הוא אחוז נקודות
          הרצפה עם שמש ישירה, מתוך תשע נקודות, בדגימה כל {numberLabel(step)} דקות.
          אפס עשוי לציין לילה או חסימה. זה אינו מדד לוקס. {emptyMessage}
        </desc>
        <rect x={left} y={top} width={width} height={height} rx={4} fill="var(--cp-surface-soft)" />
        {[0, 0.5, 1].map(fraction => (
          <g key={fraction} aria-hidden="true">
            <line x1={left} x2={left + width} y1={top + height * (1 - fraction)}
              y2={top + height * (1 - fraction)} stroke="var(--cp-border)" />
            <text x={left - 6} y={top + height * (1 - fraction) + 3} textAnchor="end"
              fontSize={10} fill="var(--cp-text-muted)">{fraction * 100}%</text>
          </g>
        ))}
        {!busy && samples.map((sample, index) => {
          // The model integrates midpoint samples: each bar straddles its timestamp.
          const start = clamp(sample.minutes - step / 2, 0, 1440);
          const end = clamp(sample.minutes + step / 2, 0, 1440);
          const fraction = clamp(sample.fraction, 0, 1);
          const barHeight = fraction * height;
          return (
            <rect key={`${sample.minutes}-${index}`} x={xAt(start)} y={top + height - barHeight}
              width={Math.max(0, xAt(end) - xAt(start) - 0.35)} height={barHeight}
              fill="var(--cp-accent)">
              <title>{timeLabel(start)}–{timeLabel(end)}: {numberLabel(fraction * 100, 0)}% מנקודות הרצפה</title>
            </rect>
          );
        })}
        <line x1={xAt(minutes)} x2={xAt(minutes)} y1={top} y2={top + height}
          stroke="var(--cp-text-soft)" strokeDasharray="3 3" aria-hidden="true" />
        {[0, 6, 12, 18, 24].map(hour => (
          <text key={hour} x={xAt(hour * 60)} y={137} textAnchor="middle" fontSize={10}
            fill="var(--cp-text-muted)" aria-hidden="true">{String(hour).padStart(2, '0')}:00</text>
        ))}
        {emptyMessage && <text x={left + width / 2} y={top + height / 2} textAnchor="middle"
          direction="rtl" fontSize={12} fill="var(--cp-text-muted)">{emptyMessage}</text>}
      </svg>
      <p className="small-note">
        0% = לילה או חסימה. הקו המקווקו מסמן את השעה שנבחרה. הציר מציג שעות שעון
        מקומיות, גם ביום מעבר בין שעון חורף לקיץ.
      </p>
    </div>
  );
}

type SunPanelProps = Pick<InspectorProps,
  'state' | 'onChange' | 'selectedRoom' | 'onSelectRoom' | 'onEnterRoom'
  | 'onAnalyze' | 'analyzing' | 'daily' | 'exposure'>;

function SunPanel({
  state, onChange, selectedRoom, onSelectRoom, onEnterRoom, onAnalyze, analyzing, daily, exposure,
}: SunPanelProps) {
  const id = useId();
  const [timeError, setTimeError] = useState<string | null>(null);
  const { solar, solarError } = useMemo(() => {
    try {
      return { solar: calculateSolar(state.date, state.minutes, state.location), solarError: null };
    } catch {
      return { solar: null, solarError: 'לא ניתן לחשב שמש לתאריך, לשעה או למיקום שנבחרו. יש לבדוק את הערכים.' };
    }
  }, [state.date, state.minutes, state.location]);
  useEffect(() => setTimeError(null), [state.date, state.minutes]);

  const changeTime = (date: string, minutes: number) => {
    try {
      // Validate the exact civil date/time; do not silently shift a DST gap.
      resolveLocalDateTime(date, minutes);
      setTimeError(null);
      onChange({ ...state, date, minutes });
    } catch {
      setTimeError('התאריך או השעה אינם תקינים, או שהשעה אינה קיימת במעבר לשעון קיץ. בחרו זמן אחר; הערך הקודם נשמר.');
    }
  };
  const room = ROOMS.find(item => item.id === selectedRoom);
  const roomActive = !!room && state.buildings[room.unit].enabled
    && (room.floor !== 'first' || state.buildings[room.unit].storeys === 2);
  // Selection belongs to App, not SimulationState. Never substitute another room.
  const roomExposure = roomActive && exposure?.roomId === selectedRoom ? exposure : null;
  const roomDaily = roomActive && !analyzing && daily?.roomId === selectedRoom ? daily : null;
  const year = state.date.slice(0, 4);
  const step = roomDaily?.stepMinutes ?? 10;

  return (
    <>
      <section aria-labelledby={`${id}-sun`}>
        <SectionHeading id={`${id}-sun`} icon={Sun} title="שמש וזמן" source="חישוב אסטרונומי" />
        <div className="field-grid">
          <div className="field">
            <label className="field-label" htmlFor={`${id}-date`}>תאריך הסימולציה</label>
            <input id={`${id}-date`} type="date" dir="ltr" min="0001-01-01" max="9999-12-31"
              value={state.date} aria-label="תאריך הסימולציה" onChange={event => {
                const date = event.currentTarget.value;
                if (/^\d{4}-\d{2}-\d{2}$/.test(date) && event.currentTarget.validity.valid) {
                  changeTime(date, state.minutes);
                }
              }} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-time`}>שעה מקומית</label>
            <input id={`${id}-time`} type="time" dir="ltr" min="00:00" max="23:59" step={60}
              value={timeLabel(state.minutes)} aria-label="שעה מקומית בירושלים" onChange={event => {
                const match = /^(\d{2}):(\d{2})$/.exec(event.currentTarget.value);
                if (match) changeTime(state.date, Number(match[1]) * 60 + Number(match[2]));
              }} />
          </div>
        </div>
        <NumberField label="דקות מחצות" context="שעת הסימולציה" unit="דק׳"
          value={state.minutes} min={0} max={1439} step={1}
          onChange={minutes => changeTime(state.date, Math.round(minutes))} />
        <div className="segmented" role="group" aria-label="תאריכי עונות בשנה הנבחרת">
          {[
            ['12-21', 'חורף · 21.12'], ['06-21', 'קיץ · 21.06'],
            ['03-20', 'אביב · 20.03'], ['09-22', 'סתיו · 22.09'],
          ].map(([day, label]) => (
            <Button key={day} size="sm" variant={state.date === `${year}-${day}` ? 'primary' : 'secondary'}
              aria-pressed={state.date === `${year}-${day}`} aria-label={`${label} בשנת ${year}`}
              onClick={() => changeTime(`${year}-${day}`, state.minutes)}>{label}</Button>
          ))}
        </div>
        <p className="info-note">
          אזור זמן IANA: <bdi dir="ltr">{TIME_ZONE}</bdi>. שעון הקיץ מחושב אוטומטית לפי
          התאריך, ולא לפי שעון הדפדפן. בשעה שחוזרת בסתיו נבחר המופע המוקדם.
          קואורדינטות האתר ניתנות לעריכה בלשונית ״מגרש״.
        </p>
        {(timeError || solarError) && <p className="warning-note" role="alert">{timeError || solarError}</p>}
        {solar && <>
          <div className="field-row">
            <span className="badge">
              {solar.aboveHorizon ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
              {solar.aboveHorizon ? 'השמש מעל האופק' : 'לילה / מתחת לאופק · אין שמש ישירה'}
            </span>
            <span className="small-note">{solar.zoneLabel}</span>
          </div>
          <div className="field-grid">
            <Stat label="גובה שמש גאומטרי" value={`${numberLabel(solar.altitude, 1)}°`} />
            <Stat label="אזימוט מצפון אמיתי" value={`${numberLabel(solar.azimuth, 1)}°`} />
            <Stat label="זריחה" value={solar.sunrise ?? 'אין ביום זה'} />
            <Stat label="שקיעה" value={solar.sunset ?? 'אין ביום זה'} />
            <Stat label="צהרי שמש" value={solar.solarNoon ?? 'אין ביום זה'} />
            <Stat label="משך אור יום" value={`${numberLabel(solar.daylightHours)} שעות`} />
          </div>
          <p className="small-note">זריחה ושקיעה מתייחסות לאופק פנוי, לא למבנים באתר; צהרי שמש אינם בהכרח 12:00.</p>
        </>}
        <SectionHeading icon={Layers} title="קומה לתצוגת שמש" source="פתוחה ללא תקרה" />
        <SelectField<SimulationState['view']['isolateFloor']>
          label="בחרו קומה לצפייה" value={state.view.isolateFloor}
          options={[
            { value: 'none', label: 'כל הבית' },
            { value: 'basement', label: 'מרתף בלבד · פתוח מלמעלה' },
            { value: 'ground', label: 'קומת קרקע בלבד · פתוחה מלמעלה' },
            { value: 'first', label: 'קומה א׳ בלבד · פתוחה מלמעלה' },
            { value: 'roof', label: 'עליית גג בלבד · ללא הגג המשופע' },
          ]}
          onChange={isolateFloor => onChange({ ...state, view: {
            ...state.view,
            isolateFloor,
            planFloor: isolateFloor === 'basement' || isolateFloor === 'ground' || isolateFloor === 'first'
              ? isolateFloor : state.view.planFloor,
          } })}
        />
        <p className="small-note">המדרגות נשארות בכל קומה. בחירת קומה מסתירה את התקרות והקומות האחרות בתצוגה בלבד; חישוב הצל ממשיך להשתמש במבנה המלא.</p>
      </section>

      <section aria-labelledby={`${id}-room`}>
        <SectionHeading id={`${id}-room`} icon={ChartColumn} title="ניתוח חדר" source={`${ROOMS.length} חדרים בתוכניות`} />
        <div className="field">
          <label className="field-label" htmlFor={`${id}-room-select`}>חדר לניתוח ולסיור</label>
          <select id={`${id}-room-select`} value={selectedRoom} aria-label="חדר לניתוח ולסיור"
            onChange={event => onSelectRoom(event.currentTarget.value)}>
            {!room && <option value={selectedRoom} disabled>בחרו חדר מתוך התוכנית</option>}
            {UNITS.flatMap(unit => FLOORS.map(floor => (
              <optgroup key={`${unit}-${floor}`} label={`${UNIT_NAMES[unit]} · ${FLOOR_NAMES[floor]}`}>
                {SORTED_ROOMS.filter(item => item.unit === unit && item.floor === floor).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name}{!state.buildings[unit].enabled || (floor === 'first' && state.buildings[unit].storeys === 1) ? ' · אינו פעיל במודל' : ''}
                  </option>
                ))}
              </optgroup>
            )))}
          </select>
        </div>
        {room && <div className="room-list">
          <div className="field-row">
            <strong>{room.name}</strong>
            <span className="badge">{UNIT_NAMES[room.unit]} · {FLOOR_NAMES[room.floor]}</span>
          </div>
          <Button className="room-button" variant="secondary" disabled={!roomActive}
            onClick={() => onEnterRoom(room.id)} aria-label={`כניסה לחדר ${room.name} · ${UNIT_NAMES[room.unit]} · ${FLOOR_NAMES[room.floor]}`}>
            <ArrowUpRight size={16} aria-hidden="true" /> כניסה לחדר
          </Button>
        </div>}
        {room && !roomActive && <p className="warning-note">היחידה או הקומה שנבחרה אינן פעילות. יש להפעיל אותן בלשונית ״מבנה״, או לבחור חדר אחר.</p>}
        <div className="field-grid" aria-live="polite" aria-atomic="true">
          <Stat label="נקודות רצפה עם שמש כעת" value={roomExposure
            ? `${numberLabel(roomExposure.lit, 0)} / ${numberLabel(roomExposure.total, 0)}` : '— / 9'} />
          <Stat label="שמש ישירה כעת" value={roomExposure
            ? `${numberLabel(clamp(roomExposure.percent, 0, 100), 0)}%` : '—'} />
        </div>
        <p className="info-note">{roomExposure?.cause || 'בחרו חדר פעיל כדי לראות את סיבת החשיפה או החסימה בנקודות הרצפה.'}</p>
        <Button disabled={!roomActive || !solar || analyzing} aria-busy={analyzing} onClick={onAnalyze}>
          {analyzing ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <ChartColumn size={16} aria-hidden="true" />}
          {analyzing ? 'מחשב חשיפה יומית…' : 'ניתוח יום מלא לחדר'}
        </Button>
        <div className="field-grid" aria-live="polite" aria-atomic="true" aria-busy={analyzing}>
          <Stat label="שעות שמש ישירה · ממוצע רצפה" value={roomDaily ? `${numberLabel(roomDaily.sunHours)} שעות` : '—'} />
          <Stat label="שעות עם שמש בנקודה כלשהי" value={roomDaily ? `${numberLabel(roomDaily.anySunHours)} שעות` : '—'} />
        </div>
        <DailyChart daily={roomDaily} minutes={state.minutes} roomName={room?.name ?? 'חדר לא נבחר'} busy={analyzing} />
        <p className="small-note">
          הניתוח דוגם כל {numberLabel(step)} דקות (ברירת מחדל: 10) תשע נקודות ברצפת החדר.
          ממוצע הרצפה הוא סכום חלקן המואר של הנקודות לאורך היום; המדד השני סופר זמן
          שבו לפחות נקודה אחת מוארת. זהו אומדן שמש ישירה בלבד — לא לוקס ולא מדידת תאורה טבעית.
        </p>
      </section>
    </>
  );
}

function ModelPanel({ state, onChange, selectedUnit, onSelectUnit }: Pick<InspectorProps,
  'state' | 'onChange' | 'selectedUnit' | 'onSelectUnit'>) {
  const building = state.buildings[selectedUnit];
  const context = UNIT_NAMES[selectedUnit];
  const patch = (next: Partial<BuildingSettings>) => onChange({
    ...state, buildings: { ...state.buildings, [selectedUnit]: { ...building, ...next } },
  });
  const topFloorBase = building.groundHeight + (building.storeys === 2 ? building.upperHeight : 0);
  const totalHeight = building.roofEnabled ? building.roofPeakHeight : topFloorBase + building.parapet;
  const areas = floorAreaSchedule(selectedUnit, state);
  const areaTotals = areas.reduce((total, row) => ({
    gross: total.gross + row.gross, net: total.net + row.net, terraces: total.terraces + row.terraces,
  }), { gross: 0, net: 0, terraces: 0 });

  return (
    <>
      <SectionHeading icon={Building2} title="מבנה ויחידות" source="תוכנית + התאמות" />
      <UnitPicker selectedUnit={selectedUnit} onSelectUnit={onSelectUnit} />
      <section key={selectedUnit} aria-label={`מידות ${context}`}>
        <Toggle label="יחידה פעילה במודל ובחישוב הצל" context={context} checked={building.enabled}
          onChange={enabled => patch({ enabled })} />
        <div className="field-grid">
          <NumberField label="רוחב" context={context} unit="מ׳" value={building.width} min={5} max={18} onChange={width => patch({ width })} />
          <NumberField label="עומק" context={context} unit="מ׳" value={building.depth}
            min={selectedUnit === 'north' ? 3 : 4} max={selectedUnit === 'north' ? 15 : 20} onChange={depth => patch({ depth })} />
          <NumberField label="הזזה לרוחב · X" context={context} unit="מ׳" value={building.x} min={-12} max={12} step={0.1} onChange={x => patch({ x })} />
          <NumberField label="הזזה לאורך · Z" context={context} unit="מ׳" value={building.z} min={-12} max={12} step={0.1} onChange={z => patch({ z })} />
        </div>
        <NumberField label="סיבוב היחידה" context={context} unit="°" value={building.rotation} min={-30} max={30} step={0.1} onChange={rotation => patch({ rotation })} />
        <p className="info-note">
          ההגדלה מבוססת על קירות התוכנית, עם עוגן בקו הקיר המשותף. העומק משתנה ביחס
          לקו זה והרוחב ביחס לקצה התוכנית; הפתחים נעים עם הקירות. היחידות ניתנות להזזה ולסיבוב בנפרד.
        </p>
        <p className="warning-note">הזזות וסיבובים קיצוניים עלולים ליצור חפיפה או לנתק את הקיר המשותף. אין כאן מניעת התנגשויות או בדיקת היתר.</p>

        <SectionHeading icon={Layers} title="קומות וגבהים" />
        <SelectField label="קומות מעל הקרקע" context={context} value={String(building.storeys)}
          options={[{ value: '1', label: 'קומת קרקע בלבד' }, { value: '2', label: 'קרקע + קומה ראשונה' }]}
          onChange={value => patch({ storeys: value === '1' ? 1 : 2 })} />
        {selectedUnit === 'north' && <SelectField<BuildingSettings['firstFloorVariant']>
          label="חלופת קומה א׳ בבית הצפוני" context={context} value={building.firstFloorVariant}
          options={[
            { value: 'original', label: 'תוכנית קיימת · חדרי שינה' },
            { value: 'open-plan', label: 'חלופה חדשה · סלון, אוכל ואי מטבח פתוחים' },
          ]} onChange={firstFloorVariant => patch({ firstFloorVariant })} />}
        <div className="field-grid">
          <NumberField label="גובה קומת קרקע" context={context} unit="מ׳" value={building.groundHeight} min={2.6} max={4.8}
            onChange={groundHeight => patch({ groundHeight })} />
          <NumberField label="גובה קומה ראשונה" context={context} unit="מ׳" value={building.upperHeight} min={2.5} max={4.5}
            disabled={building.storeys === 1} onChange={upperHeight => patch({ upperHeight })} />
          <NumberField label="עומק מרתף" context={context} unit="מ׳" value={building.basementDepth} min={2.3} max={4}
            onChange={basementDepth => patch({ basementDepth })} />
          <NumberField label="גובה מעקה גג" context={context} unit="מ׳" value={building.parapet} min={0} max={1.8}
            onChange={parapet => patch({ parapet })} />
        </div>
        <Toggle label="קומת גג · סוויטת הורים ומשרד" context={context} checked={building.roofEnabled}
          disabled={building.storeys === 1} onChange={roofEnabled => patch({ roofEnabled })} />
        <div className="field-grid">
          <NumberField label="גובה קומת הגג" context={context} unit="מ׳" value={building.roofFloorHeight} min={2.2} max={4.5}
            disabled={!building.roofEnabled || building.storeys === 1} onChange={roofFloorHeight => patch({ roofFloorHeight })} />
          <NumberField label="גובה כולל בשפיץ" context={context} unit="מ׳" value={building.roofPeakHeight}
            min={Math.max(7, topFloorBase + building.roofFloorHeight)} max={15} step={0.05}
            disabled={!building.roofEnabled || building.storeys === 1}
            onChange={roofPeakHeight => patch({ roofPeakHeight })} />
        </div>
        <p className="small-note">קומת הגג משאירה מרפסות פתוחות לצפון ולמזרח. ברירת המחדל של שפיץ הגג היא 10.50 מ׳ מהקרקע.</p>
        <p className="small-note">
          <span className="source-tag">PDF</span> קרקע 3.40 מ׳ ומרתף 2.95 מ׳ כברירות מחדל.
          {' '}<span className="source-tag">הנחה</span> קומה ראשונה 3.10 מ׳; גובה זה לא נמדד מהתוכנית.
        </p>
        <div className="field-grid">
          <Stat label="שטח מעטפת קומת קרקע" value={`${numberLabel(buildingArea(selectedUnit, state), 1)} מ״ר`} />
          <Stat label="גובה מעל הקרקע עד ראש המעקה" value={`${numberLabel(totalHeight)} מ׳`} />
        </div>
        <p className="small-note">השטח מחושב לפי צורת מעטפת הקרקע, ולא לפי מלבן רוחב × עומק. אינו שטח נטו או שטח לרישוי; הגובה אינו כולל את המרתף.</p>
        <SectionHeading icon={Ruler} title="טבלת שטחים לפי קומה" source={context} />
        <div className="area-table-wrap">
          <table className="area-table">
            <thead><tr><th>קומה</th><th>ברוטו מודל</th><th>נטו משוער</th><th>מרפסות</th></tr></thead>
            <tbody>
              {areas.map(row => <tr key={row.id}><th>{row.label}</th>
                <td>{numberLabel(row.gross, 1)} מ״ר</td><td>{numberLabel(row.net, 1)} מ״ר</td>
                <td>{row.terraces > .05 ? `${numberLabel(row.terraces, 1)} מ״ר` : '—'}</td></tr>)}
            </tbody>
            <tfoot><tr><th>סה״כ יחידה</th><td>{numberLabel(areaTotals.gross, 1)} מ״ר</td>
              <td>{numberLabel(areaTotals.net, 1)} מ״ר</td><td>{numberLabel(areaTotals.terraces, 1)} מ״ר</td></tr></tfoot>
          </table>
        </div>
        <p className="warning-note">ברוטו מחושב לפי מעטפת הקומה במודל. נטו הוא אומדן לאחר ניכוי עקבות הקירות הממודלים. מרפסות מוצגות בנפרד. זה אינו חישוב שטחים להיתר, טאבו, ארנונה או מכר.</p>
      </section>

      <section aria-label="חתך ונראות">
        <SectionHeading icon={Eye} title="חתך ונראות" source="תצוגה בלבד" />
        <Toggle label="הצגת שמות חדרים" icon={Eye} checked={state.view.labels}
          onChange={labels => onChange({ ...state, view: { ...state.view, labels } })} />
        <SelectField<SimulationState['view']['isolateFloor']> label="קומה להצגה · פתוחה מלמעלה" value={state.view.isolateFloor}
          options={[
            { value: 'none', label: 'כל הבית' },
            { value: 'basement', label: 'מרתף בלבד' },
            { value: 'ground', label: 'קומת קרקע בלבד' },
            { value: 'first', label: 'קומה א׳ בלבד' },
            { value: 'roof', label: 'עליית גג בלבד · פתוחה' },
          ]} onChange={isolateFloor => onChange({ ...state, view: {
            ...state.view, isolateFloor,
            planFloor: isolateFloor === 'basement' || isolateFloor === 'ground' || isolateFloor === 'first'
              ? isolateFloor : state.view.planFloor,
          } })} />
        <p className="small-note">בקומה בודדת מוסתרות כל הקומות האחרות והתקרה שמעל, אך המדרגות של הקומה נשארות. ״כל הבית״ מחזיר את כל המעטפת והגגות.</p>
        <NumberField label="גובה עיניים בסיור" unit="מ׳" value={state.view.eyeHeight} min={0.5} max={2.2} step={0.05}
          onChange={eyeHeight => onChange({ ...state, view: { ...state.view, eyeHeight } })}
          description="אפשר לרדת לגובה 50 ס״מ כדי לבדוק מבט וצל מנקודה נמוכה." />
        <p className="info-note">בידוד קומה משנה רק את התצוגה. הגאומטריה הפיזית המוסתרת ממשיכה להשתתף בחישוב הצל.</p>
      </section>
    </>
  );
}

function OpeningsPanel({
  state, onChange, selectedUnit, onSelectUnit, selectedOpening, onSelectOpening,
}: Pick<InspectorProps, 'state' | 'onChange' | 'selectedUnit' | 'onSelectUnit' | 'selectedOpening' | 'onSelectOpening'>) {
  const allOpenings = useMemo(() => resolvedOpenings(state), [state]);
  const externalOpening = allOpenings.find(opening => opening.id === selectedOpening && opening.unit === selectedUnit);
  const externalFloor = externalOpening?.floor;
  const [floor, setFloor] = useState<FloorId>(() => externalFloor ?? 'ground');
  const [addWallId, setAddWallId] = useState('');
  useEffect(() => {
    if (externalFloor) setFloor(externalFloor);
  }, [selectedOpening, selectedUnit, externalFloor]);

  const walls = WALLS.filter(wall => wall.unit === selectedUnit && wall.floor === floor);
  const openings = allOpenings.filter(opening => opening.unit === selectedUnit && opening.floor === floor);
  // An effective first selection avoids calling parent setters during render.
  const opening = openings.find(item => item.id === selectedOpening) ?? openings[0];
  const wall = opening ? WALLS.find(item => item.id === opening.wallId) : undefined;
  const building = state.buildings[selectedUnit];
  const length = wall ? actualWallLength(wall, state) : 0;
  const height = wall ? wallHeight(wall, building) : 0;
  const removed = !!opening && (opening.width === 0 || opening.height === 0);
  const hasOverride = !!opening && Object.keys(state.openings[opening.id] ?? {}).length > 0;
  const addWall = walls.find(item => item.id === addWallId)
    ?? walls.find(item => item.exterior && item.low === undefined && !item.retaining
      && actualWallLength(item, state) >= 1.2 && wallHeight(item, building) >= 2.35)
    ?? walls[0];
  const context = opening ? `${UNIT_NAMES[selectedUnit]} · ${FLOOR_NAMES[floor]} · ${opening.label}` : '';

  const patchOpening = (next: Partial<OpeningSpec>) => {
    if (!opening) return;
    onChange({ ...state, openings: {
      ...state.openings, [opening.id]: { ...state.openings[opening.id], ...next },
    } });
  };
  const restoreOpening = () => {
    if (!opening) return;
    const overrides = { ...state.openings };
    delete overrides[opening.id];
    onChange({ ...state, openings: overrides });
  };
  const deleteOpening = () => {
    if (!opening) return;
    if (opening.source === 'plan') {
      patchOpening({ width: 0, height: 0 });
      return;
    }
    const overrides = { ...state.openings };
    delete overrides[opening.id];
    onChange({ ...state, openings: overrides, addedOpenings: state.addedOpenings.filter(item => item.id !== opening.id) });
    onSelectOpening(openings.find(item => item.id !== opening.id)?.id ?? null);
  };
  const addOpening = () => {
    if (!addWall) return;
    const added: OpeningSpec = {
      id: `added-${crypto.randomUUID()}`,
      // Use the unit-specific PlanWall.id, not the unsplit PDF sourceId.
      wallId: addWall.id,
      label: `חלון נוסף ${state.addedOpenings.length + 1} · ${FLOOR_NAMES[floor]}`,
      unit: selectedUnit,
      floor,
      kind: 'window',
      position: 0.5,
      width: 1.2,
      height: 1.35,
      sill: 0.95,
      source: 'added',
      overhang: 0,
      open: false,
      shutter: false,
    };
    onChange({ ...state, addedOpenings: [...state.addedOpenings, added] });
    onSelectOpening(added.id);
  };

  return (
    <>
      <SectionHeading icon={DoorOpen} title="פתחים בקירות" source="פתחים חודרים" />
      <UnitPicker selectedUnit={selectedUnit} onSelectUnit={unit => {
        onSelectUnit(unit);
        onSelectOpening(allOpenings.find(item => item.unit === unit && item.floor === floor)?.id ?? null);
      }} />
      <SelectField label="קומת הפתחים" value={floor} options={FLOOR_OPTIONS} onChange={next => {
        setFloor(next);
        setAddWallId('');
        onSelectOpening(allOpenings.find(item => item.unit === selectedUnit && item.floor === next)?.id ?? null);
      }} />
      {(!building.enabled || (floor === 'first' && building.storeys === 1)) &&
        <p className="warning-note">אפשר לערוך את הפתחים, אך היחידה או הקומה אינן פעילות כרגע במודל.</p>}
      <SelectField label="בחירת פתח" value={opening?.id ?? ''}
        options={openings.map((item, index) => ({ value: item.id,
          label: `${index + 1}. ${KIND_NAMES[item.kind]} · ${FLOOR_NAMES[item.floor]} · קיר ${walls.findIndex(candidate => candidate.id === item.wallId) + 1}${item.source === 'added' ? ' · נוסף' : ''}${item.width === 0 || item.height === 0 ? ' · הוסר' : ''}`,
        }))} onChange={onSelectOpening} />
      <p className="info-note">
        רוחבי ומיקומי פתחי המקור נגזרו מווקטורים ב־PDF מכויל למטרים. הגבהים, האדנים
        וסיווג הפתחים הם הנחות ניתנות לעריכה. שינוי המידות מעדכן חורים אמיתיים בקירות, לא רק סימון על המשטח.
      </p>

      {opening && wall ? <section key={opening.id} aria-label={`עריכת ${context}`}>
        <div className="field-row">
          <strong>{opening.label}</strong>
          <span className="source-tag">{opening.source === 'plan' ? 'מקור: PDF מכויל' : 'מקור: פתח שנוסף'}</span>
          {hasOverride && <span className="badge">נערך</span>}
        </div>
        <div className="field-grid">
          <Stat label="אורך הקיר בפועל" value={`${numberLabel(length)} מ׳`} />
          <Stat label="גובה הקיר בפועל" value={`${numberLabel(height)} מ׳`} />
        </div>
        {removed ? <p className="warning-note">הפתח הוסר באמצעות רוחב וגובה אפס. אפשר לשחזר את פתח המקור בלי לשנות קירות אחרים.</p> : <>
          <SelectField label="סוג הפתח" context={context} value={opening.kind} options={KIND_OPTIONS}
            onChange={kind => patchOpening({ kind })} />
          <div className="field-grid">
            <NumberField label="רוחב פתח" context={context} unit="מ׳" value={opening.width} min={0.2} max={length}
              onChange={width => patchOpening({ width })} />
            <NumberField label="גובה פתח" context={context} unit="מ׳" value={opening.height} min={0.2} max={height}
              onChange={next => patchOpening({ height: next })} />
            <NumberField label="גובה אדן מהרצפה" context={context} unit="מ׳" value={opening.sill} min={0} max={Math.max(0, height - 0.1)}
              onChange={sill => patchOpening({ sill })} />
            <NumberField label="בליטת הצללה" context={context} unit="מ׳" value={opening.overhang} min={0} max={2.5} step={0.05}
              onChange={overhang => patchOpening({ overhang })} />
          </div>
          <NumberField label="מיקום מרכז לאורך הקיר" context={context} unit="%" value={opening.position * 100} min={0} max={100} step={0.1}
            onChange={position => patchOpening({ position: position / 100 })} />
          {opening.kind === 'door'
            ? <Toggle label="דלת פתוחה" context={context} checked={opening.open} onChange={open => patchOpening({ open })} />
            : <Toggle label="תריס סגור · חוסם שמש ישירה" context={context} checked={opening.shutter} onChange={shutter => patchOpening({ shutter })} />}
          <p className="small-note">המיקום נמדד מתחילת הקיר המקורי. הרוחב הוא במטרים בעולם; עריכה ידנית שלו מחליפה את ההגדלה האוטומטית של רוחב ה־PDF עד לשחזור.</p>
          {(opening.width > length || opening.sill + opening.height > height - 0.05
            || opening.position * length < opening.width / 2 || opening.position * length + opening.width / 2 > length) &&
            <p className="warning-note">הפתח המבוקש מגיע לשפת הקיר. הגאומטריה מגבילה אותו לתחומי הקיר ומשאירה מרווח עליון של 5 ס״מ; המידה המבוקשת עשויה להיות גדולה מהפתח שנוצר.</p>}
        </>}
        <div className="field-row">
          <Button variant="secondary" size="sm" disabled={!hasOverride} onClick={restoreOpening}>
            <RotateCcw size={15} aria-hidden="true" />{opening.source === 'plan' ? 'שחזור פתח המקור' : 'איפוס עריכות הפתח'}
          </Button>
          <Button variant="ghost" size="sm" disabled={opening.source === 'plan' && removed} onClick={deleteOpening}>
            <Trash2 size={15} aria-hidden="true" /> מחיקת פתח
          </Button>
        </div>
      </section> : <p className="small-note">אין פתחים בקומה וביחידה שנבחרו. ניתן להוסיף חלון בקיר קיים.</p>}

      <section aria-label="הוספת חלון לקיר קיים">
        <SectionHeading icon={Plus} title="הוספת חלון" source="הנחת משתמש" />
        <SelectField label="קיר לחלון החדש" value={addWall?.id ?? ''}
          options={walls.map((item, index) => ({ value: item.id,
            label: `קיר ${index + 1} · ${item.retaining ? 'תמך' : item.low !== undefined ? 'מעקה' : item.exterior ? 'חוץ' : 'פנים'} · ${numberLabel(actualWallLength(item, state))} מ׳`,
          }))} onChange={setAddWallId} />
        <Button variant="secondary" onClick={addOpening} disabled={!addWall}>
          <Plus size={16} aria-hidden="true" /> הוספת חלון בקיר הנבחר
        </Button>
        <p className="small-note">ברירת מחדל: מרכז הקיר, רוחב 1.20 מ׳, גובה 1.35 מ׳ ואדן 0.95 מ׳. בקיר קצר או נמוך הפתח יוגבל לגבולות הקיר; כל המידות ניתנות לעריכה.</p>
      </section>
    </>
  );
}

function SitePanel({ state, onChange, onShowSources, onReferenceUpload }: Pick<InspectorProps,
  'state' | 'onChange' | 'onShowSources' | 'onReferenceUpload'>) {
  const uploadId = useId();
  const patchLocation = (next: Partial<SimulationState['location']>) =>
    onChange({ ...state, location: { ...state.location, ...next } });
  const patchReference = (next: Partial<SimulationState['reference']>) =>
    onChange({ ...state, reference: { ...state.reference, ...next } });
  const patchView = (next: Partial<SimulationState['view']>) =>
    onChange({ ...state, view: { ...state.view, ...next } });
  const patchNeighbor = (id: NeighborSettings['id'], next: Partial<NeighborSettings>) => {
    onChange({ ...state, neighbors: state.neighbors.map(neighbor => {
      if (neighbor.id !== id) return neighbor;
      const updated = { ...neighbor, ...next };
      const height = clamp(updated.height, 3, 16);
      return { ...updated, height, roofRise: clamp(updated.roofRise, 0, Math.min(4, height - 0.1)) };
    }) });
  };

  return (
    <>
      <section aria-label="כיוון ומיקום האתר">
        <SectionHeading icon={Compass} title="כיוון ומיקום" />
        <NumberField label="אזימוט מעלה התוכנית מצפון אמיתי" unit="°" value={state.northBearing} min={-180} max={180} step={0.1}
          onChange={northBearing => onChange({ ...state, northBearing })} />
        <p className="small-note"><span className="source-tag">חץ צפון · PDF</span> ברירת המחדל 14.7°, עם כיוון השעון מצפון אמיתי. אינה סיבוב של יחידה בודדת.</p>
        <div className="field-grid">
          <NumberField label="קו רוחב" context="מיקום האתר" unit="°" value={state.location.latitude} min={-89} max={89} step={0.000001}
            onChange={latitude => patchLocation({ latitude })} />
          <NumberField label="קו אורך" context="מיקום האתר" unit="°" value={state.location.longitude} min={-180} max={180} step={0.000001}
            onChange={longitude => patchLocation({ longitude })} />
        </div>
        <NumberField label="גובה הקרקע מעל פני הים" context="מיקום האתר" unit="מ׳" value={state.location.elevation} min={-450} max={4000} step={0.1}
          onChange={elevation => patchLocation({ elevation })} />
        <p className="warning-note">המיקום הראשוני הוא קירוב מתוצאת גאוקוד של הרחוב, לא מדידה של גג או של מספר הבית. הגובה ההתחלתי 65 מ׳ הוא אומדן. יש לאמת מיקום וגובה במדידה.</p>
      </section>

      <section aria-label="כיול תצלום ייחוס מקומי">
        <SectionHeading icon={Upload} title="תצלום ייחוס" source="מקומי בלבד" />
        <div className="field">
          <label className="field-label" htmlFor={uploadId}>בחירת תמונת ייחוס מהמחשב</label>
          <input id={uploadId} type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            aria-label="בחירת תמונת ייחוס מקומית מסוג PNG, JPEG או WebP" onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) onReferenceUpload(file);
              event.currentTarget.value = '';
            }} />
        </div>
        <Toggle label="הצגת תצלום הייחוס" icon={Eye} checked={state.reference.visible} disabled={!state.reference.image}
          onChange={visible => patchReference({ visible })} />
        <p className="small-note">{state.reference.image ? 'תצלום מקומי טעון.' : 'טרם נבחר תצלום.'} אין העלאה לשרת. הכיול ידני ואינו מדידה או מיקום גאוגרפי מאומת.</p>
        <div className="field-grid">
          <NumberField label="רוחב תצלום" context="כיול תצלום" unit="מ׳" value={state.reference.width} min={10} max={150} step={0.1}
            onChange={width => patchReference({ width })} />
          <NumberField label="עומק תצלום" context="כיול תצלום" unit="מ׳" value={state.reference.depth} min={10} max={150} step={0.1}
            onChange={depth => patchReference({ depth })} />
          <NumberField label="מיקום תצלום · X" context="כיול תצלום" unit="מ׳" value={state.reference.x} min={-60} max={60} step={0.1}
            onChange={x => patchReference({ x })} />
          <NumberField label="מיקום תצלום · Z" context="כיול תצלום" unit="מ׳" value={state.reference.z} min={-60} max={60} step={0.1}
            onChange={z => patchReference({ z })} />
        </div>
        <NumberField label="סיבוב תצלום" context="כיול תצלום" unit="°" value={state.reference.rotation} min={-180} max={180} step={0.1}
          onChange={rotation => patchReference({ rotation })} />
        <NumberField label="אטימות תצלום" context="כיול תצלום" value={state.reference.opacity} min={0} max={1}
          onChange={opacity => patchReference({ opacity })} />
      </section>

      <section aria-label="מבנים שכנים">
        <SectionHeading icon={Building2} title="מבנים שכנים" source="9 מ׳ · נתון משתמש" />
        <p className="info-note">גובה ברירת המחדל של שני השכנים הוא 9 מ׳ — נתון משתמש, לא מידה מאומתת ב־PDF. תכסיות השכנים ומרווח השכן ממזרח הם אומדנים; צורת הגגות משוערת.</p>
        {state.neighbors.map(neighbor => <fieldset key={neighbor.id} className="field">
          <legend className="section-heading">{neighbor.name}</legend>
          <Toggle label="שכן פעיל בחישוב הצל" context={neighbor.name} checked={neighbor.enabled}
            onChange={enabled => patchNeighbor(neighbor.id, { enabled })} />
          <div className="field-grid">
            <NumberField label="גובה כולל" context={neighbor.name} unit="מ׳" value={neighbor.height} min={3} max={16}
              onChange={height => patchNeighbor(neighbor.id, { height })} />
            <NumberField label="הגבהת הגג" context={neighbor.name} unit="מ׳" value={neighbor.roofRise} min={0} max={Math.min(4, Math.max(0, neighbor.height - 0.1))}
              onChange={roofRise => patchNeighbor(neighbor.id, { roofRise })} />
            <NumberField label="רוחב שכן" context={neighbor.name} unit="מ׳" value={neighbor.width} min={5} max={25} step={0.1}
              onChange={width => patchNeighbor(neighbor.id, { width })} />
            <NumberField label="עומק שכן" context={neighbor.name} unit="מ׳" value={neighbor.depth} min={5} max={25} step={0.1}
              onChange={depth => patchNeighbor(neighbor.id, { depth })} />
            <NumberField label="מיקום שכן · X" context={neighbor.name} unit="מ׳" value={neighbor.x} min={-40} max={40} step={0.1}
              onChange={x => patchNeighbor(neighbor.id, { x })} />
            <NumberField label="מיקום שכן · Z" context={neighbor.name} unit="מ׳" value={neighbor.z} min={-40} max={40} step={0.1}
              onChange={z => patchNeighbor(neighbor.id, { z })} />
          </div>
          <NumberField label="סיבוב שכן" context={neighbor.name} unit="°" value={neighbor.rotation} min={-90} max={90} step={0.1}
            onChange={rotation => patchNeighbor(neighbor.id, { rotation })} />
          <p className="small-note">הגובה הכולל כולל את הגג; הגבהת הגג מוגבלת לפחות מהגובה הכולל, גם כאשר מנמיכים את המבנה.</p>
        </fieldset>)}
      </section>

      <section aria-label="מיקום רכבים בשביל">
        <SectionHeading icon={Move} title="רכבים בשביל" source="Tesla Model Y · קנה מידה אמיתי" />
        <NumberField label="רכב בשביל הדרומי · קדימה / אחורה" context="רכב דרומי" unit="מ׳"
          value={state.vehicles.southZ} min={10.5} max={20.5} step={0.1}
          onChange={southZ => onChange({ ...state, vehicles: { ...state.vehicles, southZ } })} />
        <NumberField label="רכב ליד כניסת הבית הצפוני · קדימה / אחורה" context="רכב צפוני" unit="מ׳"
          value={state.vehicles.northZ} min={8.5} max={18.5} step={0.1}
          onChange={northZ => onChange({ ...state, vehicles: { ...state.vehicles, northZ } })} />
        <p className="small-note">הערך הוא מיקום מרכז הרכב לאורך ציר השביל. המידות נשארות 4.75 × 1.92 × 1.62 מ׳.</p>
      </section>

      <section aria-label="שכבות ואיכות תצוגה">
        <SectionHeading icon={Ruler} title="שכבות תצוגה" source="תוכניות PDF נפרדות" />
        <Toggle label="הצגת תוכנית המקור" checked={state.view.planVisible} onChange={planVisible => patchView({ planVisible })} />
        <SelectField label="קומת תוכנית הרקע" value={state.view.planFloor} options={FLOOR_OPTIONS}
          onChange={planFloor => patchView({ planFloor })} />
        <NumberField label="אטימות תוכנית הרקע" context="תוכנית PDF" value={state.view.planOpacity} min={0} max={1}
          onChange={planOpacity => patchView({ planOpacity })} />
        <p className="small-note">לכל קומה מוצגת התוכנית הנפרדת שלה מה־PDF; החלפת תמונת הרקע אינה משנה קומות או קירות במודל.</p>
        <Toggle label="הצגת רשת מגרש" checked={state.view.grid} onChange={grid => patchView({ grid })} />
        <Toggle label="הצגת מסלול השמש" checked={state.view.path} onChange={path => patchView({ path })} />
        <Toggle label="הצגת מידות" checked={state.view.dimensions} onChange={dimensions => patchView({ dimensions })} />
        <Toggle label="תצוגת שמש ישירה בלבד" checked={state.view.directOnly} onChange={directOnly => patchView({ directOnly })} />
        <SelectField<SimulationState['view']['quality']> label="איכות תצוגת הצל" value={state.view.quality}
          options={[{ value: 'standard', label: 'רגילה · תגובה מהירה' }, { value: 'high', label: 'גבוהה · צל מפורט' }]}
          onChange={quality => patchView({ quality })} />
        <Button variant="secondary" onClick={onShowSources}><FileText size={16} aria-hidden="true" /> מקורות, הנחות ודיוק</Button>
      </section>
    </>
  );
}

export function Inspector(props: InspectorProps) {
  const id = useId();
  const [tab, setTab] = useState<TabId>('sun');
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const chooseTab = (next: TabId) => {
    setTab(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number;
    // The first tab is at the right edge in RTL, so Left advances through DOM order.
    if (event.key === 'ArrowLeft') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowRight') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    const next = TABS[nextIndex].id;
    chooseTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <aside className="inspector" dir="rtl" aria-label="לוח עריכת סימולציית שמש">
      <div className="inspector-tabs" role="tablist" aria-label="לשוניות הסימולטור" aria-orientation="horizontal">
        {TABS.map(({ id: key, label, icon: Icon }, index) => (
          <Button key={key} ref={element => { tabRefs.current[key] = element; }}
            id={`${id}-tab-${key}`} role="tab" className={cn('inspector-tab', tab === key && 'active')}
            variant={tab === key ? 'primary' : 'ghost'} aria-selected={tab === key}
            aria-controls={`${id}-panel-${key}`} tabIndex={tab === key ? 0 : -1}
            onClick={() => chooseTab(key)} onKeyDown={event => handleTabKey(event, index)}>
            <Icon size={18} aria-hidden="true" /><span>{label}</span>
          </Button>
        ))}
      </div>
      <div className="inspector-body" ref={bodyRef}>
        {TABS.map(({ id: key }) => <div key={key} id={`${id}-panel-${key}`} role="tabpanel"
          aria-labelledby={`${id}-tab-${key}`} hidden={tab !== key} tabIndex={0}>
          {tab === key && (key === 'sun' ? <SunPanel {...props} />
            : key === 'model' ? <ModelPanel {...props} />
              : key === 'openings' ? <OpeningsPanel {...props} /> : <SitePanel {...props} />)}
        </div>)}
        <p className="small-note">סימולציית הצללה מקורבת, לא בדיקת תאורה מוסמכת. אור מפוזר, החזרות והארה בלוקס אינם מחושבים.</p>
      </div>
    </aside>
  );
}

export default Inspector;