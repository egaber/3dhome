import { describe, expect, it } from 'vitest';
import { aggregateInput, clampToBounds, isWithinBounds, keyToInput } from './walkNavigation';

describe('walk navigation input', () => {
  it.each([
    ['w', { forward: 1, strafe: 0, vertical: 0 }],
    ['ArrowUp', { forward: 1, strafe: 0, vertical: 0 }],
    ['s', { forward: -1, strafe: 0, vertical: 0 }],
    ['ArrowDown', { forward: -1, strafe: 0, vertical: 0 }],
    ['a', { forward: 0, strafe: -1, vertical: 0 }],
    ['ArrowLeft', { forward: 0, strafe: -1, vertical: 0 }],
    ['d', { forward: 0, strafe: 1, vertical: 0 }],
    ['ArrowRight', { forward: 0, strafe: 1, vertical: 0 }],
    ['PageUp', { forward: 0, strafe: 0, vertical: 1 }],
    ['PageDown', { forward: 0, strafe: 0, vertical: -1 }],
  ])('maps %s', (key, expected) => expect(keyToInput(key)).toEqual(expected));

  it('combines simultaneous input without exceeding unit length', () => {
    const input = aggregateInput(['w', 'd', 'PageUp']);
    expect(Math.hypot(input.forward, input.strafe, input.vertical)).toBeCloseTo(1);
    expect(aggregateInput([])).toEqual({ forward: 0, strafe: 0, vertical: 0 });
  });

  it('clamps and rejects positions outside all three bounds', () => {
    const bounds = { minX: 0, maxX: 10, minZ: -4, maxZ: 8, minY: 1.62, maxY: 4 };
    expect(clampToBounds({ x: -1, y: 5, z: 9 }, bounds)).toEqual({ x: 0, y: 4, z: 8 });
    expect(isWithinBounds({ x: 1, y: 2, z: 1 }, bounds)).toBe(true);
    expect(isWithinBounds({ x: 0, y: 2, z: 1 }, bounds, .2)).toBe(false);
    expect(isWithinBounds({ x: 1, y: 4.1, z: 1 }, bounds)).toBe(false);
  });
});
