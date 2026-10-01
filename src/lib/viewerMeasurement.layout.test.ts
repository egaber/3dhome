import { expect, it } from 'vitest';
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { disposeMeasurementGraphics, measurementGraphics } from './viewerMeasurement';

it('uses a constant screen marker radius and readable world line without moving endpoints', () => {
  const graphics = measurementGraphics([[0, 0, 0], [3, 4, 0]], 'red');
  const camera = new THREE.PerspectiveCamera(48, 1, .05, 500), scene = new THREE.Scene();
  const renderer = { getSize: (size: THREE.Vector2) => size.set(360, 240) } as THREE.WebGLRenderer;
  const marker = graphics.children[0] as THREE.Mesh;
  try {
    for (const [depth, zoom] of [[30, 1], [60, 2]]) {
      camera.position.z = depth; camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      marker.onBeforeRender(renderer, scene, camera, marker.geometry, marker.material as THREE.Material, graphics);
      expect(marker.scale.x * camera.projectionMatrix.elements[5] / depth * 240 / 2).toBeCloseTo(5);
      expect(marker.position.toArray()).toEqual([0, 0, 0]);
    }
    const line = graphics.children[2] as Line2;
    expect(line.material.linewidth).toBe(2.5); expect(line.material.depthTest).toBe(false);
    expect(line.geometry.getAttribute('instanceStart').getX(0)).toBe(0);
    expect(line.geometry.getAttribute('instanceEnd').getX(0)).toBe(3);
  } finally { disposeMeasurementGraphics(graphics); }
});