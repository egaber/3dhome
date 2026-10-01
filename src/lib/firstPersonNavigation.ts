import { Box3, Euler, MathUtils, Mesh, PerspectiveCamera, Triangle, Vector3 } from 'three';
import { isWithinBounds, type WalkBounds } from './walkNavigation';

export type WalkCollider = { bounds: Box3; triangles: Triangle[] };
const RADIUS = .22;
const HALF_HEIGHT = .72;

/** Snapshot actual world-space surfaces once per architecture rebuild. A wall's
 * bounding box alone fills doorways and the empty space beside rotated walls. */
export function buildWalkColliders(meshes: readonly Mesh[]): WalkCollider[] {
  return meshes.map(mesh => {
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    const indices = geometry.getIndex();
    const count = indices?.count ?? positions.count;
    const triangles: Triangle[] = [];
    const bounds = new Box3();
    const point = (index: number) => new Vector3().fromBufferAttribute(positions, indices ? indices.getX(index) : index).applyMatrix4(mesh.matrixWorld);
    for (let index = 0; index + 2 < count; index += 3) {
      const triangle = new Triangle(point(index), point(index + 1), point(index + 2));
      triangles.push(triangle);
      bounds.expandByPoint(triangle.a).expandByPoint(triangle.b).expandByPoint(triangle.c);
    }
    return { bounds, triangles };
  });
}

export function walkPositionBlocked(position: Vector3, colliders: readonly WalkCollider[]): boolean {
  const halfSize = new Vector3(RADIUS, HALF_HEIGHT, RADIUS);
  const volume = new Box3(position.clone().sub(halfSize), position.clone().add(halfSize));
  return colliders.some(collider => volume.intersectsBox(collider.bounds)
    && collider.triangles.some(triangle => volume.intersectsTriangle(triangle)));
}

/** Swept steps preserve closed walls/doors, but permit real openings. All-or-nothing
 * movement keeps camera and target in sync, even at floor/ceiling boundaries. */
export function translateWalk(camera: PerspectiveCamera, target: Vector3, motion: Vector3, bounds: WalkBounds, colliders: readonly WalkCollider[]): boolean {
  if (!motion.toArray().every(Number.isFinite) || motion.lengthSq() < 1e-12) return false;
  const start = camera.position.clone();
  const candidate = start.clone().add(motion);
  if (!isWithinBounds(candidate, bounds, RADIUS)) return false;
  candidate.y = MathUtils.clamp(candidate.y, bounds.minY, bounds.maxY);
  const samples = Math.max(1, Math.ceil(start.distanceTo(candidate) / .1));
  for (let index = 1; index <= samples; index++) {
    if (walkPositionBlocked(start.clone().lerp(candidate, index / samples), colliders)) return false;
  }
  target.add(candidate.clone().sub(start));
  camera.position.copy(candidate);
  camera.lookAt(target);
  return true;
}

/** FPS look rotates the direction around the eye, never the eye around a target. */
export function lookWalk(camera: PerspectiveCamera, target: Vector3, yaw: number, pitch = 0): void {
  camera.lookAt(target);
  const angles = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  angles.y += yaw;
  angles.x = MathUtils.clamp(angles.x + pitch, -Math.PI * .47, Math.PI * .47);
  angles.z = 0;
  const distance = Math.max(1, camera.position.distanceTo(target));
  camera.quaternion.setFromEuler(angles);
  target.copy(camera.position).add(new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(distance));
}