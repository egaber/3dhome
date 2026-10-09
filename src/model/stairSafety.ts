import polygonClipping from 'polygon-clipping';
import { stairPartOrder, type StairGeometry, type StairPart } from './cad';
import { rotatePlanPoint } from './rotation';
import { stairPartCorners, type StairPortal } from './stairPath';
import type { Vec2 } from './types';

export interface StairEdge { a: Vec2; b: Vec2 }
export interface StairRailEdge extends StairEdge { elevationA: number; elevationB: number }
export const STAIR_RAIL_HEIGHT = 1.05;
export const STAIR_GLASS_HEIGHT = 1.1;
const EPSILON = 1e-5;

const direction = (from: Vec2, to: Vec2): Vec2 => {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return distance > EPSILON ? [(to[0] - from[0]) / distance, (to[1] - from[1]) / distance] : [0, -1];
};
const at = (edge: StairEdge, ratio: number): Vec2 => [edge.a[0] + (edge.b[0] - edge.a[0]) * ratio, edge.a[1] + (edge.b[1] - edge.a[1]) * ratio];
const length = (edge: StairEdge) => Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]);

export function stairPortals(geometry: StairGeometry): { entry: StairPortal; exit: StairPortal } {
  if (geometry.entry && geometry.exit) return { entry: geometry.entry, exit: geometry.exit };
  const parts = stairPartOrder(geometry).map(index => geometry.parts[index]);
  const portal = (part: StairPart, forward: Vec2, sign: number): StairPortal => {
    const center: Vec2 = [part.center[0] + forward[0] * part.depth / 2 * sign, part.center[1] + forward[1] * part.depth / 2 * sign];
    return { center, a: [center[0] - forward[1] * part.width / 2, center[1] + forward[0] * part.width / 2],
      b: [center[0] + forward[1] * part.width / 2, center[1] - forward[0] * part.width / 2] };
  };
  return { entry: portal(parts[0], direction(parts[0].center, parts[1].center), -1),
    exit: portal(parts.at(-1)!, direction(parts.at(-2)!.center, parts.at(-1)!.center), 1) };
}

function projection(edge: StairEdge, point: Vec2): number | null {
  const distance = length(edge);
  if (distance < EPSILON) return null;
  const horizontal = edge.b[0] - edge.a[0], vertical = edge.b[1] - edge.a[1];
  if (Math.abs(horizontal * (point[1] - edge.a[1]) - vertical * (point[0] - edge.a[0])) / distance > EPSILON) return null;
  return ((point[0] - edge.a[0]) * horizontal + (point[1] - edge.a[1]) * vertical) / (distance * distance);
}

function withoutPortals(edge: StairEdge, portals: StairPortal[]): StairEdge[] {
  let intervals = [[0, 1]];
  for (const portal of portals) {
    const start = projection(edge, portal.a), end = projection(edge, portal.b);
    if (start === null || end === null) continue;
    const low = Math.max(0, Math.min(start, end)), high = Math.min(1, Math.max(start, end));
    if (high <= low) continue;
    intervals = intervals.flatMap(([from, to]) => high <= from || low >= to ? [[from, to]]
      : [[from, Math.max(from, low)], [Math.min(to, high), to]].filter(([a, b]) => b > a));
  }
  return intervals.map(([from, to]) => ({ a: at(edge, from), b: at(edge, to) })).filter(segment => length(segment) > .03);
}

export function stairOpeningEdges(incoming: StairGeometry, outgoing?: StairGeometry | null): StairEdge[] {
  const portals = [stairPortals(incoming).exit, ...(outgoing ? [stairPortals(outgoing).entry] : [])];
  return incoming.footprint.flatMap((point, index) => withoutPortals({ a: point, b: incoming.footprint[(index + 1) % incoming.footprint.length] }, portals));
}

export function stairRailEdges(geometry: StairGeometry): StairRailEdge[] {
  const ordered = stairPartOrder(geometry).map(index => geometry.parts[index]);
  const corners = ordered.map(stairPartCorners);
  const outline = polygonClipping.union([corners[0]], ...corners.slice(1).map(ring => [ring]));
  const portals = Object.values(stairPortals(geometry));
  const heightAt = (point: Vec2) => Math.max(...ordered.flatMap((part, index) => {
    const local = rotatePlanPoint(point, part.center, -(part.rotation ?? 0));
    if (Math.abs(local[0] - part.center[0]) > part.width / 2 + EPSILON || Math.abs(local[1] - part.center[1]) > part.depth / 2 + EPSILON) return [];
    const top = part.bottom + part.height;
    if (part.kind !== 'tread') return [top];
    const next = ordered[index + 1], previous = ordered[index - 1];
    const forward = next?.kind === 'tread' ? direction(part.center, next.center)
      : previous?.kind === 'tread' ? direction(previous.center, part.center) : [0, -1];
    const along = ((point[0] - part.center[0]) * forward[0] + (point[1] - part.center[1]) * forward[1]) / part.depth;
    return [top + Math.max(-.5, Math.min(.5, along)) * geometry.rise / geometry.riserCount];
  }));
  return outline.flatMap(polygon => polygon.flatMap(ring => ring.slice(0, -1).flatMap((point, index) => {
    const edge = { a: point as Vec2, b: ring[index + 1] as Vec2 };
    const splits = [0, 1, ...corners.flat().map(corner => projection(edge, corner)).filter((value): value is number => value !== null && value > EPSILON && value < 1 - EPSILON)]
      .sort((left, right) => left - right);
    return splits.slice(1).flatMap((end, split) => withoutPortals({ a: at(edge, splits[split]), b: at(edge, end) }, portals))
      .map(segment => ({ ...segment, elevationA: heightAt(segment.a), elevationB: heightAt(segment.b) }))
      .filter(segment => Number.isFinite(segment.elevationA) && Number.isFinite(segment.elevationB));
  })));
}