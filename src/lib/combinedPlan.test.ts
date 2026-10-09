import { describe, expect, it } from 'vitest';
import { areaOf, defaultState, FOOTPRINTS, planPoint } from '../model/plans';
import { combinedFloorPlan } from './combinedPlan';

describe('combined floor plan', () => {
  it('shows both dwellings together on each requested floor without changing the project', () => {
    const state = defaultState(), before = JSON.stringify(state);
    for (const floor of ['ground', 'first'] as const) {
      const plan = combinedFloorPlan(state, floor);
      expect(plan.units.map(unit => unit.id)).toEqual(['north', 'south']);
      for (const unit of plan.units) {
        expect(unit.footprint).toEqual(FOOTPRINTS[floor][unit.id].map(point => planPoint(point, unit.id, state)));
        expect(unit.envelopeArea).toBeCloseTo(areaOf(FOOTPRINTS[floor][unit.id]));
        expect(unit.walls.length).toBeGreaterThan(0);
        expect(unit.rooms.length).toBeGreaterThan(0);
        expect(unit.walls.every(wall => wall.unit === unit.id && wall.floor === floor)).toBe(true);
      }
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('preserves saved edits and measures scaled, rotated rooms in the same plan coordinates', () => {
    const state = defaultState();
    state.buildings.south.width *= 1.5;
    state.buildings.south.depth *= 2;
    state.buildings.south.rotation = 31;
    state.buildings.south.x = 18;
    state.design.roomEdits['b-living'] = { center: [3, 14], width: 4, depth: 3, rotation: 90, deleted: false };
    const plan = combinedFloorPlan(state, 'ground'), room = plan.units[1].rooms.find(item => item.room.id === 'b-living')!;
    expect(room.center).toEqual(planPoint([3, 14], 'south', state));
    expect(room.width).toBeCloseTo(8);
    expect(room.depth).toBeCloseTo(4.5);
    expect(plan.units[1].envelopeArea).toBeCloseTo(areaOf(FOOTPRINTS.ground.south) * 3);
    for (const unit of plan.units) for (const point of unit.footprint) {
      expect(point[0]).toBeGreaterThanOrEqual(plan.bounds.x);
      expect(point[0]).toBeLessThanOrEqual(plan.bounds.x + plan.bounds.width);
      expect(point[1]).toBeGreaterThanOrEqual(plan.bounds.y);
      expect(point[1]).toBeLessThanOrEqual(plan.bounds.y + plan.bounds.height);
    }
  });

  it('omits disabled dwellings, unavailable floors, and deleted room annotations', () => {
    const state = defaultState();
    state.buildings.north.enabled = false;
    state.buildings.south.storeys = 1;
    state.design.roomEdits['b-living'] = { center: [3, 14], width: 4, depth: 3, deleted: true };
    const ground = combinedFloorPlan(state, 'ground');
    expect(ground.units.map(unit => unit.id)).toEqual(['south']);
    expect(ground.units[0].rooms.some(item => item.room.id === 'b-living')).toBe(false);
    expect(combinedFloorPlan(state, 'first')).toEqual({ floor: 'first', units: [], bounds: { x: 0, y: 0, width: 1, height: 1 } });
  });
});