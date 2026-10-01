import { describe, expect, it } from 'vitest';
import { dimensionGutters, fitAnnotatedPlan, roomLabelFits } from './cadLayout';
import type { Vec2 } from '../model/types';

describe('screen-space CAD annotation layout', () => {
  for (const [width, height] of [[358, 175], [391, 250], [1050, 700]]) {
    it(`reserves a 56px gutter in the actual ${width}x${height} drawing box`, () => {
      const bounds = { x: -8, y: 3, width: 19, height: 12 };
      const view = fitAnnotatedPlan(bounds, width, height);
      const scale = width / view.width;
      expect(height / view.height).toBeCloseTo(scale, 10);
      expect((bounds.x - view.x) * scale).toBeGreaterThanOrEqual(56 - 1e-8);
      expect((bounds.y - view.y) * scale).toBeGreaterThanOrEqual(56 - 1e-8);
      expect((view.x + view.width - bounds.x - bounds.width) * scale).toBeGreaterThanOrEqual(56 - 1e-8);
      expect((view.y + view.height - bounds.y - bounds.height) * scale).toBeGreaterThanOrEqual(56 - 1e-8);
    });
  }
  it('handles unmeasured/invalid boxes without a nonfinite view', () => {
    for (const size of [[0, 0], [NaN, Infinity], [1, 1]]) {
      expect(Object.values(fitAnnotatedPlan({ x: 0, y: 0, width: 12, height: 8 }, ...size as [number, number])).every(Number.isFinite)).toBe(true);
    }
  });
  const room: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  it('reserves only the annotated sides without wasting mobile drawing height', () => {
    const margins = dimensionGutters([[0, 7], [12, 7], [12, 0]]);
    expect(margins).toEqual({ left: 12, right: 56, top: 12, bottom: 56 });
    const b = { x: 0, y: 0, width: 12, height: 7 }, v = fitAnnotatedPlan(b, 358, 186, margins), s = 358 / v.width;
    expect((b.y - v.y) * s).toBeCloseTo(12);
    expect((v.y + v.height - 7) * s).toBeCloseTo(56);
    expect(dimensionGutters([[0, 0], [-2, 3], [1, 5]])).toEqual({ left: 56, right: 12, top: 56, bottom: 56 });
  });
  it('shows a fitting label but culls fixture overlaps, narrow rooms and malformed envelopes', () => {
    expect(roomLabelFits([2, 2], room, [], 2, 1)).toBe(true);
    expect(roomLabelFits([2, 2], room, [{ x: 1.8, y: 1.8, width: .4, height: .4 }], 2, 1)).toBe(false);
    expect(roomLabelFits([2, 2], room, [], 5, 1)).toBe(false);
    expect(roomLabelFits([2, 2], room, [], NaN, 1)).toBe(false);
    expect(roomLabelFits([2, 2], [], [], 2, 1)).toBe(false);
  });
  it('tests the polygon, not just its bounds, for rotated rooms', () => {
    const diamond: Vec2[] = [[0, 2], [2, 0], [4, 2], [2, 4]];
    expect(roomLabelFits([2, 2], diamond, [], 3, 3)).toBe(false);
    expect(roomLabelFits([2, 2], diamond, [], 1, 1)).toBe(true);
  });
});