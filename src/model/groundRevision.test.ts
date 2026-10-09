import { describe, expect, it } from 'vitest';
import polygonClipping from 'polygon-clipping';
import traced from '../assets/traced-walls.json';
import { initializeProject, MIGRATION_KEYS } from '../lib/initializeProject';
import { parseProject, serializeProject } from '../lib/project';
import { resolveStairGeometry } from './cad';
import { BASE_OPENINGS, FOOTPRINTS, PLAN_IMAGES, ROOMS, STAIR_HOLES, WALLS, areaOf, defaultState, resolvedOpenings } from './plans';

describe('revised ground blueprint', () => {
  it('uses independent source registration without rescaling the unchanged floor sheets', () => {
    expect(traced.levels.ground.revision).toBe('קומת קרקע.pdf');
    expect(traced.levels.ground.walls).toHaveLength(28);
    expect(PLAN_IMAGES.ground.pointsPerMetre).toBeCloseTo(28.373266494950876, 12);
    expect(PLAN_IMAGES.first.pointsPerMetre).toBe(traced.pointsPerMetre);
    expect(PLAN_IMAGES.basement.pointsPerMetre).toBe(traced.pointsPerMetre);
    expect(traced.levels.first.walls).toHaveLength(28);
    expect(traced.levels.basement.walls).toHaveLength(27);
  });

  it('matches the printed clear kitchen, bath, safe-room and living dimensions', () => {
    const room = (id: string) => ROOMS.find(item => item.id === id)!;
    expect(room('a-kitchen')).toMatchObject({ width: 3.71, depth: 6.52 });
    expect(room('b-kitchen')).toMatchObject({ width: 3.68, depth: 3.1 });
    expect(room('a-bath')).toMatchObject({ unit: 'north', width: 2, depth: 1.7, center: [7.54, 8.09] });
    expect(room('a-safe')).toMatchObject({ unit: 'north', width: 3.03, depth: 2.9 });
    expect(room('b-wc')).toMatchObject({ unit: 'south', width: 2, depth: 1 });
    expect(room('b-living')).toMatchObject({ width: 5.15, depth: 3.62 });
    expect(ROOMS.some(item => ['a-wc', 'b-safe', 'b-bath'].includes(item.id))).toBe(false);
  });

  it('keeps the entire stepped party boundary shared without splitting at the old horizontal line', () => {
    for (const sourceId of ['ground-wall-3', 'ground-wall-13', 'ground-wall-18', 'ground-wall-27', 'ground-wall-28', 'ground-wall-32']) {
      const pair = WALLS.filter(wall => wall.sourceId === sourceId);
      expect(pair).toHaveLength(2);
      expect(pair.map(wall => wall.unit).sort()).toEqual(['north', 'south']);
      expect(pair[0].a).toEqual(pair[1].a);
      expect(pair[0].b).toEqual(pair[1].b);
      expect(pair.every(wall => !wall.exterior && wall.openings.length === 0)).toBe(true);
    }
    const partyReturn = WALLS.find(wall => wall.id === 'ground-wall-18-north')!;
    expect(partyReturn.a).toEqual([6.44, 6.74]);
    expect(partyReturn.b).toEqual([6.44, 9.14]);
    expect(WALLS.find(wall => wall.id === 'ground-wall-21-north')?.a).toEqual([8.59, 6.14]);
    expect(WALLS.some(wall => ['ground-wall-7', 'ground-wall-8', 'ground-wall-15', 'ground-wall-17', 'ground-wall-19', 'ground-wall-20', 'ground-wall-23'].includes(wall.sourceId))).toBe(false);
  });

  it('covers the combined outline without overlapping the bath/safe annex into the south floor', () => {
    const north = FOOTPRINTS.ground.north, south = FOOTPRINTS.ground.south;
    expect(polygonClipping.intersection([north], [south])).toEqual([]);
    const union = polygonClipping.union([north], [south]);
    expect(union).toHaveLength(1);
    expect(union[0]).toHaveLength(1);
    expect(areaOf(union[0][0])).toBeCloseTo(areaOf(north) + areaOf(south), 10);
    const safe = [[8.64, 6.29], [11.67, 6.29], [11.67, 9.19], [8.64, 9.19]] as [number, number][];
    expect(polygonClipping.difference([safe], [north])).toEqual([]);
    expect(polygonClipping.intersection([safe], [south])).toEqual([]);
  });

  it('preserves measured glazing and does not inject older facade additions on startup or reload', () => {
    for (const completed of [[], MIGRATION_KEYS]) {
      const state = initializeProject(defaultState(), completed);
      expect(state.addedOpenings).toEqual([]);
      expect(state.openings).toEqual({});
      const openings = resolvedOpenings(state);
      expect(openings).toHaveLength(BASE_OPENINGS.length);
      for (const [index, opening] of openings.entries()) {
        expect(opening.width).toBeCloseTo(BASE_OPENINGS[index].width, 10);
        expect({ ...opening, width: BASE_OPENINGS[index].width }).toEqual(BASE_OPENINGS[index]);
      }
      const east = resolvedOpenings(state).find(item => item.id === 'ground-wall-2-north-opening-0');
      expect(east).toMatchObject({ kind: 'glazing', width: 3.2 });
      expect(east?.position).toBeCloseTo(1.8 / 4.22, 10);
      expect(resolvedOpenings(state).find(item => item.id === 'ground-wall-12-north-opening-0')).toMatchObject({ kind: 'window', width: 1.4 });
      expect(initializeProject(parseProject(serializeProject(state)), completed)).toEqual(state);
    }
  });

  it('registers staircase footprints at the updated source-plan coordinates', () => {
    expect(STAIR_HOLES.north).toEqual([[4.03, 3.4], [6.34, 3.4], [6.34, 6.74], [4.03, 6.74]]);
    expect(STAIR_HOLES.south).toEqual([[4, 6.94], [6.34, 6.94], [6.34, 9.84], [4, 9.84]]);
    for (const unit of ['north', 'south'] as const) {
      for (const floor of ['ground', 'basement'] as const) {
        expect(resolveStairGeometry(defaultState(), unit, floor)?.footprint).toEqual(STAIR_HOLES[unit]);
      }
    }
  });
});