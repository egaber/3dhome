import { Settings } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE_OPENINGS, defaultState, resolvedOpenings, WALLS } from '../model/plans';
import type { OpeningSpec, SimulationState } from '../model/types';
import { loadProject, parseProject, PROJECT_STORAGE_KEY, saveProject, serializeProject } from './project';
import { resolveLocalDateTime } from './solar';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6qKsAAAAASUVORK5CYII=';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwB/gA//2Q==';
const WEBP = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const BASE = BASE_OPENINGS[0];
const originalZone = Settings.defaultZone;
const originalLocale = Settings.defaultLocale;
const originalNow = Settings.now;

afterEach(() => {
  Settings.defaultZone = originalZone;
  Settings.defaultLocale = originalLocale;
  Settings.now = originalNow;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function parse(value: unknown): SimulationState {
  return parseProject(JSON.stringify(value));
}

function added(id = 'added-test'): OpeningSpec {
  const wall = WALLS.find(item => item.id === BASE.wallId)!;
  return {
    id, wallId: wall.id, label: 'חלון נוסף', unit: wall.unit, floor: wall.floor,
    kind: 'window', position: 0.5, width: 1.2, height: 1.35, sill: 0.95,
    open: false, shutter: false, overhang: 0, source: 'added',
  };
}

function completeState(): SimulationState {
  const state = defaultState();
  state.addedOpenings = [added()];
  state.openings[BASE.id] = { ...BASE };
  // Isolate individual numeric limits from the separate roof/height invariant.
  state.neighbors.forEach(neighbor => { neighbor.height = 30; neighbor.roofRise = 0; });
  return state;
}

/** Deliberately construct invalid runtime data without weakening production types. */
function setValue(state: SimulationState, path: string, value: unknown): SimulationState {
  const keys = path.split('.');
  let target = state as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys[keys.length - 1]] = value;
  return state;
}

function expectInvalid(action: () => unknown, field?: string): void {
  let error: unknown;
  try { action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toMatch(/[א-ת]/);
  expect(message).toMatch(/יש |נדרש|מותר|נדרשים/);
  if (field) expect(message).toContain(field);
}

function freezeDeep(value: object): void {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freezeDeep(child);
  }
  Object.freeze(value);
}

function mockStorage(): Storage {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    clear: vi.fn(() => { values.clear(); }),
  };
  vi.stubGlobal('window', { localStorage: storage });
  return storage;
}

describe('version-1 persistence and explicit copies', () => {
  it('round-trips the complete default state as pretty, versioned JSON', () => {
    const state = defaultState();
    const json = serializeProject(state);
    expect(PROJECT_STORAGE_KEY).toBe('dori-solar-studio-v1');
    expect(json).toBe(JSON.stringify(state, null, 2));
    expect(json).toMatch(/^\{\n  "version": 1,/);
    expect(parseProject(json)).toEqual(state);
  });

  it('preserves edited buildings, location, neighbors, views, openings and local image calibration', () => {
    const state = completeState();
    state.date = '2024-02-29';
    state.minutes = 601;
    state.location = { latitude: -33.8688123, longitude: 151.2093456, elevation: -430.25 };
    state.northBearing = -73.25;
    state.buildings.north = {
      enabled: false, width: 17.8, depth: 13.75, x: 14.2, z: -24.6, rotation: 145,
      groundHeight: 5.75, upperHeight: 4.1, basementDepth: 3.75, parapet: 0,
      roofEnabled: false, roofFloorHeight: 2.5, roofPeakHeight: 10.5,
      firstFloorVariant: 'open-plan', storeys: 1,
    };
    state.buildings.south.width = 6.8;
    state.buildings.south.rotation = -125;
    state.neighbors[0] = {
      id: 'west', name: 'השכן שנמדד', enabled: false, x: -76, z: 63, width: 37,
      depth: 42, height: 15, roofRise: 7, rotation: -170,
    };
    state.neighbors.reverse();
    state.view = {
      mode: 'walk', cutaway: 'first', planVisible: false, planOpacity: 0, planFloor: 'basement',
      grid: true, labels: true, path: false, dimensions: false, directOnly: true, quality: 'standard',
      eyeHeight: .75, isolateFloor: 'ground',
    };
    state.reference = { image: PNG, width: 123, depth: 117.5, x: -57, z: 41, rotation: 112, opacity: 0, visible: true };
    state.openings[BASE.id] = { width: 0, height: 0, open: false, shutter: true, label: 'פתח שהוסר' };
    state.addedOpenings[0].kind = 'door';
    state.addedOpenings[0].open = true;
    state.openings['added-test'] = { width: 2.7, height: 2.6, sill: 0, overhang: 1.8, position: 0.23 };
    expect(parseProject(serializeProject(state))).toEqual(state);
  });

  it('merges defaults only for absent fields, including older version-1 files without location', () => {
    expect(parse({ version: 1 })).toEqual(defaultState());
    const state = parse({
      version: 1, buildings: { north: { enabled: false, width: 7.5 } },
      view: { grid: true, planOpacity: 0 }, reference: { visible: false, image: null },
    });
    const expected = defaultState();
    expected.buildings.north.enabled = false;
    expected.buildings.north.width = 7.5;
    expected.view.grid = true;
    expected.view.planOpacity = 0;
    expect(state).toEqual(expected);
    expect(parse({ version: 1, location: { elevation: 0 } }).location)
      .toEqual({ ...defaultState().location, elevation: 0 });
  });

  it('merges reordered neighbor records by ID, not array position', () => {
    const state = parse({ version: 1, neighbors: [{ id: 'east', name: 'מזרח' }, { id: 'west' }] });
    const defaults = defaultState();
    expect(state.neighbors).toEqual([
      { ...defaults.neighbors[1], name: 'מזרח' }, defaults.neighbors[0],
    ]);
  });

  it('does not mutate frozen inputs, retain nested references, or modify the source plan', () => {
    const state = completeState();
    const before = structuredClone(state);
    const sourceBefore = structuredClone(BASE_OPENINGS);
    freezeDeep(state);
    const json = serializeProject(state);
    const first = parseProject(json);
    const second = parseProject(json);
    expect(first).toEqual(before);
    expect(first.location).not.toBe(state.location);
    expect(first.buildings.north).not.toBe(state.buildings.north);
    expect(first.buildings.north).not.toBe(first.buildings.south);
    expect(first.neighbors[0]).not.toBe(state.neighbors[0]);
    expect(first.view).not.toBe(state.view);
    expect(first.reference).not.toBe(state.reference);
    expect(first.openings[BASE.id]).not.toBe(state.openings[BASE.id]);
    expect(first.addedOpenings[0]).not.toBe(state.addedOpenings[0]);
    first.location.latitude = 0;
    first.buildings.north.width = 9;
    first.neighbors[0].name = 'שינוי';
    first.openings[BASE.id].width = 0;
    first.addedOpenings[0].height = 0;
    expect(second).toEqual(before);
    expect(state).toEqual(before);
    expect(BASE_OPENINGS).toEqual(sourceBefore);
    const minimal = parse({ version: 1 });
    minimal.buildings.south.depth = 7;
    expect(parse({ version: 1 })).toEqual(defaultState());
  });

  it.each([null, [], 'state', 42, true, {}, { version: 0 }, { version: 2 }, { version: '1' }, { version: null }])
  ('rejects an invalid root or version: %j', value => expectInvalid(() => parse(value)));

  it.each(['', '{', '[', '{"version":1,}', '{"version":1} trailing', '{"minutes":NaN}', '{"version":Infinity}'])
  ('reports malformed JSON in actionable Hebrew: %j', json => expectInvalid(() => parseProject(json), 'JSON'));

  it('bounds input size before parsing or retaining massive extras', () => {
    expectInvalid(() => parseProject(' '.repeat(8_000_001)), 'JSON');
    expectInvalid(() => parse({ version: 1, extra: 'x'.repeat(100_000) }), 'extra');
  });

  it.each(['location', 'buildings', 'buildings.north', 'buildings.south', 'view', 'reference', 'openings', 'addedOpenings', 'neighbors'])
  ('does not treat malformed %s containers as missing defaults', path => {
    for (const value of [null, 0, 'data', false]) {
      expectInvalid(() => parse(setValue(defaultState(), path, value)), path);
    }
    const wrongContainer = path === 'neighbors' || path === 'addedOpenings' ? {} : [];
    expectInvalid(() => parse(setValue(defaultState(), path, wrongContainer)), path);
    expectInvalid(() => serializeProject(setValue(defaultState(), path, undefined)), path);
  });

  it.each([
    'extra', 'location.extra', 'buildings.extra', 'buildings.north.extra', 'buildings.south.extra',
    'neighbors.0.extra', 'view.extra', 'reference.extra', `openings.${BASE.id}.extra`, 'addedOpenings.0.extra',
  ])('rejects unknown fields rather than copying them: %s', path => {
    expectInvalid(() => parse(setValue(completeState(), path, { nested: 'ignored data must not survive' })), 'extra');
  });
});

describe('Jerusalem civil dates, without host-time-zone dependence', () => {
  it.each([
    'not a date', '', '2026-2-01', '2026-02-29', '1900-02-29', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '0000-01-01',
    '10000-01-01', '2026-06-21T12:00:00Z', '2026-W25-7', '2026-06-21Z',
    ' 2026-06-21', '2026-06-21 ', '2026-06-21\n', null, 20260621,
  ])('rejects invalid or normalized dates: %j', date => {
    expectInvalid(() => parse({ version: 1, date }), 'date');
  });

  it.each(['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])('accepts the valid calendar date %s', date => {
    const state = parse({ version: 1, date });
    expect(state.date).toBe(date);
    expect(parseProject(serializeProject(state))).toEqual(state);
  });

  it.each([-1, 1440, 1.5, '720', null, true, NaN, Infinity, -Infinity])('rejects invalid minutes %j', minutes => {
    expectInvalid(() => parse({ version: 1, minutes }), 'minutes');
    expectInvalid(() => serializeProject(setValue(defaultState(), 'minutes', minutes)), 'minutes');
  });

  it('preserves midnight and the last minute, without wrapping to another date', () => {
    for (const minutes of [0, 1439]) {
      const state = parse({ version: 1, date: '2024-02-29', minutes });
      expect(state.date).toBe('2024-02-29');
      expect(state.minutes).toBe(minutes);
    }
  });

  it('rejects every nonexistent minute during Jerusalem spring-forward instead of normalizing', () => {
    for (let minutes = 120; minutes < 180; minutes += 1) {
      expectInvalid(() => parse({ version: 1, date: '2026-03-27', minutes }), 'date/minutes');
    }
    for (const minutes of [119, 180, 720]) {
      expect(parse({ version: 1, date: '2026-03-27', minutes }).minutes).toBe(minutes);
    }
  });

  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Auckland'])('ignores host and Luxon default zone %s', zone => {
    vi.stubEnv('TZ', zone);
    Settings.defaultZone = zone;
    Settings.defaultLocale = 'ar-EG';
    for (const now of ['2026-01-01T00:00:00Z', '2026-07-01T00:00:00Z']) {
      Settings.now = () => Date.parse(now);
      for (const [date, minutes, utc] of [
        ['2026-06-21', 720, '2026-06-21T09:00:00.000Z'],
        ['2026-12-21', 720, '2026-12-21T10:00:00.000Z'],
        ['2026-10-25', 90, '2026-10-24T22:30:00.000Z'],
      ] as const) {
        const state = parse({ version: 1, date, minutes });
        expect(parseProject(serializeProject(state))).toEqual(state);
        expect(resolveLocalDateTime(state.date, state.minutes).toUTC().toISO()).toBe(utc);
      }
      expectInvalid(() => parse({ version: 1, date: '2026-03-27', minutes: 150 }), 'date/minutes');
    }
  });
});

const BOUNDS: [string, number, number][] = [
  ['northBearing', -180, 180],
  ['location.latitude', -89, 89], ['location.longitude', -180, 180], ['location.elevation', -450, 4000],
  ['view.planOpacity', 0, 1],
  ['reference.width', 10, 150], ['reference.depth', 10, 150], ['reference.x', -60, 60],
  ['reference.z', -60, 60], ['reference.rotation', -180, 180], ['reference.opacity', 0, 1],
];
for (const unit of ['north', 'south']) {
  for (const [field, min, max] of [
    ['width', 5, 18], ['depth', 3, 20], ['x', -60, 60], ['z', -60, 60], ['rotation', -180, 180],
    ['groundHeight', 2.3, 6], ['upperHeight', 2.3, 6], ['basementDepth', 1, 6], ['parapet', 0, 3],
  ] as const) BOUNDS.push([`buildings.${unit}.${field}`, min, max]);
}
for (const index of [0, 1]) {
  for (const [field, min, max] of [
    ['x', -80, 80], ['z', -80, 80], ['width', 1, 45], ['depth', 1, 45],
    ['height', 1, 30], ['roofRise', 0, 10], ['rotation', -180, 180],
  ] as const) BOUNDS.push([`neighbors.${index}.${field}`, min, max]);
}
for (const path of [`openings.${BASE.id}`, 'addedOpenings.0']) {
  for (const [field, min, max] of [
    ['position', 0, 1], ['width', 0, 45], ['height', 0, 6], ['sill', 0, 6], ['overhang', 0, 3],
  ] as const) BOUNDS.push([`${path}.${field}`, min, max]);
}

describe('bounded numbers, booleans, strings and enums before geometry', () => {
  it.each(BOUNDS)('%s accepts inclusive bounds [%s, %s] without clamping', (path, min, max) => {
    for (const value of [min, max]) {
      const state = setValue(completeState(), path, value);
      expect(parseProject(serializeProject(state))).toEqual(state);
    }
    for (const value of [min - 0.001, max + 0.001, Number.MAX_VALUE, String(min), null, false, {}, []]) {
      expectInvalid(() => parse(setValue(completeState(), path, value)), path.split('.').at(-1));
    }
    for (const value of [NaN, Infinity, -Infinity, undefined]) {
      expectInvalid(() => serializeProject(setValue(completeState(), path, value)), path.split('.').at(-1));
    }
  });

  it('rejects JSON numeric overflow and string NaN instead of sending them to geometry', () => {
    expectInvalid(() => parseProject('{"version":1,"buildings":{"north":{"width":1e999}}}'), 'width');
    expectInvalid(() => parseProject('{"version":1,"location":{"latitude":-1e999}}'), 'latitude');
    expectInvalid(() => parse({ version: 1, location: { elevation: 'NaN' } }), 'elevation');
  });

  it.each([
    'buildings.north.enabled', 'buildings.south.enabled', 'neighbors.0.enabled', 'neighbors.1.enabled',
    'view.planVisible', 'view.grid', 'view.labels', 'view.path', 'view.dimensions', 'view.directOnly',
    'reference.visible', `openings.${BASE.id}.open`, `openings.${BASE.id}.shutter`,
    'addedOpenings.0.open', 'addedOpenings.0.shutter',
  ])('requires actual booleans for %s', path => {
    for (const value of [false, true]) {
      const state = setValue(completeState(), path, value);
      expect(parseProject(serializeProject(state))).toEqual(state);
    }
    for (const value of [0, 1, 'false', 'true', null, {}]) {
      expectInvalid(() => parse(setValue(completeState(), path, value)), path.split('.').at(-1));
    }
  });

  it.each([
    ['view.mode', ['orbit', 'plan', 'walk']],
    ['view.cutaway', ['none', 'basement', 'ground', 'first']],
    ['view.planFloor', ['basement', 'ground', 'first']],
    ['view.quality', ['standard', 'high']],
    [`openings.${BASE.id}.kind`, ['window', 'glazing', 'door', 'void']],
    ['addedOpenings.0.kind', ['window', 'glazing', 'door', 'void']],
    ['buildings.north.storeys', [1, 2]], ['buildings.south.storeys', [1, 2]],
  ] satisfies [string, (string | number)[]][])('checks every allowed enum value for %s', (path, options) => {
    for (const value of options) {
      const state = setValue(completeState(), path, value);
      expect(parseProject(serializeProject(state))).toEqual(state);
    }
    for (const value of ['unknown', '1', 3, 1.5, null, true]) {
      expectInvalid(() => parse(setValue(completeState(), path, value)), path.split('.').at(-1));
    }
  });

  it.each(['neighbors.0.name', 'neighbors.1.name', `openings.${BASE.id}.label`, 'addedOpenings.0.label'])
  ('bounds %s text but preserves Hebrew and inert literal characters', path => {
    for (const value of ['', 'דלת א׳ · <חלון> "מדידה"', 'א'.repeat(200)]) {
      const state = setValue(completeState(), path, value);
      expect(parseProject(serializeProject(state))).toEqual(state);
    }
    for (const value of ['א'.repeat(201), null, 5, {}, []]) {
      expectInvalid(() => parse(setValue(completeState(), path, value)), path.split('.').at(-1));
    }
  });

  it('validates disabled units, neighbors, invisible references, and zero-sized openings too', () => {
    const state = completeState();
    state.buildings.north.enabled = false;
    state.neighbors[0].enabled = false;
    state.reference.visible = false;
    state.openings[BASE.id].width = 0;
    state.addedOpenings[0].height = 0;
    for (const path of ['buildings.north.width', 'neighbors.0.height', 'reference.width', `openings.${BASE.id}.sill`, 'addedOpenings.0.width']) {
      expectInvalid(() => parse(setValue(structuredClone(state), path, -1)), path.split('.').at(-1));
    }
  });
});

describe('neighbor identity and roof/height consistency', () => {
  it.each([
    [[]], [[{ id: 'west' }]], [[{ id: 'west' }, { id: 'west' }]],
    [[{ id: 'east' }, { id: 'east' }]], [[{ id: 'west' }, { id: 'north' }]],
    [[{}, { id: 'east' }]], [[null, { id: 'east' }]],
    [[{ id: 'west' }, { id: 'east' }, { id: 'west' }]],
  ])('requires exactly west and east, with neither duplicates nor omissions: %j', neighbors => {
    expectInvalid(() => parse({ version: 1, neighbors }), 'neighbors');
  });

  it('preserves the Inspector roof limit while leaving scene eave clipping to geometry', () => {
    const state = defaultState();
    state.neighbors[0].height = 3;
    state.neighbors[0].roofRise = 2.9;
    expect(parseProject(serializeProject(state))).toEqual(state);
    for (const roofRise of [2.901, 3, 4]) {
      expectInvalid(() => parse(setValue(structuredClone(state), 'neighbors.0.roofRise', roofRise)), 'roofRise');
    }
    state.neighbors[0].height = 1;
    state.neighbors[0].roofRise = 0.9;
    expect(parseProject(serializeProject(state))).toEqual(state);
  });
});

describe('opening IDs, canonical associations and disabled edits', () => {
  it('accepts partial overrides for every canonical source opening', () => {
    const state = defaultState();
    for (const base of BASE_OPENINGS) state.openings[base.id] = { shutter: true, width: 0 };
    const restored = parseProject(serializeProject(state));
    expect(restored).toEqual(state);
    expect(resolvedOpenings(restored).every(opening => opening.width === 0)).toBe(true);
  });

  it('preserves empty overrides, matching immutable fields and world-sized added openings', () => {
    const state = completeState();
    state.openings[state.addedOpenings[0].id] = { ...state.addedOpenings[0], width: 0, height: 0 };
    state.openings[BASE_OPENINGS[1].id] = {};
    state.buildings.north.width = 18;
    const restored = parseProject(serializeProject(state));
    expect(restored).toEqual(state);
    expect(resolvedOpenings(restored).find(opening => opening.id === 'added-test'))
      .toMatchObject({ width: 0, height: 0, source: 'added' });
  });

  it.each(Object.keys(added()))('requires added-opening field %s instead of inventing it', key => {
    const opening = added() as unknown as Record<string, unknown>;
    delete opening[key];
    expectInvalid(() => parse({ version: 1, addedOpenings: [opening] }), key);
  });

  it.each(['not-a-window', 'toString', 'valueOf', 'hasOwnProperty', 'added-missing'])
  ('rejects nonexistent override ID %s, including inherited object names', id => {
    expectInvalid(() => parse({ version: 1, openings: { [id]: { width: 1 } } }), id);
  });

  it.each([
    '', '__proto__', 'constructor', 'prototype', '../escape', 'a.b', 'a/b', 'a b',
    'a\n', 'a\r', 'a\t', 'פתח', '-leading', '_leading', 'a'.repeat(151), null, 1,
  ])('rejects unsafe, oversized or malformed added ID %j', id => {
    const state = setValue(completeState(), 'addedOpenings.0.id', id);
    expectInvalid(() => parse(state), 'id');
  });

  it.each(['a', '0', 'added-1234_UUID', 'a'.repeat(150), 'toString'])('accepts the safe unique ID %s', id => {
    const state = defaultState();
    state.addedOpenings = [added(id)];
    state.openings[id] = { width: 0 };
    expect(parseProject(serializeProject(state))).toEqual(state);
  });

  it.each([
    ['wallId', 'nonexistent-wall'], ['wallId', BASE.wallId.replace(/-(north|south)$/, '')],
    ['unit', BASE.unit === 'north' ? 'south' : 'north'],
    ['floor', BASE.floor === 'first' ? 'ground' : 'first'], ['source', 'plan'],
  ])('rejects mismatched added-opening %s = %s', (field, value) => {
    expectInvalid(() => parse(setValue(completeState(), `addedOpenings.0.${field}`, value)), field);
  });

  it.each([
    ['id', 'different-id'], ['wallId', WALLS.find(wall => wall.id !== BASE.wallId)!.id],
    ['unit', BASE.unit === 'north' ? 'south' : 'north'],
    ['floor', BASE.floor === 'first' ? 'ground' : 'first'], ['source', 'added'],
  ])('rejects reassignment of immutable override %s', (field, value) => {
    expectInvalid(() => parse(setValue(completeState(), `openings.${BASE.id}.${field}`, value)), field);
  });

  it('rejects duplicate added IDs and collisions with canonical plan IDs', () => {
    expectInvalid(() => parse({ version: 1, addedOpenings: [added(), added()] }), 'id');
    expectInvalid(() => parse({ version: 1, addedOpenings: [added(BASE.id)] }), 'id');
  });

  it('accepts 200 distinct added records and rejects the 201st before geometry', () => {
    const state = defaultState();
    state.addedOpenings = Array.from({ length: 200 }, (_, index) => added(`added-${index}`));
    for (const opening of state.addedOpenings) state.openings[opening.id] = { width: 0 };
    expect(parseProject(serializeProject(state))).toEqual(state);
    state.addedOpenings.push(added('added-200'));
    expectInvalid(() => parse(state), 'addedOpenings');
  });
});

describe('prototype-pollution and executable-object rejection', () => {
  it.each([
    '{"version":1,"__proto__":{"polluted":true}}',
    '{"version":1,"constructor":{"prototype":{"polluted":true}}}',
    '{"version":1,"prototype":{"polluted":true}}',
    '{"version":1,"buildings":{"north":{"__proto__":{"polluted":true}}}}',
    '{"version":1,"location":{"constructor":{"prototype":{"polluted":true}}}}',
    '{"version":1,"view":{"prototype":{"polluted":true}}}',
    '{"version":1,"reference":{"__proto__":{"image":"https://example.com/image.png"}}}',
    '{"version":1,"openings":{"__proto__":{"width":5}}}',
    '{"version":1,"openings":{"constructor":{"prototype":{"polluted":true}}}}',
    `{ "version":1,"openings":{${JSON.stringify(BASE.id)}:{"__proto__":{"width":5}}}}`,
    '{"version":1,"neighbors":[{"id":"west","__proto__":{"height":5}},{"id":"east"}]}',
    '{"version":1,"addedOpenings":[{"__proto__":{"polluted":true}}]}',
    '{"version":1,"__pr\\u006fto__":{"polluted":true}}',
  ])('rejects dangerous JSON keys without touching Object.prototype: %s', json => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    expectInvalid(() => parseProject(json));
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('rejects custom prototypes on live state instead of copying inherited values', () => {
    const state = defaultState();
    Object.setPrototypeOf(state.buildings.north, { width: 999, polluted: true });
    expectInvalid(() => serializeProject(state), 'buildings.north');
  });

  it('never invokes getters or toJSON during serialization', () => {
    const getter = vi.fn(() => 12);
    const state = defaultState();
    Object.defineProperty(state.buildings.north, 'width', { get: getter, enumerable: true });
    expectInvalid(() => serializeProject(state), 'width');
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => defaultState());
    const other = defaultState();
    Object.defineProperty(other, 'toJSON', { value: toJSON });
    expectInvalid(() => serializeProject(other), 'toJSON');
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('rejects symbol keys, sparse lists and extra array properties rather than silently dropping them', () => {
    const symbolic = defaultState();
    Object.defineProperty(symbolic.reference, Symbol('hidden'), { value: true });
    expectInvalid(() => serializeProject(symbolic), 'reference');
    expectInvalid(() => serializeProject(setValue(defaultState(), 'neighbors', Array(2))), 'neighbors');
    const extra = defaultState();
    Object.defineProperty(extra.addedOpenings, 'hidden', { value: 'extra' });
    expectInvalid(() => serializeProject(extra), 'addedOpenings');
  });

  it('copies null-prototype data into independent ordinary records', () => {
    const state = defaultState();
    Object.setPrototypeOf(state.openings, null);
    Object.setPrototypeOf(state.location, null);
    const restored = parseProject(serializeProject(state));
    expect(restored).toEqual(state);
    expect(Object.getPrototypeOf(restored.openings)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(restored.location)).toBe(Object.prototype);
  });
});

describe('local reference image validation', () => {
  it.each([PNG, JPEG, WEBP])('preserves a local raster data URL exactly', image => {
    const state = defaultState();
    state.reference.image = image;
    state.reference.visible = true;
    expect(parseProject(serializeProject(state))).toEqual(state);
  });

  it.each([
    '', 'https://example.com/a.png', 'http://example.com/a.jpg', '//example.com/a.webp',
    'file:///C:/image.png', 'blob:https://example.com/image', '/local.png', 'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/svg+xml,<svg></svg>',
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///w==',
    'data:text/html;base64,PGh0bWw+PC9odG1sPg==', 'data:image/png;utf8,hello',
    'data:image/png;charset=utf-8;base64,aGVsbG8=', 'data:image/png;base64,',
    'data:image/png;base64,!!!!', 'data:image/png;base64,iVBORw0KGgo===',
    'data:image/png;base64,iVBORw0KGgo\n', // Unpadded input plus newline must not pass a $ anchor.
    'data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,PHN2Zz48L3N2Zz4=',
    'data:image/webp;base64,iVBORw0KGgo=', PNG.replace('image/png', 'image/jpeg'),
    PNG.replace('base64,', 'base64, '), PNG + ' trailing', {}, true, 123,
  ])('rejects remote, SVG, malformed, or MIME-mismatched image data: %j', image => {
    expectInvalid(() => parse({ version: 1, reference: { image, visible: false } }), 'reference.image');
  });

  it('allows null to remove an image but does not silently discard a provided invalid URL', () => {
    expect(parse({ version: 1, reference: { image: null } }).reference.image).toBeNull();
    expectInvalid(() => serializeProject(setValue(defaultState(), 'reference.image', undefined)), 'reference.image');
  });

  it('retains large allowed raster data and rejects images over six million characters', () => {
    const header = 'data:image/png;base64,';
    const prefix = PNG.slice(header.length).replace(/=+$/, '');
    const payloadLength = Math.floor((6_000_000 - header.length) / 4) * 4;
    const image = header + prefix + 'A'.repeat(payloadLength - prefix.length);
    const state = defaultState();
    state.reference.image = image;
    expect(image.length).toBeLessThanOrEqual(6_000_000);
    expect(image.length).toBeGreaterThan(5_999_995);
    expect(parseProject(serializeProject(state)).reference.image).toBe(image);
    const oversized = image + 'A'.repeat(6_000_001 - image.length);
    expectInvalid(() => parse({ version: 1, reference: { image: oversized } }), 'reference.image');
    expectInvalid(() => serializeProject(setValue(state, 'reference.image', oversized)), 'reference.image');
  });
});

describe('guarded localStorage stash in the Node test environment', () => {
  it('is safe during SSR even when a global localStorage happens to exist', () => {
    const storage = mockStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', undefined);
    expect(loadProject()).toBeNull();
    expect(saveProject(defaultState())).toBe(false);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('creates, reads, updates and observes removal using only the public storage key', () => {
    const storage = mockStorage();
    expect(loadProject()).toBeNull();
    const original = defaultState();
    expect(saveProject(original)).toBe(true);
    expect(storage.setItem).toHaveBeenLastCalledWith(PROJECT_STORAGE_KEY, serializeProject(original));
    expect(loadProject()).toEqual(original);
    const edit = completeState();
    edit.location = { latitude: 31.5, longitude: 35.5, elevation: -430 };
    edit.reference.image = WEBP;
    expect(saveProject(edit)).toBe(true);
    expect(loadProject()).toEqual(edit);
    const loaded = loadProject()!;
    loaded.buildings.north.width = 5;
    expect(loadProject()).toEqual(edit);
    expect(storage.length).toBe(1);
    storage.removeItem(PROJECT_STORAGE_KEY);
    expect(loadProject()).toBeNull();
    expect(storage.getItem).toHaveBeenLastCalledWith(PROJECT_STORAGE_KEY);
  });

  it.each([
    '', '{', 'null', '{"version":2}', '{"version":1,"minutes":1440}',
    '{"version":1,"date":"2026-03-27","minutes":150}',
    '{"version":1,"reference":{"image":"https://example.com/image.png"}}',
    '{"version":1,"__proto__":{"polluted":true}}',
  ])('returns null for corrupt saved data without deleting or overwriting it: %j', json => {
    const storage = mockStorage();
    storage.setItem(PROJECT_STORAGE_KEY, json);
    vi.mocked(storage.setItem).mockClear();
    expect(loadProject()).toBeNull();
    expect(storage.getItem(PROJECT_STORAGE_KEY)).toBe(json);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('catches storage access denial, absent storage and failed reads', () => {
    const blocked = Object.defineProperty({}, 'localStorage', {
      get() { throw new DOMException('Denied', 'SecurityError'); },
    });
    vi.stubGlobal('window', blocked);
    expect(loadProject()).toBeNull();
    expect(saveProject(defaultState())).toBe(false);
    vi.stubGlobal('window', {});
    expect(loadProject()).toBeNull();
    expect(saveProject(defaultState())).toBe(false);
    const storage = mockStorage();
    vi.mocked(storage.getItem).mockImplementation(() => { throw new Error('Storage unavailable'); });
    expect(loadProject()).toBeNull();
  });

  it('returns false for a quota failure and preserves the previous complete project', () => {
    const storage = mockStorage();
    const original = defaultState();
    expect(saveProject(original)).toBe(true);
    const edit = completeState();
    edit.reference.image = PNG;
    vi.mocked(storage.setItem).mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(saveProject(edit)).toBe(false);
    expect(loadProject()).toEqual(original);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(saveProject(edit)).toBe(true);
    expect(loadProject()).toEqual(edit);
  });

  it('never overwrites valid storage with invalid runtime state or lossy NaN/null JSON', () => {
    const storage = mockStorage();
    const original = defaultState();
    expect(saveProject(original)).toBe(true);
    vi.mocked(storage.setItem).mockClear();
    expect(saveProject(setValue(defaultState(), 'buildings.north.width', NaN))).toBe(false);
    expect(saveProject(setValue(defaultState(), 'reference.image', 'https://example.com/image.png'))).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(loadProject()).toEqual(original);
  });
});