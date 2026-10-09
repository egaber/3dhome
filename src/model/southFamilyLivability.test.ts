import { describe, expect, it } from 'vitest';
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon } from 'polygon-clipping';
import { getWallApertures, resolveStairGeometry } from './cad';
import { defaultState, resolvedFootprint, resolvedFurniture, resolvedWalls } from './plans';
import { southFamilyProposal, SOUTH_FAMILY_FURNITURE, SOUTH_FAMILY_ROOMS, SOUTH_FAMILY_SUITE } from './southFamilyLayout';
import { furniturePoint, solidWallSpans, wallLocalPoint, wallPolygon } from '../lib/cadEditor';
import type { FloorId, FurnitureSpec, Vec2 } from './types';

const rectangle = (x: number, z: number, width: number, depth: number): Vec2[] => [[x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2], [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2]];
const footprint = (item: FurnitureSpec) => rectangle(0, 0, item.width, item.depth).map(point => furniturePoint(item, point));
const area = (polygons: MultiPolygon) => polygons.reduce((sum, polygon) => sum + polygon.reduce((subtotal, ring, ringIndex) => {
  const ringArea = Math.abs(ring.reduce((total, point, index) => { const next = ring[(index + 1) % ring.length]; return total + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;
  return subtotal + (ringIndex ? -ringArea : ringArea);
}, 0), 0);
const embeddedAppliances = new Set(['south-family-kitchen-sink', 'south-family-kitchen-hob', 'south-family-kitchen-dishwasher']);

describe('south family everyday clearances', () => {
  it('keeps furnishings inside the unchanged envelope and out of walls, stair holes and other furniture', () => {
    const state = southFamilyProposal(defaultState());
    const furniture = resolvedFurniture(state).filter(item => item.unit === 'south' && item.floor !== 'basement' && item.kind !== 'pendant');
    const walls = resolvedWalls(state).filter(wall => wall.unit === 'south' && wall.floor !== 'basement').flatMap(wall =>
      solidWallSpans(Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]), getWallApertures(wall, state))
        .map(([start, end]) => ({ id: wall.id, floor: wall.floor, ring: wallPolygon(wall, start, end, state) })));
    const stair = resolveStairGeometry(state, 'south', 'ground')!;
    for (const [index, item] of furniture.entries()) {
      const ring = footprint(item);
      expect(area(polygonClipping.difference([ring], [resolvedFootprint(item.floor, 'south', state)])), `${item.id} outside envelope`).toBeLessThan(1e-7);
      expect(area(polygonClipping.intersection([ring], [stair.footprint])), `${item.id} overlaps stair opening`).toBeLessThan(1e-7);
      for (const wall of walls.filter(wall => wall.floor === item.floor)) expect(area(polygonClipping.intersection([ring], [wall.ring])), `${item.id} intersects ${wall.id}`).toBeLessThan(1e-7);
      for (const other of furniture.slice(index + 1).filter(other => other.floor === item.floor)) {
        if (item.id === 'south-family-kitchen-counter' && embeddedAppliances.has(other.id) || other.id === 'south-family-kitchen-counter' && embeddedAppliances.has(item.id)) continue;
        expect(area(polygonClipping.intersection([ring], [footprint(other)])), `${item.id} overlaps ${other.id}`).toBeLessThan(1e-7);
      }
    }
  });

  it('reserves continuous furnished circulation bands instead of counting empty room rectangles', () => {
    const state = southFamilyProposal(defaultState());
    const paths: { floor: FloorId; width: number; points: Vec2[] }[] = [
      { floor: 'ground', width: .90, points: [[8.7, 11.16], [4.91, 11.16], [4.91, 15.4], [4.38, 15.4]] },
      { floor: 'ground', width: .90, points: [[5.84, 11.16], [5.84, 8.15], [4.45, 8.15]] },
      { floor: 'ground', width: .90, points: [[1.32, 12.25], [1.7, 12.25], [1.7, 13.01]] },
      { floor: 'first', width: 1.0, points: [[1.65, 12.25], [3.05, 12.25], [3.05, 11.60], [5.6, 11.60]] },
      { floor: 'first', width: .90, points: [[5.6, 11.72], [7.45, 11.72], [7.45, 12.2], [8.5, 12.2]] },
      { floor: 'first', width: .90, points: [[3.0, 11.60], [3.0, 8.72]] },
    ];
    for (const path of paths) for (let index = 1; index < path.points.length; index++) {
      const start = path.points[index - 1], end = path.points[index];
      const ring = rectangle((start[0] + end[0]) / 2, (start[1] + end[1]) / 2,
        Math.abs(end[0] - start[0]) + path.width, Math.abs(end[1] - start[1]) + path.width);
      expect(area(polygonClipping.difference([ring], [resolvedFootprint(path.floor, 'south', state)])), `path ${start}/${end} outside envelope`).toBeLessThan(1e-7);
      expect(area(polygonClipping.intersection([ring], [resolveStairGeometry(state, 'south', 'ground')!.footprint])), `path ${start}/${end} crosses stair void`).toBeLessThan(1e-7);
      for (const wall of resolvedWalls(state).filter(wall => wall.unit === 'south' && wall.floor === path.floor)) {
        const spans = solidWallSpans(Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]), getWallApertures(wall, state));
        for (const [from, to] of spans) expect(area(polygonClipping.intersection([ring], [wallPolygon(wall, from, to, state)])), `path ${start}/${end} crosses ${wall.id}`).toBeLessThan(1e-7);
      }
      for (const item of resolvedFurniture(state).filter(item => item.unit === 'south' && item.floor === path.floor && item.kind !== 'pendant')) {
        expect(area(polygonClipping.intersection([ring], [footprint(item)])), `path ${start}/${end} blocked by ${item.id}`).toBeLessThan(1e-7);
      }
    }
  });

  it('keeps full door swing sectors free of furniture on both floors', () => {
    const state = southFamilyProposal(defaultState());
    for (const wall of resolvedWalls(state).filter(wall => wall.unit === 'south' && wall.floor !== 'basement')) {
      for (const opening of getWallApertures(wall, state).filter(opening => wall.openings.find(item => item.id === opening.id)?.kind === 'door')) {
        const hinge = opening.center - opening.width / 2;
        const sector = [wallLocalPoint(wall, hinge, 0), ...Array.from({ length: 25 }, (_, index) => {
          const angle = -Math.PI * index / 48;
          return wallLocalPoint(wall, hinge + opening.width * Math.cos(angle), opening.width * Math.sin(angle));
        })];
        for (const item of resolvedFurniture(state).filter(item => item.unit === 'south' && item.floor === wall.floor && item.kind !== 'pendant')) {
          expect(area(polygonClipping.intersection([sector], [footprint(item)])), `${opening.id} swings into ${item.id}`).toBeLessThan(1e-7);
        }
      }
    }
  });

  it('includes daily-use appliances, six dining seats, bedroom work/storage and lighting', () => {
    const kinds = new Set(SOUTH_FAMILY_FURNITURE.map(item => item.kind));
    for (const kind of ['fridge', 'cooktop', 'sink', 'dishwasher', 'oven-tower', 'washer-dryer', 'tv-console', 'vanity', 'bookcase', 'nightstand', 'pendant']) expect(kinds.has(kind as FurnitureSpec['kind']), kind).toBe(true);
    expect(SOUTH_FAMILY_FURNITURE.filter(item => /^south-family-dining-chair-/.test(item.id) && item.kind === 'chair')).toHaveLength(3);
    expect(SOUTH_FAMILY_FURNITURE.find(item => item.id === 'south-family-dining-chair-4')!.width).toBeGreaterThanOrEqual(1.8);
    for (const child of ['child-1', 'child-2']) for (const suffix of ['bed', 'desk', 'chair', 'wardrobe', 'books', 'nightstand']) {
      expect(SOUTH_FAMILY_FURNITURE.some(item => item.id === `south-family-${child}-${suffix}`), `${child} ${suffix}`).toBe(true);
    }
  });

  it('keeps a 1.10 metre work aisle between the kitchen counter and island', () => {
    const counter = SOUTH_FAMILY_FURNITURE.find(item => item.id === 'south-family-kitchen-counter')!;
    const island = SOUTH_FAMILY_FURNITURE.find(item => item.id === 'south-family-kitchen-island')!;
    const clear = island.center[1] - island.depth / 2 - (counter.center[1] + counter.depth / 2);
    expect(clear).toBeGreaterThanOrEqual(1.10 - 1e-8);
  });

  it('reserves an upper hall and stair arrival at least 1.10 metres deep', () => {
    const state = southFamilyProposal(defaultState()), stair = resolveStairGeometry(state, 'south', 'ground')!;
    const hall = SOUTH_FAMILY_ROOMS.find(room => room.id === 'south-family-hall')!;
    expect(hall.depth).toBeGreaterThanOrEqual(1.10 - 1e-8);
    const topEdge = Math.max(...stair.footprint.map(point => point[1]));
    expect(SOUTH_FAMILY_SUITE[0][1] - .12 - topEdge).toBeGreaterThanOrEqual(1.10 - 1e-8);
    expect(stair.riserCount).toBe(20);
    expect(stair.rise / stair.riserCount).toBeCloseTo(.17);
    expect(stair.parts[0].depth).toBeCloseTo(.27);
    expect(stair.parts[0].width).toBeCloseTo(1);
    expect(stair.parts.find(part => part.kind === 'landing')!.depth).toBeCloseTo(1.1);
  });

  it('preserves the approved external footprint on both floors and the entire north dwelling', () => {
    const base = defaultState(), proposal = southFamilyProposal(base);
    expect(resolvedFootprint('ground', 'south', proposal)).toEqual([[0, 6.84], [6.44, 6.84], [6.44, 9.04], [8.54, 9.04],
      [8.54, 9.3], [9.49, 9.3], [9.49, 12.54], [5.59, 12.54], [5.59, 16.16], [0, 16.16]]);
    expect(resolvedFootprint('first', 'south', proposal)).toEqual([[0, 6.84], [6.34, 6.84], [6.34, 9.24], [12.39, 9.24],
      [12.39, 13.26], [6.34, 13.26], [6.34, 16.16], [0, 16.16]]);
    expect(proposal.buildings.north).toEqual(base.buildings.north);
    expect(proposal.buildings.south.width).toBe(base.buildings.south.width);
    expect(proposal.buildings.south.depth).toBe(base.buildings.south.depth);
    expect(proposal.neighbors).toEqual(base.neighbors);
  });
});