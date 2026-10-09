import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { batchDecorations } from './batchDecorations';

describe('lossless interior batching', () => {
  it('preserves bounds, triangle count and floor ownership while reducing draw calls', () => {
    const root = new THREE.Group(), floor = new THREE.Group(), material = new THREE.MeshStandardMaterial();
    floor.userData = { unit: 'north', floor: 'ground' }; floor.position.set(4, 3, -2); floor.rotation.y = .6; root.add(floor);
    let triangles = 0;
    for (let i = 0; i < 8; i++) {
      const object = new THREE.Mesh(new THREE.BoxGeometry(.2, .4, .6), material); object.position.set(i * .3, i * .1, 0); object.castShadow = object.receiveShadow = true;
      floor.add(object); triangles += object.geometry.index!.count / 3;
    }
    const bounds = new THREE.Box3().setFromObject(root);
    batchDecorations(root);
    const meshes: THREE.Mesh[] = []; root.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes).toHaveLength(1); expect(meshes[0].geometry.getAttribute('position').count / 3).toBe(triangles);
    expect(meshes[0].userData).toEqual({ unit: 'north', floor: 'ground' });
    const next = new THREE.Box3().setFromObject(root);
    expect(next.min.distanceTo(bounds.min)).toBeLessThan(1e-6); expect(next.max.distanceTo(bounds.max)).toBeLessThan(1e-6);
    meshes[0].geometry.dispose(); material.dispose();
  });
  it('retains original selectable geometry on its pick layer while rendering equivalent merged triangles', () => {
    const root = new THREE.Group(), material = new THREE.MeshStandardMaterial();
    const targets = [0, 2].map(x => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.userData = { unit: 'north', floor: 'ground', furnitureId: `chair-${x}` };
      mesh.position.x = x; root.add(mesh); return mesh;
    });
    batchDecorations(root, undefined, true);
    expect(targets.every(mesh => mesh.parent === root && mesh.layers.mask === 2)).toBe(true);
    const rendered: THREE.Mesh[] = [];
    root.traverse(object => { if (object instanceof THREE.Mesh && object.layers.mask === 1) rendered.push(object); });
    expect(rendered).toHaveLength(1);
    const ray = new THREE.Raycaster(new THREE.Vector3(2, 0, 3), new THREE.Vector3(0, 0, -1)); ray.layers.enable(1);
    expect(ray.intersectObjects(targets)[0].object.userData.furnitureId).toBe('chair-2');
    root.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); material.dispose();
  });
});
