/** Deterministic, world-metric walking. No camera, DOM, model or mesh ownership. */
import { Box3, Ray, Triangle, Vector3 } from 'three';
import type { FloorId, UnitId } from '../model/types';
import type { WalkCollider } from './firstPersonNavigation';
import type { WalkBounds } from './walkNavigation';

export const WALK_RADIUS = .22;
export const WALK_SKIN = 1e-4;
const MAX_RISE = 1 / 3 + WALK_SKIN;
type Edge = readonly [Vector3, Vector3];
export type WalkPortal = Readonly<{ to: string; edges: readonly Edge[] }>;
export type WalkSupport = Readonly<{
  id: string; unit?: UnitId; floor?: FloorId; stairId?: string; partIndex?: number;
  kind: 'floor' | 'terrain' | 'well' | 'balcony' | 'tread' | 'landing' | 'entry-apron';
  worldTopTriangles: readonly Triangle[]; boundary: readonly Edge[];
  portals: readonly WalkPortal[]; elevation: number; corridorBoundary?: readonly Edge[];
}>;
export type WalkPose = Readonly<{ eye: Vector3; mode: 'supported' | 'free'; supportId: string | null;
  unit: UnitId; floor: FloorId; stairId: string | null }>;
export type PhysicalCollider = WalkCollider & Readonly<{ id: string }>;
export type FloorLimit = Readonly<{ unit: UnitId; floor: FloorId; elevation: number; ceiling: number }>;
export type WalkWorld = Readonly<{
  revision: number; colliders: readonly PhysicalCollider[]; supports: readonly WalkSupport[];
  adjacency: Readonly<Record<string, readonly string[]>>; siteBounds: WalkBounds; floorLimits: readonly FloorLimit[];
}>;
export type WalkResult = { accepted: true; delta: Vector3; pose: WalkPose }
  | { accepted: false; reason: 'collision' | 'headroom' | 'unsupported' | 'unavailable' | 'invalid' | 'budget'; blocker?: string };
const finite = (p: Vector3) => p.toArray().every(Number.isFinite);
const flat = (p: Vector3) => new Vector3(p.x, 0, p.z);
const rejected = (reason: Extract<WalkResult, { accepted: false }>['reason'], blocker?: string): WalkResult => ({ accepted: false, reason, ...(blocker ? { blocker } : {}) });

function segmentDistanceSq(p: Vector3, q: Vector3, a: Vector3, b: Vector3): number {
  const u = q.clone().sub(p), v = b.clone().sub(a), w = p.clone().sub(a);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  if (aa < 1e-20 && cc < 1e-20) return p.distanceToSquared(a);
  let s = aa < 1e-20 ? 0 : Math.max(0, Math.min(1, (bb * ee - cc * dd) / (aa * cc - bb * bb || 1)));
  let t = cc < 1e-20 ? 0 : (bb * s + ee) / cc;
  if (t < 0) { t = 0; s = aa ? Math.max(0, Math.min(1, -dd / aa)) : 0; }
  else if (t > 1) { t = 1; s = aa ? Math.max(0, Math.min(1, (bb - dd) / aa)) : 0; }
  return w.addScaledVector(u, s).addScaledVector(v, -t).lengthSq();
}

/** Includes face piercing, face interiors, all edges and vertices. */
function segmentTriangleSq(a: Vector3, b: Vector3, t: Triangle): number {
  const direction = b.clone().sub(a), length = direction.length();
  if (length > 1e-12) {
    const hit = new Ray(a, direction.divideScalar(length)).intersectTriangle(t.a, t.b, t.c, false, new Vector3());
    if (hit && hit.distanceTo(a) <= length + 1e-10) return 0;
  }
  return Math.min(a.distanceToSquared(t.closestPointToPoint(a, new Vector3())),
    b.distanceToSquared(t.closestPointToPoint(b, new Vector3())),
    ...([[t.a, t.b], [t.b, t.c], [t.c, t.a]] as Edge[]).map(([p, q]) => segmentDistanceSq(a, b, p, q)));
}
function trianglesDistanceSq(a: Triangle, b: Triangle): number {
  return Math.min(...([[a.a, a.b], [a.b, a.c], [a.c, a.a]] as Edge[]).map(([p, q]) => segmentTriangleSq(p, q, b)),
    ...([[b.a, b.b], [b.b, b.c], [b.c, b.a]] as Edge[]).map(([p, q]) => segmentTriangleSq(p, q, a)));
}
function axis(eye: Vector3, height: number): Edge {
  return [eye.clone().add(new Vector3(0, -height + WALK_RADIUS, 0)), eye.clone().add(new Vector3(0, .15 - WALK_RADIUS, 0))];
}
function contained(point: Vector3, collider: PhysicalCollider): boolean {
  if (!collider.bounds.containsPoint(point)) return false;
  const ray = new Ray(point, new Vector3(.781, .371, .502).normalize()), hits: number[] = [];
  for (const t of collider.triangles) {
    const hit = ray.intersectTriangle(t.a, t.b, t.c, false, new Vector3());
    if (hit) hits.push(hit.distanceTo(point));
  }
  hits.sort((a, b) => a - b);
  return hits.filter((d, i) => d > WALK_SKIN && (!i || d - hits[i - 1] > WALK_SKIN)).length % 2 === 1;
}

/** An exact linear capsule sweep: the swept axis is a parallelogram, expanded
 * by the radius. No point sampling or support-mesh exemption, even at tangency. */
export function capsuleBlocker(world: WalkWorld, start: Vector3, end: Vector3, height: number, checkContainment = true): string | null {
  const [a, b] = axis(start, height), [c, d] = axis(end, height);
  const bounds = new Box3().setFromPoints([a, b, c, d]).expandByScalar(WALK_RADIUS);
  const sweep1 = new Triangle(a, b, d), sweep2 = new Triangle(a, d, c);
  const moving = start.distanceToSquared(end) > 1e-18;
  const r2 = (WALK_RADIUS - WALK_SKIN) ** 2;
  for (const collider of world.colliders) {
    if (!bounds.intersectsBox(collider.bounds)) continue;
    if (checkContainment && contained(a.clone().lerp(b, .5), collider)) return collider.id;
    for (const t of collider.triangles) {
      // Separating plane is especially important for resolved floor contacts.
      const normal = t.getNormal(new Vector3());
      const distances = [a, b, c, d].map(p => normal.dot(p.clone().sub(t.a)));
      if (Math.min(...distances) >= WALK_RADIUS - WALK_SKIN || Math.max(...distances) <= -WALK_RADIUS + WALK_SKIN) continue;
      if ((moving && sweep1.getArea() > 1e-12
        ? Math.min(trianglesDistanceSq(sweep1, t), trianglesDistanceSq(sweep2, t))
        : Math.min(segmentTriangleSq(a, b, t), segmentTriangleSq(a, d, t), segmentTriangleSq(c, d, t))) < r2) return collider.id;
    }
  }
  return null;
}

export function supportContains(s: WalkSupport, point: Vector3): boolean {
  const p = new Vector3(point.x, s.elevation, point.z);
  return s.worldTopTriangles.some(t => t.closestPointToPoint(p, new Vector3()).distanceToSquared(p) < WALK_SKIN ** 2);
}
function distanceToSupport(s: WalkSupport, p: Vector3): number {
  const q = new Vector3(p.x, s.elevation, p.z);
  return Math.sqrt(Math.min(...s.worldTopTriangles.map(t => t.closestPointToPoint(q, new Vector3()).distanceToSquared(q))));
}
function neighbors(world: Pick<WalkWorld, 'supports' | 'adjacency'>, s: WalkSupport): WalkSupport[] {
  return world.supports.filter(other => world.adjacency[s.id]?.includes(other.id));
}
export function walkContactSupports(world: Pick<WalkWorld, 'supports' | 'adjacency'>, s: WalkSupport): WalkSupport[] {
  // Two neighboring short treads may touch the cap at once. Never cross tracks.
  const next = neighbors(world, s);
  return [s, ...next, ...next.flatMap(n => n.stairId && (!s.stairId || n.stairId === s.stairId)
    ? neighbors(world, n).filter(t => !t.stairId || t.stairId === n.stairId) : [])];
}
function contactHeight(world: WalkWorld, s: WalkSupport, p: Vector3): number {
  let result = s.elevation;
  for (const n of walkContactSupports(world, s)) {
    const distance = distanceToSupport(n, p);
    if (distance < WALK_RADIUS && n.elevation >= s.elevation && n.elevation - s.elevation <= MAX_RISE * 2) {
      result = Math.max(result, n.elevation - WALK_RADIUS + Math.sqrt(Math.max(0, WALK_RADIUS ** 2 - distance ** 2)));
    }
  }
  return result;
}
function inSite(world: WalkWorld, p: Vector3): boolean {
  const b = world.siteBounds, r = WALK_RADIUS;
  return p.x >= b.minX + r && p.x <= b.maxX - r && p.z >= b.minZ + r && p.z <= b.maxZ - r;
}
function context(s: WalkSupport, eye: Vector3, mode: WalkPose['mode'], previous?: WalkPose): WalkPose {
  return { eye: eye.clone(), mode, supportId: s.id, unit: s.unit ?? previous?.unit ?? 'north', floor: s.floor ?? 'ground', stairId: s.stairId ?? null };
}

/** Reconciliation is contact based, never nearest-floor snapping. A stale
 * attachment must remain locally compatible; invalid bookmarks stay untouched. */
export function resolveWalkPose(world: WalkWorld, eye: Vector3, eyeHeight: number, previous?: WalkPose): WalkPose | null {
  if (!finite(eye) || !Number.isFinite(eyeHeight) || eyeHeight < .5 || eyeHeight > 3 || !inSite(world, eye)
    || capsuleBlocker(world, eye, eye, eyeHeight)) return null;
  const supports = world.supports.filter(s => supportContains(s, eye));
  const ordered = [...supports].sort((a, b) => Number(b.id === previous?.supportId) - Number(a.id === previous?.supportId));
  for (const s of ordered) {
    if (Math.abs(eye.y - eyeHeight - contactHeight(world, s, eye)) < WALK_SKIN * 3 && lateralClear(world, s, eye)) return context(s, eye, 'supported', previous);
  }
  if (previous?.mode === 'supported') return null;
  for (const s of ordered.sort((a, b) => b.elevation - a.elevation)) {
    if (previous?.supportId && s.id !== previous.supportId) continue;
    const limit = freeLimits(world, context(s, eye, 'free', previous), eyeHeight);
    if (eye.y > s.elevation + eyeHeight && limit && eye.y <= limit[1] + WALK_SKIN) return context(s, eye, 'free', previous);
  }
  return null;
}

/** Coverage of the entire horizontal segment by actual triangle projections. */
function covered(supports: readonly WalkSupport[], a: Vector3, b: Vector3): boolean {
  const intervals: [number, number][] = [];
  for (const s of supports) for (const triangle of s.worldTopTriangles) {
    let low = 0, high = 1;
    const points = [flat(triangle.a), flat(triangle.b), flat(triangle.c)];
    const cross = (p: Vector3, q: Vector3) => p.x * q.z - p.z * q.x;
    const sign = Math.sign(cross(points[1].clone().sub(points[0]), points[2].clone().sub(points[0])));
    for (let i = 0; i < 3; i++) {
      const edge = points[(i + 1) % 3].clone().sub(points[i]);
      const start = sign * cross(edge, flat(a).sub(points[i])), change = sign * cross(edge, flat(b).sub(flat(a)));
      const skin = WALK_SKIN * edge.length();
      if (Math.abs(change) < 1e-12) { if (start < -skin) high = -1; }
      else if (change > 0) low = Math.max(low, (-skin - start) / change);
      else high = Math.min(high, (-skin - start) / change);
    }
    if (low <= high) intervals.push([low, high]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let end = 0;
  for (const [lo, hi] of intervals) { if (lo > end + 1e-6) break; end = Math.max(end, hi); }
  return end >= 1 - 1e-6;
}
function lateralClear(world: WalkWorld, s: WalkSupport, p: Vector3, start = p): boolean {
  if (!s.stairId) return true;
  if (!s.corridorBoundary || !walkContactSupports(world, s).some(n => supportContains(n, p))) return false;
  const point = flat(p);
  return s.corridorBoundary.every(([a, b]) => segmentDistanceSq(flat(start), point, flat(a), flat(b)) >= (WALK_RADIUS - WALK_SKIN) ** 2);
}

export function evaluateSupportedWalk(world: WalkWorld, pose: WalkPose, motion: Vector3, eyeHeight: number): WalkResult {
  if (!finite(motion) || !finite(pose.eye) || Math.abs(motion.y) > WALK_SKIN || !Number.isFinite(eyeHeight)) return rejected('invalid');
  if (motion.length() > 8) return rejected('budget');
  if (pose.mode === 'free') return evaluateFreeWalk(world, pose, motion, eyeHeight);
  const initialSupport = world.supports.find(s => s.id === pose.supportId);
  if (!initialSupport) return rejected('unavailable');
  let support: WalkSupport = initialSupport;
  if (!resolveWalkPose(world, pose.eye, eyeHeight, pose)) return rejected('invalid');
  const count = Math.max(1, Math.ceil(motion.length() / .025));
  let eye = pose.eye.clone();
  for (let i = 1; i <= count; i++) {
    const next = pose.eye.clone().addScaledVector(motion, i / count);
    if (!inSite(world, next)) return rejected('unsupported');
    const adjacent = neighbors(world, support);
    const candidates = adjacent.filter(s => supportContains(s, next)
      && Math.abs(s.elevation - support.elevation) <= MAX_RISE && covered([support, s], eye, next));
    const candidate: WalkSupport | undefined = candidates.find(s => s.elevation > support.elevation + WALK_SKIN)
      ?? (supportContains(support, next) ? support : candidates[0]);
    if (!candidate || !covered([support, candidate], eye, next) || !lateralClear(world, candidate, next, eye)) return rejected('unsupported');
    next.y = contactHeight(world, candidate, next) + eyeHeight;
    let high = Math.max(eye.y, next.y);
    // Negotiate before the eye crosses the riser. The cap may contact an edge;
    // longitudinal portals never demand a full .44m stance on a short tread.
    for (const s of walkContactSupports(world, support)) {
      if (s.elevation - support.elevation > MAX_RISE * 2) continue;
      if (distanceToSupport(s, next) < WALK_RADIUS || distanceToSupport(s, eye) < WALK_RADIUS) high = Math.max(high, s.elevation + eyeHeight);
    }
    const raised = eye.clone(); raised.y = high;
    const across = next.clone(); across.y = high;
    for (const [a, b] of [[eye, raised], [raised, across], [across, next]]) {
      const blocker = capsuleBlocker(world, a, b, eyeHeight, false);
      if (blocker) return rejected('collision', blocker);
    }
    eye = next; support = candidate;
  }
  return { accepted: true, delta: eye.clone().sub(pose.eye), pose: context(support, eye, 'supported', pose) };
}

function freeLimits(world: WalkWorld, pose: WalkPose, eyeHeight: number): readonly [number, number] | null {
  const support = world.supports.find(s => s.id === pose.supportId);
  const limit = world.floorLimits.find(f => f.unit === pose.unit && f.floor === pose.floor);
  if (!limit) return null;
  const stairs = support && (support.stairId && distanceToSupport(support, pose.eye) < WALK_RADIUS ? [support]
    : neighbors(world, support).filter(s => s.stairId && distanceToSupport(s, pose.eye) < WALK_RADIUS));
  if (stairs?.length) {
    const track = world.supports.filter(s => s.stairId === stairs[0].stairId);
    const top = Math.max(...track.map(s => s.elevation));
    // The last tread is not a ceiling. Use only its physically connected
    // destination floor's permitted band, never an unrelated upper storey.
    const destinations = track.filter(s => Math.abs(s.elevation - top) < WALK_SKIN)
      .flatMap(s => neighbors(world, s)).filter(s => !s.stairId && s.unit === stairs[0].unit && Math.abs(s.elevation - top) < WALK_SKIN);
    const ceilings = destinations.flatMap(s => world.floorLimits
      .filter(f => f.unit === s.unit && f.floor === s.floor).map(f => f.ceiling - .8));
    return [Math.min(...track.map(s => s.elevation)) - MAX_RISE + eyeHeight, Math.max(top + eyeHeight, ...ceilings)];
  }
  return [limit.elevation + eyeHeight, Math.max(limit.elevation + eyeHeight, limit.ceiling - .8)];
}
export function evaluateFreeWalk(world: WalkWorld, pose: WalkPose, motion: Vector3, eyeHeight: number): WalkResult {
  if (!finite(motion) || !finite(pose.eye) || !Number.isFinite(eyeHeight) || eyeHeight < .5 || eyeHeight > 3) return rejected('invalid');
  if (motion.length() > 8) return rejected('budget');
  const limits = freeLimits(world, pose, eyeHeight);
  if (!limits) return rejected('unavailable');
  const next = pose.eye.clone().add(motion);
  if (!inSite(world, next)) return rejected('unsupported');
  next.y = Math.max(limits[0], Math.min(limits[1], next.y));
  // A free bookmark above the legacy band must not snap down on key release.
  if (!motion.y && Math.abs(next.y - pose.eye.y) > WALK_SKIN) return rejected('unsupported');
  const blocker = capsuleBlocker(world, pose.eye, next, eyeHeight);
  if (blocker) return rejected('collision', blocker);
  const local = resolveWalkPose(world, next, eyeHeight);
  const nextPose: WalkPose = local ? { ...local, mode: motion.y ? 'free' : local.mode } : { ...pose, eye: next, mode: 'free' };
  const nextLimits = freeLimits(world, nextPose, eyeHeight);
  if (!nextLimits || next.y < nextLimits[0] - WALK_SKIN || next.y > nextLimits[1] + WALK_SKIN) return rejected('unsupported');
  return { accepted: true, delta: next.clone().sub(pose.eye), pose: nextPose };
}