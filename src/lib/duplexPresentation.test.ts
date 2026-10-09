import { describe, expect, it } from 'vitest';
import { defaultState } from '../model/plans';
import { duplexCamera, duplexView } from './duplexPresentation';

describe('duplex presentation', () => {
  it('isolates each floor and restores the full building without editing geometry', () => {
    const state = defaultState(), before = JSON.stringify(state);
    for (const preset of ['exterior', 'ground', 'first'] as const) {
      const view = duplexView(state.view, preset);
      expect(view.isolateFloor).toBe(preset === 'exterior' ? 'none' : preset);
      expect(view.mode).toBe('orbit');
      expect(view.renderMode).toBe('realistic');
      expect(view.planVisible).toBe(false);
      expect(view.path).toBe(false);
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('frames both dwellings and widens camera distance for portrait viewports', () => {
    const state = defaultState();
    const desktop = duplexCamera(state, 'ground', 1.5)!, mobile = duplexCamera(state, 'ground', .55)!;
    expect(mobile.target).toEqual(desktop.target);
    const distance = (frame: typeof desktop) => Math.hypot(...frame.position.map((value, index) => value - frame.target[index]));
    expect(distance(mobile)).toBeGreaterThan(distance(desktop));
    expect(duplexCamera(state, 'first', 1.5)!.target[1]).toBeGreaterThan(desktop.target[1]);
    expect(duplexCamera(state, 'exterior', 1.5)!.position.every(Number.isFinite)).toBe(true);
  });

  it('follows translated buildings and ignores unavailable floors', () => {
    const state = defaultState();
    state.northBearing = 0;
    const original = duplexCamera(state, 'ground', 1)!;
    state.buildings.north.x = state.buildings.south.x = 20;
    expect(duplexCamera(state, 'ground', 1)!.target[0]).toBeCloseTo(original.target[0] + 20);
    state.buildings.north.enabled = false;
    state.buildings.south.storeys = 1;
    expect(duplexCamera(state, 'first', 1)).toBeNull();
    expect(duplexCamera(state, 'ground', Number.NaN)!.position.every(Number.isFinite)).toBe(true);
    state.buildings.south.enabled = false;
    expect(duplexCamera(state, 'exterior', 1)).toBeNull();
  });
});