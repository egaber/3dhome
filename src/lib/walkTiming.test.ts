import { describe, expect, it } from 'vitest';
import { heldWalkSeconds, tapCoveredUntil, WALK_SPEED, WALK_TAP_DISTANCE } from './walkTiming';

describe('frame-independent walking taps', () => {
  it('never adds a pre-keydown frame interval to an immediate tap', () => {
    const covered = tapCoveredUntil(1000);
    expect(heldWalkSeconds(.05, 1001, covered)).toBe(0);
    expect(heldWalkSeconds(.05, 1030, covered)).toBe(0);
    expect(heldWalkSeconds(.016, 1030, covered)).toBe(0);
  });
  it('preserves the intended walking speed after the immediate distance is covered', () => {
    const covered = tapCoveredUntil(1000);
    const first = heldWalkSeconds(.05, 1050, covered);
    expect(WALK_TAP_DISTANCE + first * WALK_SPEED).toBeCloseTo(.05 * WALK_SPEED);
    expect(heldWalkSeconds(.016, 1066, 1050) * WALK_SPEED).toBeCloseTo(.016 * WALK_SPEED);
  });
  it('keeps short forward/back taps equal despite different frame placement and bounds stalled frames', () => {
    const forward = WALK_TAP_DISTANCE + heldWalkSeconds(.05, 1002, tapCoveredUntil(1000)) * WALK_SPEED;
    const backward = WALK_TAP_DISTANCE + heldWalkSeconds(.016, 2025, tapCoveredUntil(2000)) * WALK_SPEED;
    expect(forward - backward).toBe(0);
    expect(heldWalkSeconds(.05, 2000, 1000)).toBe(.05);
    expect(heldWalkSeconds(.05, 2000, Infinity)).toBe(0);
  });
});
