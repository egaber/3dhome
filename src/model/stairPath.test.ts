import { describe, expect, it } from 'vitest';
import polygonClipping from 'polygon-clipping';
import { createStairPath, DEFAULT_STAIR_PATH, parseStairPath, parseStairPaths, reverseStairPath, stairPartCorners } from './stairPath';
import type { StairPathSettings } from './types';

describe('editable stair flights and landing', () => {
  for (const turn of ['straight', 'left', 'right'] as const) for (const reversed of [false, true]) {
    it(`${turn}, reversed=${reversed}: continuous footprint, 18 equal rises and an adjustable landing`, () => {
      const settings = { ...DEFAULT_STAIR_PATH, turn, reversed, landingAfter: 11 };
      const geometry = createStairPath(settings, [.68, 12.44], -2.95, 3.4);
      expect(geometry.parts).toHaveLength(17);
      expect(geometry.parts[10].kind).toBe('landing');
      expect(geometry.parts[10].width).toBe(1.1);
      geometry.parts.forEach((part, index) => expect(part.bottom + part.height).toBeCloseTo(-2.95 + 3.4 * (index + 1) / 18));
      for (const part of geometry.parts) expect(polygonClipping.difference([stairPartCorners(part)], [geometry.footprint])).toEqual([]);
      for (let index = 1; index < geometry.parts.length; index++) {
        const union = polygonClipping.union([stairPartCorners(geometry.parts[index - 1])], [stairPartCorners(geometry.parts[index])]);
        expect(union).toHaveLength(1);
      }
      expect(geometry.entry.center).not.toEqual(geometry.exit.center);
      const first = geometry.parts[0].center, next = geometry.parts[1].center;
      const last = geometry.parts.at(-1)!.center, previous = geometry.parts.at(-2)!.center;
      const cross = (next[0] - first[0]) * (last[1] - previous[1]) - (next[1] - first[1]) * (last[0] - previous[0]);
      if (turn === 'straight') expect(cross).toBeCloseTo(0);
      else expect(Math.sign(cross)).toBe(turn === 'right' ? 1 : -1);
    });
  }
  it('turns from the west flight toward the center and reverses ascent without changing the footprint', () => {
    const settings = { ...DEFAULT_STAIR_PATH };
    const forward = createStairPath(settings, [.68, 12.44], 0, 3.4);
    const reversed = createStairPath(reverseStairPath(settings), [.68, 12.44], 0, 3.4);
    expect(reverseStairPath(reverseStairPath(settings))).toEqual(settings);
    expect(forward.entry.center).toEqual([.68, 12.44]);
    expect(forward.exit.center[0]).toBeGreaterThan(3);
    expect(reversed.entry).toEqual(forward.exit);
    expect(reversed.exit).toEqual(forward.entry);
    expect(polygonClipping.xor([forward.footprint], [reversed.footprint])).toEqual([]);
    expect(forward.parts[settings.landingAfter - 1].bottom + .12).toBeCloseTo(3.4 * settings.landingAfter / 18);
  });
  it('rejects invalid dimensions, non-integer splits, extra keys and unknown connections', () => {
    for (const patch of [{ width: 0 }, { width: 1.3, landingDepth: 1.1 }, { landingDepth: Infinity }, { landingAfter: 2 },
      { landingAfter: 16 }, { landingAfter: 9.5 }, { treadDepth: .1 }, { reversed: 'yes' }, { turn: 'diagonal' }, { extra: true }]) {
      expect(() => parseStairPath({ ...DEFAULT_STAIR_PATH, ...patch })).toThrow();
    }
    expect(() => parseStairPaths({ roof: DEFAULT_STAIR_PATH }, 'paths')).toThrow();
    expect(() => parseStairPaths({ ground: null }, 'paths')).toThrow();
    const source = { ground: { ...DEFAULT_STAIR_PATH } };
    const parsed = parseStairPaths(source, 'paths');
    expect(parsed).toEqual(source);
    expect(parsed.ground).not.toBe(source.ground);
  });

  for (const turn of ['straight', 'left', 'right'] as const) for (const secondTurn of ['straight', 'left', 'right'] as const) {
    it(`${turn} then ${secondTurn}: two connected landings retain equal rises and reversible geometry`, () => {
      const settings: StairPathSettings = { ...DEFAULT_STAIR_PATH, turn,
        secondLanding: { turn: secondTurn, landingAfter: 15, landingDepth: 1.2 } };
      const forward = createStairPath(settings, [.68, 12.44], 0, 3.4);
      const reverse = createStairPath(reverseStairPath(settings), [.68, 12.44], 0, 3.4);
      expect(reverseStairPath(reverseStairPath(settings))).toEqual(settings);
      expect(reverse.entry).toEqual(forward.exit);
      expect(reverse.exit).toEqual(forward.entry);
      expect(polygonClipping.xor([forward.footprint], [reverse.footprint])).toEqual([]);
      for (const geometry of [forward, reverse]) {
        expect(geometry.parts).toHaveLength(17);
        expect(geometry.parts.filter(part => part.kind === 'landing')).toHaveLength(2);
        geometry.parts.forEach((part, index) => expect(part.bottom + part.height).toBeCloseTo(3.4 * (index + 1) / 18));
        for (let index = 1; index < geometry.parts.length; index++) {
          expect(polygonClipping.union([stairPartCorners(geometry.parts[index - 1])], [stairPartCorners(geometry.parts[index])])).toHaveLength(1);
          for (let previous = 0; previous < index; previous++) {
            expect(polygonClipping.intersection([stairPartCorners(geometry.parts[previous])], [stairPartCorners(geometry.parts[index])])).toEqual([]);
          }
        }
      }
      expect(forward.parts[9]).toMatchObject({ kind: 'landing', width: 1.1 });
      expect(forward.parts[14]).toMatchObject({ kind: 'landing', width: 1.2 });
      expect(reverse.parts[2]).toMatchObject({ kind: 'landing', width: 1.2 });
      expect(reverse.parts[7]).toMatchObject({ kind: 'landing', width: 1.1 });
    });
  }
  it('adds a southbound final flight while preserving the west approach and first landing', () => {
    const firstTurn = createStairPath(DEFAULT_STAIR_PATH, [.68, 12.44], 0, 3.4);
    const secondTurn = createStairPath({ ...DEFAULT_STAIR_PATH,
      secondLanding: { turn: 'right', landingAfter: 15, landingDepth: 1.1 } }, [.68, 12.44], 0, 3.4);
    for (let index = 0; index < 10; index++) expect(stairPartCorners(secondTurn.parts[index])).toEqual(stairPartCorners(firstTurn.parts[index]));
    expect(secondTurn.exit.center[0]).toBeCloseTo(2.95);
    expect(secondTurn.exit.center[1]).toBeCloseTo(10.64);
    expect(secondTurn.parts.at(-1)!.center[1]).toBeGreaterThan(secondTurn.parts.at(-2)!.center[1]);
  });
  it('rejects malformed or unordered second landings and keeps room for both adjoining flights', () => {
    const second = { turn: 'right', landingAfter: 15, landingDepth: 1.1 };
    for (const value of [null, { ...second, turn: 'diagonal' }, { ...second, landingAfter: 10 }, { ...second, landingAfter: 12 },
      { ...second, landingAfter: 16 }, { ...second, landingAfter: 14.5 }, { ...second, landingDepth: .8 },
      { ...second, landingDepth: Infinity }, { ...second, extra: true }]) {
      expect(() => parseStairPath({ ...DEFAULT_STAIR_PATH, secondLanding: value })).toThrow();
    }
  });
});