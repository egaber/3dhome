import {
  AstroTime,
  Atmosphere,
  Body,
  DEG2RAD,
  Equator,
  Horizon,
  KM_PER_AU,
  Observer,
  RAD2DEG,
  SearchHourAngle,
  SearchRiseSet,
} from 'astronomy-engine';
import { DateTime } from 'luxon';

export const TIME_ZONE = 'Asia/Jerusalem';

export interface SolarLocation {
  /** Geographic degrees north, in [-90, 90]. */
  latitude: number;
  /** Geographic degrees east, in [-180, 180]. */
  longitude: number;
  /** Ground-level observer elevation in metres above mean sea level. */
  elevation: number;
}

export interface SolarState {
  instant: Date;
  /** Jerusalem ISO date/time, including its UTC offset. */
  localISO: string;
  /** Jerusalem wall-clock time, HH:mm, using Latin digits. */
  localTimeLabel: string;
  zoneLabel: string;
  /** Minutes east of UTC, not hours. */
  utcOffset: number;
  /** Topocentric solar-centre altitude, degrees, WITHOUT atmospheric refraction. */
  altitude: number;
  /** Solar-centre altitude with Astronomy Engine's standard "normal" refraction. */
  apparentAltitude: number;
  /** Degrees clockwise from true north: north=0, east=90, south=180, west=270. */
  azimuth: number;
  /** Unit vector TOWARD the Sun: +x east, +y up, +z south; light rays go opposite. */
  direction: { x: number; y: number; z: number };
  /** Geometric solar centre is strictly above the horizontal plane (altitude > 0). */
  aboveHorizon: boolean;
  /** First upper-limb rise/set in this civil day; HH:mm truncates event seconds. */
  sunrise: string | null;
  sunset: string | null;
  /** First upper meridian transit in this civil day, NOT civil-clock 12:00. */
  solarNoon: string | null;
  /** Actual elapsed daylight within the civil day, including repeated DST time. */
  daylightHours: number;
  /** Horizontal shadow length / vertical obstacle height; null at/below horizon. */
  shadowFactor: number | null;
  error?: string;
}

type DailyEvents = Pick<SolarState, 'sunrise' | 'sunset' | 'solarNoon' | 'daylightHours'>;
type SunPathPoint = Pick<SolarState, 'altitude' | 'azimuth' | 'direction'> & { minutes: number };
type Crossing = { millis: number; direction: 1 | -1 };

const DISPLAY_OPTIONS = { locale: 'he-IL', numberingSystem: 'latn', outputCalendar: 'gregory' } as const;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_CACHED_DAYS = 64;
// At most 64 (civil date, exact location) entries TOTAL, not an unbounded map per site.
const dailyEventCache = new Map<string, Readonly<DailyEvents>>();

function parseCivilDate(dateISO: string): DateTime {
  if (typeof dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new RangeError('dateISO must be a valid Gregorian date in YYYY-MM-DD format.');
  }
  // Validate the calendar independently of DST, including historical midnight gaps.
  const date = DateTime.fromISO(dateISO, { zone: 'UTC', ...DISPLAY_OPTIONS });
  if (!date.isValid) {
    throw new RangeError(`Invalid calendar date: ${dateISO}.`);
  }
  return date;
}

function earlierOccurrence(local: DateTime): DateTime {
  return local.getPossibleOffsets().reduce(
    (earlier, candidate) => candidate.toMillis() < earlier.toMillis() ? candidate : earlier,
    local,
  );
}

/** null means a nonexistent wall time, never a silently normalized time. */
function resolveWallTime(date: DateTime, minutes: number): DateTime | null {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const local = DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day, hour, minute, second: 0, millisecond: 0 },
    { zone: TIME_ZONE, ...DISPLAY_OPTIONS },
  );
  if (!local.isValid) {
    throw new RangeError(`Cannot resolve local time in ${TIME_ZONE}: ${local.invalidExplanation}.`);
  }
  // Luxon normalizes spring-forward gaps; explicitly reject that normalization.
  if (local.year !== date.year || local.month !== date.month || local.day !== date.day
    || local.hour !== hour || local.minute !== minute) {
    return null;
  }
  return earlierOccurrence(local);
}

/**
 * Resolve integer wall-clock minutes [0, 1439] on a strict YYYY-MM-DD date.
 * Throws RangeError for invalid input or a DST gap. In a fall-back fold, always
 * choose the EARLIER instant (the pre-transition offset, +03:00 in modern Israel),
 * independently of the host zone, today's date, or Luxon's initial offset guess.
 */
export function resolveLocalDateTime(dateISO: string, minutes: number): DateTime {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new RangeError('minutes must be an integer between 0 and 1439.');
  }
  const local = resolveWallTime(parseCivilDate(dateISO), minutes);
  if (!local) {
    throw new RangeError(`Nonexistent local time (DST gap) in ${TIME_ZONE}: ${dateISO}, minute ${minutes}.`);
  }
  return local;
}

function createObserver(location: SolarLocation): Observer {
  if (!location || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90) {
    throw new RangeError('latitude must be finite and between -90 and 90 degrees.');
  }
  if (!Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) {
    throw new RangeError('longitude must be finite and between -180 and 180 degrees.');
  }
  // SearchRiseSet uses Atmosphere, whose documented elevation range is limited.
  if (!Number.isFinite(location.elevation) || location.elevation < -500 || location.elevation > 100_000) {
    throw new RangeError('elevation must be finite and between -500 and 100000 metres above sea level.');
  }
  return new Observer(location.latitude, location.longitude, location.elevation);
}

/** Convert geometric angles to a right-handed Three.js world vector toward the Sun. */
export function solarDirection(altitude: number, azimuth: number): SolarState['direction'] {
  if (!Number.isFinite(altitude) || Math.abs(altitude) > 90 || !Number.isFinite(azimuth)) {
    throw new RangeError('Solar angles must be finite; altitude must be between -90 and 90 degrees.');
  }
  const elevation = altitude * DEG2RAD;
  const bearing = (((azimuth % 360) + 360) % 360) * DEG2RAD;
  const horizontal = Math.cos(elevation);
  return {
    x: horizontal * Math.sin(bearing),
    y: Math.sin(elevation),
    z: -horizontal * Math.cos(bearing),
  };
}

function sunCoordinates(instant: Date, observer: Observer) {
  // Reusing AstroTime also reuses Astronomy Engine's per-instant orientation data.
  const time = new AstroTime(instant);
  const equatorial = Equator(Body.Sun, time, observer, true, true);
  // 2.1.19: omitted/undefined refraction is airless; the string "airless" is NOT supported.
  const geometric = Horizon(time, observer, equatorial.ra, equatorial.dec);
  return { time, equatorial, geometric };
}

function crossingsWithinDay(observer: Observer, direction: 1 | -1, start: number, end: number): Crossing[] {
  const crossings: Crossing[] = [];
  let cursor = start;
  while (cursor < end) {
    const found = SearchRiseSet(Body.Sun, observer, direction, new Date(cursor), (end - cursor) / DAY_MS);
    if (!found) break;
    const millis = found.date.getTime();
    // The engine's end limit is inclusive; our civil day is [start, next midnight).
    if (millis >= cursor && millis < end) crossings.push({ millis, direction });
    // A 25-hour day can contain two rises or two sets at some longitudes. Search
    // again, advancing beyond the root's documented 0.1-second search tolerance.
    cursor = Math.max(cursor + 1000, millis + 1000);
  }
  return crossings;
}

function upperLimbIsVisible(instant: Date, observer: Observer): boolean {
  const { equatorial, geometric } = sunCoordinates(instant, observer);
  // Match SearchRiseSet's ground-level visibility criterion for no-event/polar
  // days: IAU nominal solar radius 695700 km and 34 arcminutes * relative density.
  // Do not use geometric centre > 0 here: a polar day can have its centre below 0.
  const angularRadius = Math.asin((695_700 / KM_PER_AU) / equatorial.dist) * RAD2DEG;
  const horizonRefraction = (34 / 60) * Atmosphere(observer.height).density;
  return geometric.altitude + angularRadius + horizonRefraction > 0;
}

function eventLabel(millis: number | undefined): string | null {
  return millis === undefined ? null : DateTime.fromMillis(millis, { zone: TIME_ZONE, ...DISPLAY_OPTIONS }).toFormat('HH:mm');
}

function dailyEvents(local: DateTime, observer: Observer): Readonly<DailyEvents> {
  const key = JSON.stringify([local.toISODate(), observer.latitude, observer.longitude, observer.height]);
  const cached = dailyEventCache.get(key);
  if (cached) {
    dailyEventCache.delete(key);
    dailyEventCache.set(key, cached);
    return cached;
  }

  // Calendar addition, NOT 24 elapsed hours: Jerusalem transition days are 23/25
  // hours. startOf also handles historical days whose midnight did not exist.
  const startLocal = earlierOccurrence(local.startOf('day'));
  const endLocal = earlierOccurrence(startLocal.plus({ days: 1 }).startOf('day'));
  const start = startLocal.toMillis();
  const end = endLocal.toMillis();
  const rises = crossingsWithinDay(observer, 1, start, end);
  const sets = crossingsWithinDay(observer, -1, start, end);
  const crossings = [...rises, ...sets].sort((a, b) => a.millis - b.millis);
  const transit = SearchHourAngle(Body.Sun, observer, 0, new Date(start), 1).time.date.getTime();

  // Integrate lit intervals in real elapsed time. This also handles days with
  // only a rise or only a set, daylight crossing midnight, and polar day/night.
  let lit = crossings.length > 0
    ? crossings[0].direction === -1
    : upperLimbIsVisible(new Date(start + (end - start) / 2), observer);
  let previous = start;
  let daylightMillis = 0;
  for (const crossing of crossings) {
    if (lit) daylightMillis += crossing.millis - previous;
    previous = crossing.millis;
    lit = crossing.direction === 1;
  }
  if (lit) daylightMillis += end - previous;

  const events: Readonly<DailyEvents> = Object.freeze({
    sunrise: eventLabel(rises[0]?.millis),
    sunset: eventLabel(sets[0]?.millis),
    solarNoon: eventLabel(transit >= start && transit < end ? transit : undefined),
    daylightHours: Math.min(end - start, Math.max(0, daylightMillis)) / HOUR_MS,
  });
  if (dailyEventCache.size >= MAX_CACHED_DAYS) {
    const oldest = dailyEventCache.keys().next().value;
    if (oldest !== undefined) dailyEventCache.delete(oldest);
  }
  dailyEventCache.set(key, events);
  return events;
}

/**
 * Physical topocentric solar ephemeris, with precession/nutation, aberration and
 * light travel time. Invalid inputs throw; no invented fallback Sun is returned.
 * Rise/set describes a standard-atmosphere upper limb over unobstructed, level
 * ground, not site obstructions. Geometry/shadows use the unrefracted centre.
 */
export function calculateSolar(dateISO: string, minutes: number, location: SolarLocation): SolarState {
  const local = resolveLocalDateTime(dateISO, minutes);
  const observer = createObserver(location);
  const instant = local.toJSDate();
  const { time, equatorial, geometric } = sunCoordinates(instant, observer);
  const apparent = Horizon(time, observer, equatorial.ra, equatorial.dec, 'normal');
  const aboveHorizon = geometric.altitude > 0;

  return {
    instant,
    localISO: local.toISO()!,
    localTimeLabel: local.toFormat('HH:mm'),
    zoneLabel: `${local.isInDST ? 'שעון קיץ ישראל' : 'שעון ישראל'} (UTC${local.toFormat('ZZ')})`,
    utcOffset: local.offset,
    altitude: geometric.altitude,
    apparentAltitude: apparent.altitude,
    azimuth: geometric.azimuth,
    direction: solarDirection(geometric.altitude, geometric.azimuth),
    aboveHorizon,
    shadowFactor: aboveHorizon ? 1 / Math.tan(geometric.altitude * DEG2RAD) : null,
    ...dailyEvents(local, observer),
  };
}

/**
 * Sample wall-clock minutes 0, step, 2*step, ... < 1440 (default step: 15).
 * ONLY geometric altitude > 0 samples are returned. DST gaps are omitted, folds
 * use the earlier occurrence, exactly as resolveLocalDateTime. stepMinutes must
 * be an integer in [1, 1440]; at most 1440 samples are evaluated. No event searches
 * or retained path cache are needed. Every call returns fresh, mutable vectors.
 */
export function getSunPath(dateISO: string, location: SolarLocation, stepMinutes = 15): SunPathPoint[] {
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > 1440) {
    throw new RangeError('stepMinutes must be an integer between 1 and 1440.');
  }
  const date = parseCivilDate(dateISO);
  const observer = createObserver(location);
  const path: SunPathPoint[] = [];
  for (let minutes = 0; minutes < 1440; minutes += stepMinutes) {
    const local = resolveWallTime(date, minutes);
    if (!local) continue;
    const { geometric: { altitude, azimuth } } = sunCoordinates(local.toJSDate(), observer);
    if (altitude > 0) path.push({ minutes, altitude, azimuth, direction: solarDirection(altitude, azimuth) });
  }
  return path;
}