import polygonClipping from 'polygon-clipping';
import type { Polygon } from 'polygon-clipping';
import type { StairPart } from './cad';
import { boolean, choice, hasOwn, invalid, number, point, record } from './cadValidation';
import { rotatePlanPoint } from './rotation';
import type { BuildingSettings, StairLandingSettings, StairPathSettings, Vec2 } from './types';

export const DEFAULT_STAIR_PATH: StairPathSettings = {
  turn: 'right', landingAfter: 10, landingDepth: 1.1, width: .92, treadDepth: .27, reversed: false,
};
export const STAIR_PATH_RISERS = 18;
export interface StairPortal { center: Vec2; a: Vec2; b: Vec2 }
export interface StairPathGeometry {
  parts: StairPart[];
  footprint: Vec2[];
  entry: StairPortal;
  exit: StairPortal;
}

export function parseStairPath(value: unknown, path = 'stairPath'): StairPathSettings {
  const input = record(value, path, ['turn', 'landingAfter', 'landingDepth', 'width', 'treadDepth', 'reversed', 'secondLanding', 'rotation', 'offset']);
  const width = number(input.width, `${path}.width`, .8, 1.5);
  const result: StairPathSettings = {
    turn: choice(input.turn, `${path}.turn`, ['straight', 'left', 'right']),
    landingAfter: number(input.landingAfter, `${path}.landingAfter`, 3, 15, true),
    landingDepth: number(input.landingDepth, `${path}.landingDepth`, width, 2.4),
    width,
    treadDepth: number(input.treadDepth, `${path}.treadDepth`, .22, .4),
    reversed: boolean(input.reversed, `${path}.reversed`),
    ...(hasOwn(input, 'rotation') ? { rotation: number(input.rotation, `${path}.rotation`, -180, 180) } : {}),
    ...(hasOwn(input, 'offset') ? { offset: point(input.offset, `${path}.offset`) } : {}),
  };
  if (hasOwn(input, 'secondLanding')) {
    const second = record(input.secondLanding, `${path}.secondLanding`, ['turn', 'landingAfter', 'landingDepth']);
    result.secondLanding = {
      turn: choice(second.turn, `${path}.secondLanding.turn`, ['straight', 'left', 'right']),
      landingAfter: number(second.landingAfter, `${path}.secondLanding.landingAfter`, result.landingAfter + 3, 15, true),
      landingDepth: number(second.landingDepth, `${path}.secondLanding.landingDepth`, width, 2.4),
    };
  }
  return result;
}

export function parseStairPaths(value: unknown, path: string): NonNullable<BuildingSettings['stairPaths']> {
  const input = record(value, path, ['basement', 'ground', 'first']);
  return Object.fromEntries((['basement', 'ground', 'first'] as const).filter(floor => hasOwn(input, floor))
    .map(floor => [floor, parseStairPath(input[floor], `${path}.${floor}`)]));
}

export function reverseStairPath(settings: StairPathSettings): StairPathSettings {
  const path = parseStairPath(settings);
  const reverseLanding = (landing: StairLandingSettings): StairLandingSettings => ({
    landingAfter: STAIR_PATH_RISERS - landing.landingAfter, landingDepth: landing.landingDepth,
    turn: landing.turn === 'straight' ? 'straight' : landing.turn === 'right' ? 'left' : 'right',
  });
  return { ...path, ...reverseLanding(path.secondLanding ?? path), reversed: !path.reversed,
    ...(path.secondLanding ? { secondLanding: reverseLanding(path) } : {}) };
}

export function stairPartCorners(part: StairPart): Vec2[] {
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([horizontal, vertical]) =>
    rotatePlanPoint([part.center[0] + horizontal * part.width / 2, part.center[1] + vertical * part.depth / 2], part.center, part.rotation ?? 0)
      .map(value => Math.round(value * 1e6) / 1e6) as Vec2);
}

export function createStairPath(settings: StairPathSettings, entry: Vec2, elevation: number, rise: number): StairPathGeometry {
  const path = parseStairPath(settings);
  if (!entry.every(Number.isFinite) || !Number.isFinite(elevation) || !Number.isFinite(rise) || rise <= 0) invalid('stairPath', 'Invalid stair elevation or entry.');
  const physical = path.reversed ? reverseStairPath(path) : path;
  const landings = [physical, ...(physical.secondLanding ? [physical.secondLanding] : [])];
  const parts: StairPart[] = [];
  let flightEntry: Vec2 = [...entry], rotation = 0, previousRise = 0;
  const flightPoint = (distance: number, lateral = 0): Vec2 =>
    rotatePlanPoint([flightEntry[0] + lateral, flightEntry[1] - distance], flightEntry, rotation);
  const addFlight = (count: number) => {
    for (let index = 0; index < count; index++) parts.push({ kind: 'tread', center: flightPoint((index + .5) * path.treadDepth),
      width: path.width, depth: path.treadDepth, height: .1, bottom: 0, ...(previousRise ? { rotation } : {}) });
  };
  for (const landing of landings) {
    const count = landing.landingAfter - previousRise - 1, run = count * path.treadDepth;
    addFlight(count);
    const center = flightPoint(run + landing.landingDepth / 2, (landing.landingDepth - path.width) / 2);
    parts.push({ kind: 'landing', center, width: landing.landingDepth, depth: landing.landingDepth, height: .12, bottom: 0,
      ...(rotation ? { rotation } : {}) });
    const nextRotation = rotation + (landing.turn === 'right' ? 90 : landing.turn === 'left' ? -90 : 0);
    flightEntry = landing.turn === 'straight' ? flightPoint(run + landing.landingDepth)
      : rotatePlanPoint([center[0], center[1] - landing.landingDepth / 2], center, nextRotation);
    rotation = nextRotation;
    previousRise = landing.landingAfter;
  }
  const finalCount = STAIR_PATH_RISERS - previousRise - 1;
  addFlight(finalCount);
  const portal = (center: Vec2, rotation: number): StairPortal => ({ center,
    a: rotatePlanPoint([center[0] - path.width / 2, center[1]], center, rotation),
    b: rotatePlanPoint([center[0] + path.width / 2, center[1]], center, rotation) });
  const start = portal([...entry], 0), end = portal(flightPoint(finalCount * path.treadDepth), rotation);
  if (path.reversed) parts.reverse();
  parts.forEach((part, index) => { part.bottom = elevation + rise * (index + 1) / STAIR_PATH_RISERS - part.height; });
  const polygons: Polygon[] = parts.map(part => [stairPartCorners(part)]);
  const union = polygonClipping.union(polygons[0], ...polygons.slice(1));
  if (union.length !== 1 || union[0].length !== 1) invalid('stairPath', 'The stair path must have one continuous footprint.');
  return { parts, footprint: union[0][0].slice(0, -1) as Vec2[], entry: path.reversed ? end : start, exit: path.reversed ? start : end };
}