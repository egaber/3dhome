import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { raycastVisible } from './viewerMeasurement';

describe('visible ray camera depth clipping', () => {
  it.each([
    { near: .05, far: 500, expectedZ: 1 },
    { near: .05, far: 5, expectedZ: undefined },
    { near: 12, far: 500, expectedZ: undefined },
    { near: 10, far: 12, expectedZ: -1 },
    { near: 9, far: 11, expectedZ: 1 },
  ])('clips box surfaces against camera near=$near far=$far', ({ near, far, expectedZ }) => {
    const geometry = new THREE.BoxGeometry(2, 2, 2), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material), camera = new THREE.PerspectiveCamera(48, 1, near, far);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(); ray.near = 20; ray.far = .1;
    try {
      const hit = raycastVisible(ray, new THREE.Vector2(), camera, [mesh]);
      if (expectedZ === undefined) expect(hit).toBeUndefined();
      else expect(hit?.point.z).toBeCloseTo(expectedZ);
      expect(ray.near).toBe(0); expect(ray.far).toBe(Infinity);
    } finally { geometry.dispose(); material.dispose(); }
  });

  it('uses camera-space depth, not oblique ray distance, after camera and ancestor changes', () => {
    const parent = new THREE.Group(), camera = new THREE.PerspectiveCamera(90, 1, 1, 5);
    parent.add(camera); parent.position.set(7, -3, 2); parent.rotation.set(.3, .6, -.2);
    camera.position.set(2, 1, 4); camera.rotation.set(-.2, .4, .1);
    const geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material), pointer = new THREE.Vector2(.9, 0), ray = new THREE.Raycaster();
    const place = (depth: number) => {
      camera.updateProjectionMatrix(); camera.updateWorldMatrix(true, false);
      mesh.position.set(pointer.x * depth, 0, -depth).applyMatrix4(camera.matrixWorld);
      mesh.quaternion.copy(camera.getWorldQuaternion(new THREE.Quaternion()));
      mesh.updateMatrixWorld(true);
    };
    try {
      place(4.5);
      const hit = raycastVisible(ray, pointer, camera, [mesh]);
      expect(hit).toBeDefined(); expect(hit!.distance).toBeGreaterThan(camera.far);
      expect(-hit!.point.clone().applyMatrix4(camera.matrixWorldInverse).z).toBeCloseTo(4.5);
      // This surface is nearer than the render plane despite a ray distance > near.
      place(.8); expect(raycastVisible(ray, pointer, camera, [mesh])).toBeUndefined();
      place(5.1); expect(raycastVisible(ray, pointer, camera, [mesh])).toBeUndefined();
      camera.near = .5; camera.far = 8; camera.fov = 60;
      parent.position.x += 3; parent.rotation.y -= .4; camera.position.z -= 1;
      camera.updateProjectionMatrix();
      const center = new THREE.Vector2();
      // Move both without updating matrixWorld: casting must refresh the camera's inverse.
      mesh.position.set(0, 0, -6).applyQuaternion(camera.quaternion).add(camera.position);
      parent.add(mesh); mesh.quaternion.copy(camera.quaternion);
      const movedHit = raycastVisible(ray, center, camera, [mesh]);
      expect(movedHit).toBeDefined();
      expect(-movedHit!.point.clone().applyMatrix4(camera.matrixWorldInverse).z).toBeCloseTo(6);
      camera.far = 5; camera.updateProjectionMatrix();
      expect(raycastVisible(ray, center, camera, [mesh])).toBeUndefined();
    } finally { geometry.dispose(); material.dispose(); }
  });

  it('respects orthographic camera depth independently of the ray origin', () => {
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 2, 5);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
    const geometry = new THREE.PlaneGeometry(4, 4), material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material), ray = new THREE.Raycaster(), pointer = new THREE.Vector2(.75, 0);
    try {
      for (const [depth, visible] of [[1, false], [2, true], [4, true], [5, true], [6, false]] as const) {
        mesh.position.z = 10 - depth;
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        expect(Boolean(raycastVisible(ray, pointer, camera, [mesh]))).toBe(visible);
      }
    } finally { geometry.dispose(); material.dispose(); }
  });
});