import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { applyViewZoom, panKeyDirection, panView, readViewZoom, restoredZoom, zoomKeyDirection } from './viewNavigation';

function view(plan = false) {
  const camera = new PerspectiveCamera(48, 1, .05, 500);
  const target = new Vector3(6, 3, 6);
  camera.position.set(29, 25, 32);
  if (plan) {
    camera.up.set(0, 0, -1);
    camera.position.set(6, 48, 6);
    target.set(6, 0, 6);
  }
  camera.lookAt(target);
  return { camera, target };
}

describe('view zoom', () => {
  it.each([['+', '', 1], ['=', '', 1], ['-', '', -1], ['+', 'NumpadAdd', 1], ['-', 'NumpadSubtract', -1], ['a', '', 0], ['_', '', 0]] as const)
    ('maps %s (%s)', (key, code, expected) => expect(zoomKeyDirection(key, code)).toBe(expected));

  it.each(['orbit', 'plan'] as const)('round-trips %s slider values and preserves target and direction', mode => {
    const { camera, target } = view(mode === 'plan');
    const originalTarget = target.clone();
    const direction = camera.position.clone().sub(target).normalize();
    let previous = Infinity;
    for (const level of [0, 25, 50, 75, 100]) {
      applyViewZoom(camera, target, mode, level);
      expect(readViewZoom(camera, target, mode).level).toBeCloseTo(level);
      expect(camera.position.distanceTo(target)).toBeLessThan(previous);
      expect(target).toEqual(originalTarget);
      expect(camera.position.clone().sub(target).normalize().distanceTo(direction)).toBeLessThan(1e-10);
      previous = camera.position.distanceTo(target);
    }
  });

  it('clamps both extremes and ignores nonfinite slider values', () => {
    const { camera, target } = view();
    applyViewZoom(camera, target, 'orbit', -500);
    expect(camera.position.distanceTo(target)).toBeCloseTo(120);
    applyViewZoom(camera, target, 'orbit', 500);
    expect(camera.position.distanceTo(target)).toBeCloseTo(2);
    const position = camera.position.clone();
    for (const value of [NaN, Infinity, -Infinity]) applyViewZoom(camera, target, 'orbit', value);
    expect(camera.position).toEqual(position);
  });

  it('uses optical zoom in walk mode without translating the camera or target', () => {
    const { camera, target } = view();
    const position = camera.position.clone(), originalTarget = target.clone();
    const projection = camera.projectionMatrix.clone();
    applyViewZoom(camera, target, 'walk', 100);
    expect(camera.zoom).toBe(3);
    expect(readViewZoom(camera, target, 'walk')).toEqual({ level: 100, percent: 300 });
    expect(camera.position).toEqual(position);
    expect(target).toEqual(originalTarget);
    expect(camera.projectionMatrix).not.toEqual(projection);
    applyViewZoom(camera, target, 'walk', 0);
    expect(camera.zoom).toBe(.5);
  });

  it('reflects wheel or restored camera distance, not a stale slider value', () => {
    const { camera, target } = view();
    expect(readViewZoom(camera, target, 'orbit').percent).toBe(100);
    camera.position.sub(target).multiplyScalar(.5).add(target);
    expect(readViewZoom(camera, target, 'orbit').percent).toBe(200);
  });

  it('safely restores old and malformed optional zoom values', () => {
    for (const value of [undefined, NaN, Infinity, 0, -1]) expect(restoredZoom(value)).toBe(1);
    expect(restoredZoom(2)).toBe(2);
    expect(restoredZoom(100)).toBe(3);
    expect(restoredZoom(.1)).toBe(.5);
  });
});

describe('screen-space arrow panning', () => {
  it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])('maps %s', key => {
    const result = panKeyDirection(key)!;
    expect(Math.hypot(result.x, result.y)).toBe(1);
  });
  it('leaves unrelated keys for the browser', () => expect(panKeyDirection('PageDown')).toBeNull());

  it.each([false, true])('translates both endpoints without rotation (plan=%s)', plan => {
    const { camera, target } = view(plan);
    const offset = camera.position.clone().sub(target);
    const originalTarget = target.clone();
    panView(camera, target, 1, 0, 800);
    expect(target.distanceTo(originalTarget)).toBeGreaterThan(0);
    expect(camera.position.clone().sub(target).distanceTo(offset)).toBeLessThan(1e-10);
    panView(camera, target, -1, 0, 800);
    expect(target.distanceTo(originalTarget)).toBeLessThan(1e-10);
    panView(camera, target, 0, 1, 800);
    if (plan) {
      expect(target.z).toBeLessThan(originalTarget.z);
      expect(target.y).toBeCloseTo(originalTarget.y);
    } else expect(target.y).toBeGreaterThan(originalTarget.y);
  });

  it('does not move when the viewport has no height', () => {
    const { camera, target } = view();
    const position = camera.position.clone();
    for (const height of [0, -1, NaN]) panView(camera, target, 1, 1, height);
    expect(camera.position).toEqual(position);
  });
});