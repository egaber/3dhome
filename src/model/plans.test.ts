import { describe, expect, it } from 'vitest';
import traced from '../assets/traced-walls.json';
import { solarDirection } from '../lib/solar';
import {
  BASE_DEPTH, BASE_OPENINGS, BASE_WIDTH, FOOTPRINTS, PARTY_Z, PDF_ORIGIN, PDF_SCALE,
  PLAN_IMAGES, WALLS, areaOf, buildingArea, defaultState, floorElevation,
  planPoint, resolvedOpenings, trueWorldPoint, wallScale,
} from './plans';
import type { FloorId, OpeningSpec, PlanWall, UnitId, Vec2 } from './types';

const FLOORS: FloorId[] = ['ground', 'first', 'basement'];
const UNITS: UnitId[] = ['north', 'south'];
const WALL_BY_ID = new Map(WALLS.map(wall => [wall.id, wall] as const));

function expectPoint(actual: Vec2, expected: readonly number[], precision = 10): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function added(base: OpeningSpec): OpeningSpec {
  return { ...base, id: 'added-test', source: 'added', label: 'חלון נוסף', width: 1.2 };
}

describe('measured plan scale and source registration', () => {
  it('uses the printed 11.45 m clear dimension, not the outside wall or upper-floor width', () => {
    // Independent measured PDF endpoints used by the local extraction script.
    const leftInnerFace = 1880.109375;
    const rightInnerFace = 2205.09814453125;
    expect((rightInnerFace - leftInnerFace) / PDF_SCALE).toBeCloseTo(11.45, 10);
    expect(PDF_SCALE).toBeCloseTo(28.38329864901747, 10);
    expect(BASE_WIDTH).toBeCloseTo(11.89, 10);
    expect(BASE_WIDTH - 2 * 0.22).toBeCloseTo(11.45, 10);
    expect((leftInnerFace - PDF_ORIGIN[0]) / PDF_SCALE).toBeCloseTo(0.22, 4);
    expect((rightInnerFace - PDF_ORIGIN[0]) / PDF_SCALE).toBeCloseTo(11.67, 4);
    for (const unit of UNITS) {
      expect(Math.max(...FOOTPRINTS.ground[unit].map(point => point[0]))).toBe(11.89);
      expect(Math.max(...FOOTPRINTS.first[unit].map(point => point[0]))).toBe(12.39);
    }
  });

  it.each(FLOORS)('registers the separate %s PDF crop to the same model coordinates', floor => {
    const image = PLAN_IMAGES[floor];
    const [left, top, right, bottom] = image.crop;
    const [originX, originZ] = traced.levels[floor].origin;
    expect(image.origin).toEqual([originX, originZ]);
    expect(originX).toBeGreaterThan(left);
    expect(originX).toBeLessThan(right);
    expect(originZ).toBeGreaterThan(top);
    expect(originZ).toBeLessThan(bottom);
    const width = (right - left) / PDF_SCALE;
    const depth = (bottom - top) / PDF_SCALE;
    const center: Vec2 = [((right + left) / 2 - originX) / PDF_SCALE, ((bottom + top) / 2 - originZ) / PDF_SCALE];
    for (const unit of UNITS) {
      for (const vertex of FOOTPRINTS[floor][unit]) {
        const pdf: Vec2 = [image.origin[0] + vertex[0] * PDF_SCALE, image.origin[1] + vertex[1] * PDF_SCALE];
        const uv: Vec2 = [(pdf[0] - left) / (right - left), (pdf[1] - top) / (bottom - top)];
        // A cropped reference plane must not acquire a different per-floor x/z anchor.
        expectPoint([center[0] + (uv[0] - 0.5) * width, center[1] + (uv[1] - 0.5) * depth], vertex);
        expectPoint(planPoint(vertex, unit, defaultState()), vertex);
      }
    }
  });

  it('retains distinct per-floor source images and the measured ground PDF origin', () => {
    expect(PLAN_IMAGES.ground.origin).toEqual(PDF_ORIGIN);
    expect(new Set(FLOORS.map(floor => PLAN_IMAGES[floor].url)).size).toBe(3);
    expect(new Set(FLOORS.map(floor => PLAN_IMAGES[floor].origin[0])).size).toBe(3);
  });

  it('contains the three 3.20 m source glazing openings on the north ground facade', () => {
    const wall = WALL_BY_ID.get('ground-wall-0-north')!;
    expect(wall).toBeDefined();
    expect(wall.sourceId).toBe('ground-wall-0');
    expect(wall.openings).toHaveLength(3);
    const sourceCenters = [2.87, 6.37001, 9.87001];
    for (const [index, opening] of wall.openings.entries()) {
      expect(opening).toMatchObject({
        id: `ground-wall-0-north-opening-${index}`, wallId: wall.id,
        source: 'plan', kind: 'glazing', unit: 'north', floor: 'ground', width: 3.2,
      });
      expect(opening.position * distance(wall.a, wall.b)).toBeCloseTo(sourceCenters[index], 8);
      expect(BASE_OPENINGS).toContain(opening);
    }
  });
});

describe('canonical plan walls, openings and floor elevations', () => {
  it('uses globally unique wall and opening IDs with canonical wall/unit/floor associations', () => {
    expect(WALLS.length).toBeGreaterThan(0);
    expect(BASE_OPENINGS.length).toBeGreaterThan(0);
    expect(new Set(WALLS.map(wall => wall.id)).size).toBe(WALLS.length);
    expect(new Set(BASE_OPENINGS.map(opening => opening.id)).size).toBe(BASE_OPENINGS.length);
    const allFromWalls = WALLS.flatMap(wall => wall.openings);
    expect(BASE_OPENINGS).toEqual(allFromWalls);
    for (const wall of WALLS) {
      expect(Number.isFinite(distance(wall.a, wall.b))).toBe(true);
      expect(distance(wall.a, wall.b)).toBeGreaterThan(0);
      expect(wall.thickness).toBeGreaterThan(0);
      for (const opening of wall.openings) {
        expect(opening.wallId).toBe(wall.id);
        expect(opening.unit).toBe(wall.unit);
        expect(opening.floor).toBe(wall.floor);
        expect(opening.source).toBe('plan');
        expect(Number.isFinite(opening.position)).toBe(true);
        expect(opening.width).toBeGreaterThan(0);
      }
    }
  });

  it('splits a ground wall at the shared party line without losing or duplicating its length', () => {
    const original = traced.levels.ground.walls.find(wall => wall.id === 'ground-wall-1')!;
    const north = WALL_BY_ID.get('ground-wall-1-north')!;
    const south = WALL_BY_ID.get('ground-wall-1-south')!;
    expect(north.a).toEqual(original.a);
    expect(south.b).toEqual(original.b);
    expect(north.b).toEqual(south.a);
    expect(north.b[1]).toBe(PARTY_Z);
    expect(distance(north.a, north.b) + distance(south.a, south.b))
      .toBeCloseTo(Math.hypot(original.b[0] - original.a[0], original.b[1] - original.a[1]), 10);
    const partyWalls = WALLS.filter(wall => wall.sourceId === 'ground-wall-3');
    expect(new Set(partyWalls.map(wall => wall.unit))).toEqual(new Set(UNITS));
    expect(partyWalls).toHaveLength(2);
    expect(partyWalls[0].a).toEqual(partyWalls[1].a);
    expect(partyWalls[0].b).toEqual(partyWalls[1].b);
    expect(partyWalls[0].id).not.toBe(partyWalls[1].id);
  });

  it.each(UNITS)('starts %s at ground 0, first +3.40 m, and basement -2.95 m', unit => {
    const state = defaultState();
    const building = state.buildings[unit];
    expect(building.enabled).toBe(true);
    expect(building.storeys).toBe(2);
    expect(building.width).toBe(BASE_WIDTH);
    expect(building.depth).toBe(BASE_DEPTH[unit]);
    expect(floorElevation('ground', building)).toBe(0);
    expect(floorElevation('first', building)).toBe(3.4);
    expect(floorElevation('basement', building)).toBe(-2.95);
    building.groundHeight = 4.1;
    building.basementDepth = 3.6;
    expect(floorElevation('ground', building)).toBe(0);
    expect(floorElevation('first', building)).toBe(4.1);
    expect(floorElevation('basement', building)).toBe(-3.6);
  });

  it('returns independently editable unit settings on every defaultState call', () => {
    const first = defaultState();
    const second = defaultState();
    first.buildings.north.width = 9;
    first.location.latitude = 0;
    first.neighbors[0].height = 5;
    expect(first.buildings.south.width).toBe(BASE_WIDTH);
    expect(second).toEqual(defaultState());
  });
});

describe('plan transforms and true-north orientation', () => {
  it('keeps every traced wall endpoint registered at default scale, including the wider upper floor', () => {
    const state = defaultState();
    for (const wall of WALLS) {
      expectPoint(planPoint(wall.a, wall.unit, state), wall.a);
      expectPoint(planPoint(wall.b, wall.unit, state), wall.b);
      expect(wallScale(wall, state)).toBeCloseTo(1, 12);
    }
    expectPoint(planPoint([12.39, 0], 'north', state), [12.39, 0]);
  });

  it('scales both depths around the shared party line, not each dwelling center', () => {
    const state = defaultState();
    state.buildings.north.depth = BASE_DEPTH.north * 1.4;
    state.buildings.south.depth = BASE_DEPTH.south * 0.7;
    for (const unit of UNITS) state.buildings[unit].width = BASE_WIDTH * 1.2;
    for (const x of [0, 2, BASE_WIDTH]) {
      expectPoint(planPoint([x, PARTY_Z], 'north', state), [x * 1.2, PARTY_Z]);
      expectPoint(planPoint([x, PARTY_Z], 'south', state), [x * 1.2, PARTY_Z]);
    }
    expectPoint(planPoint([2, PARTY_Z - 3], 'north', state), [2.4, PARTY_Z - 4.2]);
    expectPoint(planPoint([2, PARTY_Z + 3], 'south', state), [2.4, PARTY_Z + 2.1]);
  });

  it('applies explicit x/z translations after scaling and rotation, independently per unit', () => {
    const state = defaultState();
    const building = state.buildings.north;
    building.width = BASE_WIDTH * 1.2;
    building.depth = BASE_DEPTH.north * 0.5;
    building.rotation = 90;
    building.x = 7;
    building.z = -3;
    const point: Vec2 = [2, PARTY_Z + 3];
    const before: Vec2 = [...point];
    expectPoint(planPoint(point, 'north', state), [5.5, PARTY_Z - 0.6]);
    expectPoint(planPoint([0, PARTY_Z], 'north', state), [7, PARTY_Z - 3]);
    expectPoint(planPoint(point, 'south', state), point);
    expect(point).toEqual(before);
  });

  it.each([90, -90])('uses the documented positive unit rotation convention at %s degrees', rotation => {
    const state = defaultState();
    state.buildings.north.rotation = rotation;
    expectPoint(planPoint([2, PARTY_Z - 3], 'north', state), rotation === 90
      ? [3, PARTY_Z + 2] : [-3, PARTY_Z - 2]);
  });

  it('maps plan-up to 14.7 degrees clockwise from true north in the solar world', () => {
    const state = defaultState();
    expect(state.northBearing).toBe(14.7);
    const up = trueWorldPoint([0, -1], state);
    const towardSun = solarDirection(0, 14.7);
    expectPoint(up, [towardSun.x, towardSun.z]);
    expect(Math.atan2(up[0], -up[1]) * 180 / Math.PI).toBeCloseTo(14.7, 12);
    expect(up[0]).toBeGreaterThan(0);
    expect(up[1]).toBeLessThan(0);
    expect(Math.hypot(...up)).toBeCloseTo(1, 12);
    expectPoint(trueWorldPoint([1, 0], state), [Math.cos(14.7 * Math.PI / 180), Math.sin(14.7 * Math.PI / 180)]);
  });

  it.each([
    [0, [0, -1]], [90, [1, 0]], [-90, [-1, 0]], [180, [0, 1]], [-180, [0, 1]],
  ] satisfies [number, Vec2][])('preserves true cardinal direction at bearing %s', (bearing, expected) => {
    const state = defaultState();
    state.northBearing = bearing;
    expectPoint(trueWorldPoint([0, -1], state), expected);
  });

  it('composes unit rotation with north bearing exactly once, around the translated party-line anchor', () => {
    const state = defaultState();
    state.buildings.north.rotation = 23;
    state.buildings.north.x = 4;
    state.buildings.north.z = -2;
    const anchor = trueWorldPoint(planPoint([0, PARTY_Z], 'north', state), state);
    const up = trueWorldPoint(planPoint([0, PARTY_Z - 1], 'north', state), state);
    const expected = solarDirection(0, 14.7 + 23);
    expectPoint([up[0] - anchor[0], up[1] - anchor[1]], [expected.x, expected.z]);
    const local = planPoint([2, 1], 'north', state);
    state.northBearing = -113;
    expectPoint(planPoint([2, 1], 'north', state), local);
  });

  it('scales area by the horizontal determinant, without depending on rigid transforms or view', () => {
    const state = defaultState();
    for (const unit of UNITS) {
      const baseline = areaOf(FOOTPRINTS.ground[unit]);
      expect(buildingArea(unit, state)).toBeCloseTo(baseline, 10);
      state.buildings[unit].width = BASE_WIDTH * 1.2;
      state.buildings[unit].depth = BASE_DEPTH[unit] * 0.8;
      state.buildings[unit].rotation = 27;
      state.buildings[unit].x = 13;
      state.buildings[unit].z = -12;
      expect(buildingArea(unit, state)).toBeCloseTo(baseline * 1.2 * 0.8, 10);
      expect(areaOf(FOOTPRINTS.ground[unit].map(point => planPoint(point, unit, state))))
        .toBeCloseTo(buildingArea(unit, state), 10);
    }
  });
});

describe('effective opening widths and immutable source identity', () => {
  it('scales each plan opening along its own wall while preserving vertical and relative dimensions', () => {
    const state = defaultState();
    for (const unit of UNITS) {
      state.buildings[unit].width = BASE_WIDTH * 1.2;
      state.buildings[unit].depth = BASE_DEPTH[unit] * 0.8;
      state.buildings[unit].rotation = 23;
      state.buildings[unit].x = 6;
      state.buildings[unit].z = -4;
    }
    const resolved = resolvedOpenings(state);
    expect(resolved).toHaveLength(BASE_OPENINGS.length);
    for (const base of BASE_OPENINGS) {
      const wall = WALL_BY_ID.get(base.wallId)!;
      const worldLength = distance(planPoint(wall.a, wall.unit, state), planPoint(wall.b, wall.unit, state));
      const scale = worldLength / distance(wall.a, wall.b);
      const opening = resolved.find(item => item.id === base.id)!;
      expect(wallScale(wall, state)).toBeCloseTo(scale, 12);
      expect(opening.width).toBeCloseTo(base.width * scale, 10);
      expect(opening).toMatchObject({
        id: base.id, wallId: base.wallId, source: 'plan', unit: base.unit, floor: base.floor,
        height: base.height, sill: base.sill, position: base.position,
      });
    }
    const northGlazing = resolved.filter(opening => opening.wallId === 'ground-wall-0-north');
    expect(northGlazing).toHaveLength(3);
    for (const opening of northGlazing) expect(opening.width).toBeCloseTo(3.2 * 1.2, 12);
  });

  it('uses Euclidean wall length under anisotropic scaling, including a diagonal wall', () => {
    const state = defaultState();
    state.buildings.north.width = BASE_WIDTH * 1.2;
    state.buildings.north.depth = BASE_DEPTH.north * 0.8;
    const wall: PlanWall = {
      id: 'test-diagonal', sourceId: 'test', unit: 'north', floor: 'ground',
      a: [1, 1], b: [4, 5], thickness: 0.2, exterior: false, retaining: false, openings: [],
    };
    expect(wallScale(wall, state)).toBeCloseTo(Math.hypot(3 * 1.2, 4 * 0.8) / 5, 12);
  });

  it('keeps manual widths in world metres until their override is removed', () => {
    const state = defaultState();
    const base = BASE_OPENINGS.find(opening => opening.wallId === 'ground-wall-0-north')!;
    state.openings[base.id] = { width: 2.25, shutter: true };
    for (const scale of [0.7, 1, 1.4]) {
      state.buildings.north.width = BASE_WIDTH * scale;
      const opening = resolvedOpenings(state).find(item => item.id === base.id)!;
      expect(opening.width).toBe(2.25);
      expect(opening.shutter).toBe(true);
      expect(state.openings[base.id]).toEqual({ width: 2.25, shutter: true });
    }
    delete state.openings[base.id];
    expect(resolvedOpenings(state).find(item => item.id === base.id)!.width).toBeCloseTo(3.2 * 1.4, 12);
    expect(base.width).toBe(3.2);
  });

  it('never scales an added opening width and preserves zero width/height as disabled', () => {
    const state = defaultState();
    const base = BASE_OPENINGS[0];
    const extra = added(base);
    state.addedOpenings = [extra];
    state.buildings[base.unit].width *= 1.3;
    state.buildings[base.unit].depth *= 1.2;
    expect(resolvedOpenings(state).find(opening => opening.id === extra.id)!.width).toBe(1.2);
    state.openings[base.id] = { width: 0 };
    state.openings[extra.id] = { height: 0 };
    let resolved = resolvedOpenings(state);
    expect(resolved.find(opening => opening.id === base.id)!.width).toBe(0);
    expect(resolved.find(opening => opening.id === extra.id)).toMatchObject({ width: 1.2, height: 0 });
    extra.width = 0;
    resolved = resolvedOpenings(state);
    expect(resolved.find(opening => opening.id === extra.id)).toMatchObject({ width: 0, height: 0 });
  });

  it('keeps canonical IDs, wall association, unit, floor and source even for a mismatched raw override', () => {
    const state = defaultState();
    const base = BASE_OPENINGS[0];
    state.openings[base.id] = {
      id: 'wrong-id', wallId: 'wrong-wall', unit: base.unit === 'north' ? 'south' : 'north',
      floor: base.floor === 'first' ? 'ground' : 'first', source: 'added', width: 1.7,
    };
    const result = resolvedOpenings(state).find(opening => opening.id === base.id)!;
    expect(result).toMatchObject({ id: base.id, wallId: base.wallId, unit: base.unit, floor: base.floor, source: base.source, width: 1.7 });
  });

  it('returns fresh resolved records without writing scaled dimensions back into the PDF source or state', () => {
    const state = defaultState();
    const extra = added(BASE_OPENINGS[0]);
    state.addedOpenings = [extra];
    const sourceBefore = structuredClone(BASE_OPENINGS);
    const before = structuredClone(state);
    const first = resolvedOpenings(state);
    first.forEach(opening => { opening.width = 0; opening.label = 'שינוי בתוצאה בלבד'; });
    expect(BASE_OPENINGS).toEqual(sourceBefore);
    expect(state).toEqual(before);
    expect(resolvedOpenings(state)).toHaveLength(BASE_OPENINGS.length + 1);
    expect(resolvedOpenings(state).find(opening => opening.id === extra.id)!.width).toBe(1.2);
  });
});