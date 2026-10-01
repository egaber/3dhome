import type { Vec2 } from './types';

/** Positive angles turn clockwise in the X/Z plan, before dwelling transforms. */
export function rotatePlanPoint(point: Vec2, pivot: Vec2, degrees: number): Vec2 {
  const radians = degrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const x = point[0] - pivot[0], z = point[1] - pivot[1];
  return [pivot[0] + x * c - z * s, pivot[1] + x * s + z * c];
}

export function normalizeRotation(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}