import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merge owned static geometry without dropping triangles; optional metadata keeps item picking intact. */
export function batchDecorations(root: THREE.Group, itemMeta?: Record<string, unknown>, retainPickTargets = false): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map<string, { material: THREE.Material; meshes: THREE.Mesh[]; meta: Record<string, unknown> }>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || object instanceof THREE.SkinnedMesh
      || Array.isArray(object.material) || object.userData.neighborId || Object.keys(object.geometry.morphAttributes).length) return;
    let owner: THREE.Object3D | null = object, unit: unknown, floor: unknown, displayFloor: unknown;
    while (owner && owner !== root) {
      unit ??= owner.userData.unit; floor ??= owner.userData.floor; displayFloor ??= owner.userData.displayFloor; owner = owner.parent;
    }
    const meta = itemMeta ?? { unit, floor, ...(displayFloor ? { displayFloor } : {}) };
    const geometry: THREE.BufferGeometry = object.geometry;
    const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized}`).sort().join(',');
    const key = `${meta.unit}:${meta.floor}:${meta.displayFloor}:${object.material.uuid}:${object.castShadow}:${object.receiveShadow}:${attributes}`;
    const batch = batches.get(key);
    if (batch) batch.meshes.push(object);
    else batches.set(key, { material: object.material, meshes: [object], meta });
  });
  for (const batch of batches.values()) {
    if (batch.meshes.length < 2) continue;
    const geometries = batch.meshes.map(object => {
      const source = object.geometry;
      const geometry = source.index ? source.toNonIndexed() : source.clone();
      geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    if (!geometry) throw new Error('Unable to batch showroom decoration geometry.');
    const merged = new THREE.Mesh(geometry, batch.material);
    merged.userData = batch.meta; merged.name = 'Batched interior details';
    merged.castShadow = batch.meshes[0].castShadow; merged.receiveShadow = batch.meshes[0].receiveShadow;
    for (const object of batch.meshes) {
      if (retainPickTargets) object.layers.set(1);
      else { object.geometry.dispose(); object.removeFromParent(); }
    }
    root.add(merged);
  }
  const meshes: THREE.Mesh[] = [];
  root.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
  return meshes;
}
