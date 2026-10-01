import { describe, expect, it } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Triangle, Vector3 } from 'three';
import { buildWalkColliders } from './firstPersonNavigation';
import { capsuleBlocker, evaluateFreeWalk, evaluateSupportedWalk, resolveWalkPose, type WalkWorld, type WalkPose } from './supportedWalk';

const eyeHeight = 1.62;
function worldBox(width: number, height: number, depth: number, position = new Vector3(), rotation = 0): WalkWorld {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), new MeshBasicMaterial());
  mesh.position.copy(position); mesh.rotation.y = rotation;
  const colliders = buildWalkColliders([mesh]).map(c => ({ ...c, id: 'wall' }));
  mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose();
  return { revision: 1, colliders, supports: [], adjacency: {}, siteBounds: { minX: -20, maxX: 20, minY: -6, maxY: 15, minZ: -20, maxZ: 20 },
    floorLimits: [{ unit: 'south', floor: 'ground', elevation: 0, ceiling: 3.16 }] };
}
const pose = (eye = new Vector3(0, eyeHeight, 0)): WalkPose => ({ eye, mode: 'free', supportId: null, unit: 'south', floor: 'ground', stairId: null });
function topWorld(connected: boolean, overhang: boolean): WalkWorld {
  const w = worldBox(4, .1, 4, new Vector3(0, 5.3, 0));
  const top = (x: number, right: number) => [new Triangle(new Vector3(x, 3.4, -2), new Vector3(right, 3.4, 2), new Vector3(right, 3.4, -2)),
    new Triangle(new Vector3(x, 3.4, -2), new Vector3(x, 3.4, 2), new Vector3(right, 3.4, 2))];
  return { ...w, colliders: overhang ? w.colliders : [],
    supports: [
      { id: 'last', kind: 'tread', unit: 'south', floor: 'ground', stairId: 'flight', elevation: 3.4, worldTopTriangles: top(-2, 2), boundary: [], portals: [], corridorBoundary: [] },
      { id: 'first', kind: 'floor', unit: 'south', floor: 'first', elevation: 3.4, worldTopTriangles: top(2, 10), boundary: [], portals: [] },
    ], adjacency: connected ? { last: ['first'], first: ['last'] } : {},
    floorLimits: [...w.floorLimits, { unit: 'south', floor: 'first', elevation: 3.4, ceiling: 6.26 }] };
}
describe('continuous foot-to-head capsule', () => {
  it.each([0, .37, 1.2])('cannot tunnel through a .001m wall rotated %s', rotation => {
    const world = worldBox(.001, 5, 12, new Vector3(0, 2, 0), rotation);
    expect(capsuleBlocker(world, new Vector3(-4, eyeHeight, 0), new Vector3(4, eyeHeight, 0), eyeHeight)).toBe('wall');
  });
  it('checks face piercing, edges, head, lower body and closed-solid containment', () => {
    expect(capsuleBlocker(worldBox(8, 8, 8), new Vector3(0, 1.62, 0), new Vector3(0, 1.62, 0), eyeHeight)).toBe('wall');
    expect(capsuleBlocker(worldBox(.1, .15, .1, new Vector3(0, .1, 0)), new Vector3(-1, eyeHeight, 0), new Vector3(1, eyeHeight, 0), eyeHeight)).toBe('wall');
    expect(capsuleBlocker(worldBox(4, .05, 4, new Vector3(0, 1.73, 0)), new Vector3(), new Vector3(0, 1.62, 0), eyeHeight)).toBe('wall');
    expect(capsuleBlocker(worldBox(.001, 5, 2), new Vector3(-1, eyeHeight, 1.1), new Vector3(1, eyeHeight, 1.1), eyeHeight)).toBe('wall');
  });
  it('allows exact floor tangency and rejects a genuine floor penetration', () => {
    const w = worldBox(10, .24, 10, new Vector3(0, -.12, 0));
    expect(capsuleBlocker(w, new Vector3(0, eyeHeight, 0), new Vector3(1, eyeHeight, 1), eyeHeight)).toBeNull();
    expect(capsuleBlocker(w, new Vector3(0, eyeHeight - .01, 0), new Vector3(1, eyeHeight, 1), eyeHeight)).toBe('wall');
  });
  it('rejects oversized and nonfinite requests atomically before work', () => {
    const w = worldBox(1, 1, 1, new Vector3(10, 0, 10)), p = pose(), original = p.eye.clone();
    for (const motion of [new Vector3(NaN, 0, 0), new Vector3(Infinity, 0, 0), new Vector3(10000, 0, 0)]) {
      expect(evaluateSupportedWalk(w, p, motion, eyeHeight).accepted).toBe(false);
      expect(evaluateFreeWalk(w, p, motion, eyeHeight).accepted).toBe(false);
      expect(p.eye).toEqual(original);
    }
    expect(resolveWalkPose(w, new Vector3(NaN, 0, 0), eyeHeight)).toBeNull();
  });
  it('connected destination headroom never exempts a lower ceiling from the capsule sweep', () => {
    const w = topWorld(true, true), p = resolveWalkPose(w, new Vector3(0, 5.02, 0), eyeHeight)!;
    expect(p).not.toBeNull();
    const before = p.eye.clone();
    expect(evaluateFreeWalk(w, p, new Vector3(0, .16, 0), eyeHeight)).toMatchObject({ accepted: false, reason: 'collision', blocker: 'wall' });
    expect(resolveWalkPose(w, new Vector3(0, 5.18, 0), eyeHeight)).toBeNull();
    expect(p.eye).toEqual(before);
  });
  it('an unconnected upper floor cannot extend a stair free-height band', () => {
    const w = topWorld(false, false), p = resolveWalkPose(w, new Vector3(0, 5.02, 0), eyeHeight)!;
    expect(p).not.toBeNull();
    expect(evaluateFreeWalk(w, p, new Vector3(0, .08, 0), eyeHeight)).toMatchObject({ accepted: true, delta: new Vector3() });
    expect(resolveWalkPose(w, new Vector3(0, 5.10, 0), eyeHeight)).toBeNull();
  });
  it('free vertical uses full clearance, legacy limits and does not fall on release', () => {
    const w = worldBox(10, .24, 10, new Vector3(0, -.12, 0));
    const raised = evaluateFreeWalk(w, pose(), new Vector3(0, .4, 0), eyeHeight);
    expect(raised.accepted).toBe(true);
    if (!raised.accepted) return;
    const next = evaluateFreeWalk(w, raised.pose, new Vector3(.1, 0, 0), eyeHeight);
    expect(next.accepted).toBe(true);
    if (next.accepted) expect(next.pose.eye.y).toBeCloseTo(2.02);
    const high = evaluateFreeWalk(w, pose(), new Vector3(0, 7, 0), eyeHeight);
    expect(high.accepted).toBe(true);
    if (high.accepted) expect(high.pose.eye.y).toBeCloseTo(2.36);
    expect(evaluateFreeWalk(worldBox(.01, 4, 5), pose(new Vector3(-1, eyeHeight, 0)), new Vector3(2, .1, 0), eyeHeight).accepted).toBe(false);
  });
});