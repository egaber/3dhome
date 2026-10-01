import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { geometryContext } from './cadEditor';
import type { FloorId, SimulationState, UnitId } from '../model/types';
import type { Vec3 } from '../model/cad';

export interface VisualRayOptions { clippingPlanes?: THREE.Plane[]; localClippingEnabled?: boolean }
export function ancestorsVisible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
export function visibleSurface(hit: THREE.Intersection, options: VisualRayOptions = {}): boolean {
  if (!ancestorsVisible(hit.object) || !(hit.object instanceof THREE.Mesh)) return false;
  const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face?.materialIndex ?? 0] : hit.object.material;
  if (!material?.visible || (material.transparent && material.opacity <= 0)) return false;
  const clipped = (plane: THREE.Plane) => plane.distanceToPoint(hit.point) < -1e-7;
  if (options.clippingPlanes?.some(clipped)) return false;
  const planes = options.localClippingEnabled ? material.clippingPlanes : null;
  return !planes?.length || !(material.clipIntersection ? planes.every(clipped) : planes.some(clipped));
}
/** Dedicated ray only: scene occlusion/shadow rays may leave near/far mutated.
 * Targets are actual meshes, NOT recursive decorations or reference overlays. */
export function raycastVisible(ray: THREE.Raycaster, pointer: THREE.Vector2, camera: THREE.Camera,
  targets: THREE.Mesh[], options: VisualRayOptions = {}): THREE.Intersection | undefined {
  ray.near = 0; ray.far = Infinity;
  if (!(camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera)) return undefined;
  camera.updateWorldMatrix(true, false);
  for (const target of targets) target.updateWorldMatrix(true, false);
  ray.setFromCamera(pointer, camera);
  const cameraPoint = new THREE.Vector3();
  return ray.intersectObjects(targets, false).find(hit => {
    // Render clip planes bound camera-space depth, not distance along oblique rays.
    const depth = -cameraPoint.copy(hit.point).applyMatrix4(camera.matrixWorldInverse).z;
    return depth >= camera.near && depth <= camera.far && visibleSurface(hit, options);
  });
}
export function numericWorldPoint(values: readonly number[]): Vec3 {
  if (values.length !== 3 || !values.every(v => Number.isFinite(v) && Math.abs(v) <= 1000)) {
    throw new Error('יש להזין שלוש קואורדינטות עולם סופיות בין ‎−1000 ל־1000 מטר; המדידה הקודמת לא שונתה.');
  }
  return [values[0], values[1], values[2]];
}
export function measurementContext(state: SimulationState, unit: UnitId, floor: FloorId, revision = 0): string {
  // Camera, time, theme, rendering quality and reference images are NOT geometry.
  return JSON.stringify([geometryContext(state, unit, floor), state.neighbors, state.vehicles,
    state.view.isolateFloor, state.view.cutaway, revision]);
}
export type SceneSelection = { type: 'opening' | 'furniture' | 'stair' | 'wall' | 'building' | 'neighbor' | 'floor' | 'ceiling'; id: string; unit?: UnitId };
export function sceneSelection(object: THREE.Object3D, normal?: THREE.Vector3): SceneSelection | null {
  const chain: THREE.Object3D[] = [];
  for (let node: THREE.Object3D | null = object; node; node = node.parent) chain.push(node);
  const unit = chain.map(n => n.userData.unit).find(v => v === 'north' || v === 'south') as UnitId | undefined;
  for (const [type, key] of [['opening', 'openingId'], ['furniture', 'furnitureId'], ['stair', 'stairId'], ['wall', 'wallId'], ['neighbor', 'neighborId']] as const) {
    const owner = chain.find(n => typeof n.userData[key] === 'string');
    if (owner) return { type, id: owner.userData[key] as string, unit };
  }
  if (normal?.y !== undefined && normal.y < -.5 && object.userData.ceilingTarget) return { type: 'ceiling', id: object.userData.ceilingTarget, unit };
  if (object.userData.floorTarget) return { type: 'floor', id: object.userData.floorTarget, unit };
  return unit ? { type: 'building', id: unit, unit } : null;
}
export function selectionBounds(targets: THREE.Mesh[], selection: SceneSelection): THREE.Box3 {
  const box = new THREE.Box3();
  for (const mesh of targets) {
    const item = sceneSelection(mesh);
    const matches = selection.type === 'building' ? item?.unit === selection.id : selection.type === 'ceiling' ? mesh.userData.ceilingTarget === selection.id : item?.type === selection.type && item.id === selection.id;
    if (!matches || !ancestorsVisible(mesh)) continue;
    mesh.updateWorldMatrix(true, false); mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  return box;
}
export function measurementGraphics(points: Vec3[], color: THREE.ColorRepresentation): THREE.Group {
  const group = new THREE.Group(); group.name = 'Transient world measurement';
  for (const point of points) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
    const viewport = new THREE.Vector2(), cameraPoint = new THREE.Vector3();
    // Annotation radius is 5 CSS pixels at the actual point depth, including zoom.
    // The world endpoint never moves and remains outside scene pick/blocker targets.
    marker.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getSize(viewport);
      cameraPoint.copy(marker.position).applyMatrix4(camera.matrixWorldInverse);
      const depth = camera instanceof THREE.PerspectiveCamera ? Math.abs(cameraPoint.z) : 1;
      marker.scale.setScalar(10 * depth / Math.max(1e-6, viewport.y * camera.projectionMatrix.elements[5]));
      marker.updateMatrixWorld();
    };
    marker.position.fromArray(point); marker.renderOrder = 1001; group.add(marker);
  }
  if (points.length === 2) {
    const line = new Line2(new LineGeometry().setPositions(points.flat()), new LineMaterial({ color, linewidth: 2.5, depthTest: false, depthWrite: false }));
    line.renderOrder = 1000; group.add(line);
  }
  return group;
}
export function disposeMeasurementGraphics(group: THREE.Group): void {
  group.removeFromParent();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
  group.clear();
}