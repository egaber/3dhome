import * as Astronomy from 'astronomy-engine';
import { DateTime, Settings } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateSolar, getSunPath, resolveLocalDateTime, solarDirection, TIME_ZONE } from './solar';
import type { SolarLocation, SolarState } from './solar';

// Count expensive searches without replacing their physical ephemeris results.
vi.mock('astronomy-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('astronomy-engine')>();
  return {
    ...actual,
    SearchRiseSet: vi.fn(actual.SearchRiseSet),
    SearchHourAngle: vi.fn(actual.SearchHourAngle),
  };
});

const RAANANA: SolarLocation = { latitude: 32.1848, longitude: 34.8713, elevation: 50 };
const originalZone = Settings.defaultZone;
const originalLocale = Settings.defaultLocale;
const originalNow = Settings.now;

afterEach(() => {
  Settings.defaultZone = originalZone;
  Settings.defaultLocale = originalLocale;
  Settings.now = originalNow;
  vi.clearAllMocks();
});

function minutesFromLabel(label: string | null): number {
  expect(label).toMatch(/^\d{2}:\d{2}$/);
  const [hours, minutes] = label!.split(':').map(Number);
  return hours * 60 + minutes;
}

function observerFor(location = RAANANA): Astronomy.Observer {
  return new Astronomy.Observer(location.latitude, location.longitude, location.elevation);
}

function expectUnitVector(direction: SolarState['direction']) {
  expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 12);
}

describe('resolveLocalDateTime: Jerusalem civil time', () => {
  it.each([
    ['2026-06-21', 180, '2026-06-21T09:00:00.000Z'],
    ['2026-12-21', 120, '2026-12-21T10:00:00.000Z'],
  ])('resolves %s noon with offset %i minutes', (date, offset, utc) => {
    const local = resolveLocalDateTime(date, 720);
    expect(TIME_ZONE).toBe('Asia/Jerusalem');
    expect(local.zoneName).toBe(TIME_ZONE);
    expect(local.offset).toBe(offset);
    expect(local.toUTC().toISO()).toBe(utc);
    expect(local.hour).toBe(12);
    expect(local.minute).toBe(0);
  });

  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Auckland'])('ignores the host/default zone %s', (zone) => {
    Settings.defaultZone = zone;
    Settings.defaultLocale = 'ar-EG';
    const summer = calculateSolar('2026-06-21', 720, RAANANA);
    const winter = calculateSolar('2026-12-21', 720, RAANANA);
    expect(summer.instant.toISOString()).toBe('2026-06-21T09:00:00.000Z');
    expect(winter.instant.toISOString()).toBe('2026-12-21T10:00:00.000Z');
    expect(summer.utcOffset).toBe(180);
    expect(winter.utcOffset).toBe(120);
    expect(summer.localTimeLabel).toBe('12:00');
    expect(summer.localISO).toBe('2026-06-21T12:00:00.000+03:00');
    expect(winter.localISO).toBe('2026-12-21T12:00:00.000+02:00');
    expect(summer.zoneLabel).toContain('UTC+03:00');
    expect(winter.zoneLabel).toContain('UTC+02:00');
  });

  it('accepts both minute boundaries and a real leap day', () => {
    expect(resolveLocalDateTime('2024-02-29', 0).toFormat('yyyy-MM-dd HH:mm')).toBe('2024-02-29 00:00');
    expect(resolveLocalDateTime('2024-02-29', 1439).toFormat('yyyy-MM-dd HH:mm')).toBe('2024-02-29 23:59');
  });

  it.each([
    '', '2026-2-01', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01',
    '2026-01-00', '2026-01-32', '2026-06-21T12:00:00', '2026-06-21Z',
    ' 2026-06-21', '2026-06-21 ', '2026-W25-7', 'not a date',
  ])('rejects invalid or non-date-only input %j', (date) => {
    expect(() => resolveLocalDateTime(date, 720)).toThrow(RangeError);
    expect(() => calculateSolar(date, 720, RAANANA)).toThrow(RangeError);
    expect(() => getSunPath(date, RAANANA)).toThrow(RangeError);
  });

  it.each([-1, 1440, 1.5, Number.NaN, Infinity, -Infinity])('rejects invalid wall-clock minute %s', (minutes) => {
    expect(() => resolveLocalDateTime('2026-06-21', minutes)).toThrow(RangeError);
    expect(() => calculateSolar('2026-06-21', minutes, RAANANA)).toThrow(RangeError);
  });

  it('rejects every spring-forward missing minute, not just one example', () => {
    for (let minutes = 120; minutes < 180; minutes += 1) {
      expect(() => resolveLocalDateTime('2026-03-27', minutes)).toThrow(/DST gap/);
    }
    expect(() => calculateSolar('2026-03-27', 150, RAANANA)).toThrow(/DST gap/);
    const before = resolveLocalDateTime('2026-03-27', 119);
    const after = resolveLocalDateTime('2026-03-27', 180);
    expect(before.offset).toBe(120);
    expect(after.offset).toBe(180);
    expect(after.toMillis() - before.toMillis()).toBe(60_000);
    // Adding 720 elapsed minutes to midnight would incorrectly return 13:00.
    expect(resolveLocalDateTime('2026-03-27', 720).hour).toBe(12);
  });

  it.each(['2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z'])('chooses the earlier fall-back occurrence even when today is %s', (today) => {
    Settings.now = () => Date.parse(today);
    const local = resolveLocalDateTime('2026-10-25', 90);
    expect(local.getPossibleOffsets()).toHaveLength(2);
    expect(local.offset).toBe(180);
    expect(local.toUTC().toISO()).toBe('2026-10-24T22:30:00.000Z');
    expect(resolveLocalDateTime('2026-10-25', 120).offset).toBe(120);
    expect(resolveLocalDateTime('2026-10-25', 720).hour).toBe(12);
  });
});

describe('solarDirection: true-world coordinates', () => {
  it.each([
    ['north', 0, 0, 0, -1],
    ['east', 90, 1, 0, 0],
    ['south', 180, 0, 0, 1],
    ['west', 270, -1, 0, 0],
  ])('points %s along the correct Three.js axis', (_name, azimuth, x, y, z) => {
    const direction = solarDirection(0, azimuth);
    expect(direction.x).toBeCloseTo(x, 12);
    expect(direction.y).toBeCloseTo(y, 12);
    expect(direction.z).toBeCloseTo(z, 12);
    expectUnitVector(direction);
  });

  it('preserves altitude, unit length, and below-horizon directions', () => {
    for (const altitude of [-90, -30, 0, 30, 60, 90]) {
      for (const azimuth of [0, 45, 90, 180, 270, 359]) {
        const direction = solarDirection(altitude, azimuth);
        expectUnitVector(direction);
        expect(direction.y).toBeCloseTo(Math.sin(altitude * Math.PI / 180), 12);
      }
    }
    expect(solarDirection(90, 45).y).toBe(1);
    expect(solarDirection(-90, 45).y).toBe(-1);
    expect(solarDirection(30, 450)).toEqual(solarDirection(30, 90));
    expect(solarDirection(30, -90)).toEqual(solarDirection(30, 270));
  });

  it.each([[91, 0], [-91, 0], [NaN, 0], [0, NaN], [0, Infinity]])('rejects invalid angles (%s, %s)', (altitude, azimuth) => {
    expect(() => solarDirection(altitude, azimuth)).toThrow(RangeError);
  });
});

describe('calculateSolar: physical solar geometry', () => {
  it.each([
    ['2026-12-21', -23.44, 34.4],
    ['2026-06-21', 23.44, 81.3],
    ['2026-03-20', 0, 57.8],
  ])('agrees with analytical seasonal noon altitude on %s', (date, declination, expectedAltitude) => {
    const state = calculateSolar(date, 720, RAANANA);
    const atNoon = calculateSolar(date, minutesFromLabel(state.solarNoon), RAANANA);
    // Independent spherical-geometry oracle: h = 90 - |latitude - declination|.
    // Allow 0.2 degrees for non-exact equinox date, ephemeris effects and HH:mm precision.
    expect(Math.abs(atNoon.altitude - (90 - Math.abs(RAANANA.latitude - declination)))).toBeLessThan(0.2);
    expect(Math.abs(atNoon.altitude - expectedAltitude)).toBeLessThan(0.2);
    expect(Math.abs(atNoon.azimuth - 180)).toBeLessThan(1.6);
    expect(atNoon.direction.y).toBeGreaterThan(0);
    expect(atNoon.direction.z).toBeGreaterThan(0);
    expectUnitVector(atNoon.direction);
  });

  it('uses the exact observer, of-date coordinates, aberration, and separate refraction modes', () => {
    const location = { latitude: 32.1848123, longitude: 34.8713456, elevation: 137.5 };
    const state = calculateSolar('2026-06-21', 345, location);
    const observer = observerFor(location);
    const equatorial = Astronomy.Equator(Astronomy.Body.Sun, state.instant, observer, true, true);
    const geometric = Astronomy.Horizon(state.instant, observer, equatorial.ra, equatorial.dec);
    const apparent = Astronomy.Horizon(state.instant, observer, equatorial.ra, equatorial.dec, 'normal');
    expect(state.altitude).toBeCloseTo(geometric.altitude, 10);
    expect(state.azimuth).toBeCloseTo(geometric.azimuth, 10);
    expect(state.apparentAltitude).toBeCloseTo(apparent.altitude, 10);
    expect(state.apparentAltitude).toBeGreaterThan(state.altitude);
    expect(state.direction).toEqual(solarDirection(state.altitude, state.azimuth));
    expect(state.error).toBeUndefined();
  });

  it('keeps the Sun east in the morning, west in the evening, and below the ground at night', () => {
    const morning = calculateSolar('2026-06-21', 8 * 60, RAANANA);
    const evening = calculateSolar('2026-06-21', 18 * 60, RAANANA);
    const night = calculateSolar('2026-06-21', 0, RAANANA);
    expect(morning.direction.x).toBeGreaterThan(0);
    expect(evening.direction.x).toBeLessThan(0);
    expect(night.altitude).toBeLessThan(0);
    expect(night.direction.y).toBeLessThan(0);
    expect(night.aboveHorizon).toBe(false);
    expect(night.shadowFactor).toBeNull();
  });

  it('uses geometric horizon and geometric shadow length, not apparent visibility', () => {
    // At 05:36 the refracted centre is up, but the geometric centre is still down.
    const nearRise = calculateSolar('2026-06-21', 5 * 60 + 36, RAANANA);
    expect(nearRise.altitude).toBeLessThan(0);
    expect(nearRise.apparentAltitude).toBeGreaterThan(0);
    expect(nearRise.aboveHorizon).toBe(false);
    expect(nearRise.shadowFactor).toBeNull();
    const day = calculateSolar('2026-12-21', 11 * 60 + 39, RAANANA);
    expect(day.aboveHorizon).toBe(true);
    expect(day.shadowFactor).toBeCloseTo(1 / Math.tan(day.altitude * Math.PI / 180), 12);
    expect(10 * day.shadowFactor!).toBeCloseTo(14.6, 1);
  });

  it.each([
    { latitude: 91 }, { latitude: -91 }, { latitude: NaN },
    { longitude: 181 }, { longitude: -181 }, { longitude: Infinity },
    { elevation: NaN }, { elevation: -501 }, { elevation: 100_001 },
  ])('rejects invalid observer values %j', (patch) => {
    const location = { ...RAANANA, ...patch };
    expect(() => calculateSolar('2026-06-21', 720, location)).toThrow(RangeError);
    expect(() => getSunPath('2026-06-21', location)).toThrow(RangeError);
  });

  it('accepts realistic negative elevations such as the Dead Sea', () => {
    const state = calculateSolar('2026-06-21', 720, { latitude: 31.5, longitude: 35.5, elevation: -430 });
    expect(Number.isFinite(state.altitude)).toBe(true);
    expect(state.sunrise).not.toBeNull();
  });
});

describe('daily events: actual Jerusalem civil-day boundaries', () => {
  it.each(['2026-06-21', '2026-12-21', '2026-03-27', '2026-10-25'])('matches precise event searches on %s', (date) => {
    const state = calculateSolar(date, 720, RAANANA);
    const start = resolveLocalDateTime(date, 0);
    const end = start.plus({ days: 1 });
    const limitDays = (end.toMillis() - start.toMillis()) / 86_400_000;
    const observer = observerFor();
    const rise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, 1, start.toJSDate(), limitDays)!;
    const set = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, start.toJSDate(), limitDays)!;
    const noon = Astronomy.SearchHourAngle(Astronomy.Body.Sun, observer, 0, start.toJSDate());
    const format = (instant: Date) => DateTime.fromJSDate(instant, { zone: TIME_ZONE }).toFormat('HH:mm');

    expect(state.sunrise).toBe(format(rise.date));
    expect(state.sunset).toBe(format(set.date));
    expect(state.solarNoon).toBe(format(noon.time.date));
    expect(state.daylightHours).toBeCloseTo((set.date.getTime() - rise.date.getTime()) / 3_600_000, 8);
    expect(minutesFromLabel(state.sunrise)).toBeLessThan(minutesFromLabel(state.solarNoon));
    expect(minutesFromLabel(state.solarNoon)).toBeLessThan(minutesFromLabel(state.sunset));
    expect(Math.abs(noon.hor.azimuth - 180)).toBeLessThan(0.001);
    expect(state.solarNoon).not.toBe('12:00');
    expect(state.daylightHours).toBeGreaterThan(9.9);
    expect(state.daylightHours).toBeLessThan(14.5);
  });

  it('has longer summer daylight without a fabricated fixed solar noon', () => {
    const summer = calculateSolar('2026-06-21', 720, RAANANA);
    const winter = calculateSolar('2026-12-21', 720, RAANANA);
    expect(summer.solarNoon).toBe('12:42');
    expect(winter.solarNoon).toBe('11:38');
    expect(summer.daylightHours - winter.daylightHours).toBeGreaterThan(4);
  });

  it.each([
    ['2026-06-21', 24],
    ['2026-12-21', 0],
    ['2026-03-27', 23],
    ['2026-10-25', 0],
  ])('handles polar daylight without events on %s', (date, hours) => {
    const state = calculateSolar(date, 720, { latitude: 90, longitude: 0, elevation: 0 });
    expect(state.sunrise).toBeNull();
    expect(state.sunset).toBeNull();
    expect(state.daylightHours).toBe(hours);
  });

  it('counts all 25 real hours in a southern polar day on fall-back day', () => {
    const state = calculateSolar('2026-10-25', 720, { latitude: -90, longitude: 0, elevation: 0 });
    expect(state.sunrise).toBeNull();
    expect(state.sunset).toBeNull();
    expect(state.daylightHours).toBe(25);
  });

  it('distinguishes refracted upper-limb polar daylight from a below-horizon centre', () => {
    const state = calculateSolar('2026-03-19', 720, { latitude: 90, longitude: 0, elevation: 0 });
    expect(state.altitude).toBeLessThan(0);
    expect(state.aboveHorizon).toBe(false);
    expect(state.sunrise).toBeNull();
    expect(state.sunset).toBeNull();
    expect(state.daylightHours).toBe(24);
  });

  it('clips daylight crossing midnight and never borrows a next-day transit on a short civil day', () => {
    const location = { latitude: 0, longitude: -139, elevation: 0 };
    const state = calculateSolar('2026-03-27', 720, location);
    const start = resolveLocalDateTime('2026-03-27', 0);
    const end = start.plus({ days: 1 });
    const observer = observerFor(location);
    const rise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, 1, start.toJSDate(), 23 / 24)!;
    const set = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, start.toJSDate(), 23 / 24)!;
    expect(set.date.getTime()).toBeLessThan(rise.date.getTime());
    const litMillis = set.date.getTime() - start.toMillis() + end.toMillis() - rise.date.getTime();
    expect(state.daylightHours).toBeCloseTo(litMillis / 3_600_000, 7);
    expect(state.solarNoon).toBeNull();
  });

  it('includes a second rise when it falls in the 25th civil-day hour', () => {
    // The two rises occur at 00:56 +03:00 and 23:56 +02:00 on this civil date.
    const location = { latitude: 0, longitude: 116, elevation: 0 };
    const date = '2026-10-25';
    const state = calculateSolar(date, 720, location);
    const start = resolveLocalDateTime(date, 0);
    const end = start.plus({ days: 1 });
    const observer = observerFor(location);
    const rise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, 1, start.toJSDate(), 25 / 24)!;
    const set = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, start.toJSDate(), 25 / 24)!;
    const nextRise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, 1, new Date(rise.date.getTime() + 1000), 1.1)!;
    expect(nextRise.date.getTime()).toBeLessThan(end.toMillis());
    const daylightMillis = set.date.getTime() - rise.date.getTime() + end.toMillis() - nextRise.date.getTime();
    expect(state.daylightHours).toBeCloseTo(daylightMillis / 3_600_000, 6);
  });
});

describe('daily-event LRU cache', () => {
  it('avoids repeated searches while the slider changes, without exposing cached mutable state', () => {
    const first = calculateSolar('2031-08-12', 600, RAANANA);
    const calls = vi.mocked(Astronomy.SearchRiseSet).mock.calls.length;
    const transitCalls = vi.mocked(Astronomy.SearchHourAngle).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(transitCalls).toBeGreaterThan(0);
    const expectedRise = first.sunrise;
    first.instant.setTime(0);
    first.direction.x = 999;
    first.sunrise = '00:00';
    const second = calculateSolar('2031-08-12', 601, { ...RAANANA });
    expect(Astronomy.SearchRiseSet).toHaveBeenCalledTimes(calls);
    expect(Astronomy.SearchHourAngle).toHaveBeenCalledTimes(transitCalls);
    expect(second.sunrise).toBe(expectedRise);
    expect(second.instant.getUTCFullYear()).toBe(2031);
    expect(second.direction.x).not.toBe(999);
    expect(second.altitude).not.toBe(first.altitude);
  });

  it('keys by date and all exact location fields, even if the caller mutates the same object', () => {
    const location = { ...RAANANA };
    calculateSolar('2032-08-12', 600, location);
    let calls = vi.mocked(Astronomy.SearchRiseSet).mock.calls.length;
    for (const key of ['latitude', 'longitude', 'elevation'] as const) {
      location[key] += 0.000001;
      calculateSolar('2032-08-12', 601, location);
      expect(vi.mocked(Astronomy.SearchRiseSet).mock.calls.length).toBeGreaterThan(calls);
      calls = vi.mocked(Astronomy.SearchRiseSet).mock.calls.length;
    }
    calculateSolar('2032-08-13', 601, location);
    expect(vi.mocked(Astronomy.SearchRiseSet).mock.calls.length).toBeGreaterThan(calls);
  });

  it('retains only 64 location-days and refreshes recently used entries', () => {
    const firstDay = DateTime.fromISO('2037-01-01', { zone: 'UTC' });
    const date = (index: number) => firstDay.plus({ days: index }).toISODate()!;
    for (let index = 0; index < 64; index += 1) calculateSolar(date(index), 720, RAANANA);
    let calls = vi.mocked(Astronomy.SearchRiseSet).mock.calls.length;
    calculateSolar(date(0), 721, RAANANA); // Promote the oldest entry.
    expect(Astronomy.SearchRiseSet).toHaveBeenCalledTimes(calls);
    calculateSolar(date(64), 720, RAANANA); // Evict day 1, not the promoted day 0.
    calls = vi.mocked(Astronomy.SearchRiseSet).mock.calls.length;
    calculateSolar(date(0), 722, RAANANA);
    expect(Astronomy.SearchRiseSet).toHaveBeenCalledTimes(calls);
    calculateSolar(date(1), 720, RAANANA);
    expect(vi.mocked(Astronomy.SearchRiseSet).mock.calls.length).toBeGreaterThan(calls);
  });
});

describe('getSunPath', () => {
  it('returns ordered, above-geometric-horizon samples consistent with calculateSolar', () => {
    const date = '2026-06-21';
    const path = getSunPath(date, RAANANA);
    expect(path.length).toBeGreaterThan(50);
    expect(path.length).toBeLessThan(65);
    expect(Astronomy.SearchRiseSet).not.toHaveBeenCalled();
    expect(Astronomy.SearchHourAngle).not.toHaveBeenCalled();
    for (const [index, sample] of path.entries()) {
      expect(sample.minutes % 15).toBe(0);
      expect(sample.minutes).toBeGreaterThanOrEqual(0);
      expect(sample.minutes).toBeLessThan(1440);
      if (index > 0) expect(sample.minutes).toBeGreaterThan(path[index - 1].minutes);
      expect(sample.altitude).toBeGreaterThan(0);
      expect(sample.azimuth).toBeGreaterThanOrEqual(0);
      expect(sample.azimuth).toBeLessThan(360);
      expectUnitVector(sample.direction);
      const state = calculateSolar(date, sample.minutes, RAANANA);
      expect(sample.altitude).toBeCloseTo(state.altitude, 10);
      expect(sample.azimuth).toBeCloseTo(state.azimuth, 10);
      expect(sample.direction).toEqual(state.direction);
    }
    expect(Math.max(...path.map(sample => sample.altitude))).toBeGreaterThan(81);
  });

  it('uses a custom step and returns empty for polar night', () => {
    const path = getSunPath('2026-06-21', RAANANA, 7);
    expect(path.length).toBeGreaterThan(100);
    expect(path.every(point => point.minutes % 7 === 0)).toBe(true);
    expect(getSunPath('2026-12-21', { latitude: 90, longitude: 0, elevation: 0 })).toEqual([]);
    expect(getSunPath('2026-06-21', RAANANA, 1440)).toEqual([]);
  });

  it('omits DST-gap samples even where the Sun is up, and uses the earlier fold samples', () => {
    const equatorialEast = { latitude: 0, longitude: 150, elevation: 0 };
    const spring = getSunPath('2026-03-27', equatorialEast, 15);
    expect(spring.some(point => point.minutes === 105)).toBe(true);
    expect(spring.some(point => point.minutes === 180)).toBe(true);
    expect(spring.some(point => point.minutes >= 120 && point.minutes < 180)).toBe(false);
    const fall = getSunPath('2026-10-25', equatorialEast, 15);
    const folded = fall.filter(point => point.minutes === 90);
    expect(folded).toHaveLength(1);
    expect(folded[0].altitude).toBeCloseTo(calculateSolar('2026-10-25', 90, equatorialEast).altitude, 10);
  });

  it('does not retain caller-mutated arrays or vectors', () => {
    const first = getSunPath('2026-06-21', RAANANA, 60);
    first[0].direction.x = 999;
    first.pop();
    const second = getSunPath('2026-06-21', RAANANA, 60);
    expect(second.length).toBe(first.length + 1);
    expect(second[0].direction.x).not.toBe(999);
  });

  it.each([0, -1, 0.5, 1441, NaN, Infinity])('rejects invalid step %s without looping', (step) => {
    expect(() => getSunPath('2026-06-21', RAANANA, step)).toThrow(RangeError);
  });
});