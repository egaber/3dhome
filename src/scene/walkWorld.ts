import { Triangle, Vector3 } from 'three';
import polygonClipping from 'polygon-clipping';
import type { Polygon } from 'polygon-clipping';
import { buildWalkColliders } from '../lib/firstPersonNavigation';
import { supportContains, walkContactSupports, WALK_SKIN, type WalkSupport, type WalkWorld, type FloorLimit } from '../lib/supportedWalk';
import { getFloorLevels, resolveStairGeometry } from '../model/cad';
import { SITE, trueWorldPoint } from '../model/plans';
import type { SimulationState } from '../model/types';
import type { Architecture, MeshMeta } from './architecture';

let revision = 0;
type MutableSupport = Omit<WalkSupport, 'portals' | 'corridorBoundary'> & { portals: { to: string; edges: [Vector3, Vector3][] }[]; corridorBoundary?: [Vector3, Vector3][] };
const pointKey = (v: Vector3) => v.toArray().map(n => Math.round(n * 1e5)).join(',');
function boundary(triangles: Triangle[]): [Vector3, Vector3][] {
  const edges = new Map<string, [Vector3, Vector3] | null>();
  for (const t of triangles) for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
    const key = [pointKey(a), pointKey(b)].sort().join('/');
    edges.set(key, edges.has(key) ? null : [a.clone(), b.clone()]);
  }
  return [...edges.values()].filter((e): e is [Vector3, Vector3] => e !== null);
}
function join(a: MutableSupport, b: MutableSupport): void {
  // Physical projected overlap/shared boundary is necessary in addition to the
  // logical order. Triangle clipping preserves slab holes and concave outlines.
  const edges: [Vector3, Vector3][] = [];
  for (const [p, q] of a.boundary) {
    const samples = [p, q, p.clone().lerp(q, .5)];
    if (samples.some(v => supportContains(b, v))) edges.push([p.clone(), q.clone()]);
  }
  for (const [p, q] of b.boundary) if ([p, q, p.clone().lerp(q, .5)].some(v => supportContains(a, v))) edges.push([p.clone(), q.clone()]);
  if (!edges.length) return;
  a.portals.push({ to: b.id, edges });
  b.portals.push({ to: a.id, edges: edges.map(([a, b]) => [a.clone(), b.clone()]) });
}

/** One owned immutable-by-contract snapshot. No meshes/materials/state references
 * survive disposal. Visual cutaway/isolation does not remove physical blockers. */
export function buildWalkWorld(state: SimulationState, architecture: Architecture): WalkWorld | null {
  if (!Number.isFinite(state.northBearing)) return null;
  architecture.group.updateWorldMatrix(true, true);
  const meshes = [...new Set([...architecture.blockers, ...architecture.measurementTargets.filter(m => m.userData.role === 'balcony')])];
  const snapshots = buildWalkColliders(meshes);
  if (snapshots.some(c => c.triangles.some(t => [...t.a.toArray(), ...t.b.toArray(), ...t.c.toArray()].some(n => !Number.isFinite(n))))) return null;
  const supports: MutableSupport[] = [];
  const identities = new Map<string, number>();
  const colliders = snapshots.map((snapshot, index) => {
    const meta = meshes[index].userData as MeshMeta;
    const identity = `${meta.role ?? 'solid'}:${meta.unit ?? 'site'}:${meta.floor ?? ''}:${meta.stairId ?? meta.openingId ?? meta.wallId ?? ''}`;
    const occurrence = identities.get(identity) ?? 0; identities.set(identity, occurrence + 1);
    const id = `${identity}:${meta.partIndex ?? occurrence}`;
    const eligible = ['slab', 'terrain', 'well', 'balcony', 'stair'].includes(meta.role ?? '');
    const tops = eligible ? snapshot.triangles.filter(t => t.getNormal(new Vector3()).y > .99999 && t.getArea() > 1e-10) : [];
    if (tops.length && (meta.role !== 'stair' || meta.partIndex !== undefined && meta.partKind)) {
      supports.push({ id, unit: meta.unit, floor: meta.floor, stairId: meta.stairId, partIndex: meta.partIndex,
        kind: meta.role === 'stair' ? meta.partKind! : meta.role === 'slab' ? 'floor' : meta.role as 'terrain' | 'well' | 'balcony',
        worldTopTriangles: tops.map(t => t.clone()), boundary: boundary(tops), portals: [], elevation: tops[0].a.y });
    }
    return { ...snapshot, id };
  });
  const floorLimits: FloorLimit[] = [];
  for (const unit of ['north', 'south'] as const) {
    for (const floor of ['basement', 'ground', 'first'] as const) {
      const levels = getFloorLevels(floor, state.buildings[unit]);
      if (levels) floorLimits.push({ unit, floor, elevation: levels.elevation, ceiling: levels.ceilingElevation });
    }
    for (const from of ['basement', 'ground'] as const) {
      const geometry = resolveStairGeometry(state, unit, from);
      if (!geometry) continue;
      const id = `stair-${unit}-${from}`;
      const order = geometry.layout === 'u-shaped' ? [...(geometry.parts.length > 19 ? [19] : []), ...Array.from({ length: 9 }, (_, i) => i), 18, ...Array.from({ length: 9 }, (_, i) => i + 9)] : Array.from({ length: 18 }, (_, i) => i);
      const track = order.map(index => supports.find(s => s.stairId === id && s.partIndex === index));
      if (track.some(s => !s)) continue;
      for (let i = 1; i < track.length; i++) join(track[i - 1]!, track[i]!);
      const first = track[0]!, last = track.at(-1)!;
      for (const s of supports.filter(s => !s.stairId && s.unit === unit)) {
        if (s.floor === from && Math.abs(first.elevation - s.elevation) <= 1 / 3 + WALK_SKIN) join(s, first);
        if (s.floor === geometry.toFloor && Math.abs(last.elevation - s.elevation) < WALK_SKIN) join(last, s);
      }
    }
  }
  const floors = supports.filter(s => !s.stairId);
  for (let i = 0; i < floors.length; i++) for (let j = i + 1; j < floors.length; j++) {
    if (Math.abs(floors[i].elevation - floors[j].elevation) <= .025) join(floors[i], floors[j]);
  }
  const adjacency = Object.fromEntries(supports.map(s => [s.id, s.portals.map(p => p.to)]));
  for (const s of supports.filter(s => s.stairId)) {
    const polygons: Polygon[] = walkContactSupports({ supports, adjacency }, s).flatMap(n => n.worldTopTriangles.map(t => {
      const points = [t.a, t.b, t.c].map(p => new Vector3(p.x, 0, p.z));
      const lengths = points.map((_, i) => points[(i + 1) % 3].distanceTo(points[(i + 2) % 3]));
      const perimeter = lengths.reduce((a, b) => a + b, 0);
      const center = points.reduce((p, q, i) => p.addScaledVector(q, lengths[i] / perimeter), new Vector3());
      const inradius = 2 * t.getArea() / perimeter;
      // Float32 part edges differ by micrometres after affine transforms.
      // Weld only within contact skin, not a gameplay gap tolerance.
      return [points.map(p => p.sub(center).multiplyScalar(1 + WALK_SKIN / 4 / inradius).add(center)).map(p => [Math.round(p.x * 1e6), Math.round(p.z * 1e6)] as [number, number])];
    }));
    if (!polygons.length) continue;
    try {
      const union = polygonClipping.union(polygons[0], ...polygons.slice(1));
      s.corridorBoundary = union.flatMap(p => p.flatMap(ring => ring.slice(1).map((p, i) =>
        [new Vector3(ring[i][0] / 1e6, 0, ring[i][1] / 1e6), new Vector3(p[0] / 1e6, 0, p[1] / 1e6)] as [Vector3, Vector3])));
    } catch {
      // A degenerate corridor is unavailable, not permission to omit a blocker
      // or prevent navigation on unrelated valid stairs/floors.
      s.corridorBoundary = undefined;
    }
  }
  const corners = [[SITE.left, SITE.back], [SITE.right, SITE.back], [SITE.right, SITE.front], [SITE.left, SITE.front]]
    .map(([x, z]) => trueWorldPoint([x, z], state));
  return { revision: ++revision, colliders, supports, floorLimits,
    adjacency,
    siteBounds: { minX: Math.min(...corners.map(p => p[0])) + .2, maxX: Math.max(...corners.map(p => p[0])) - .2,
      minZ: Math.min(...corners.map(p => p[1])) + .2, maxZ: Math.max(...corners.map(p => p[1])) - .2, minY: -6, maxY: 15 } };
}