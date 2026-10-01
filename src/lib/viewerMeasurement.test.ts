import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ancestorsVisible, disposeMeasurementGraphics, measurementContext, measurementGraphics, numericWorldPoint, raycastVisible, sceneSelection, selectionBounds, visibleSurface } from './viewerMeasurement';
import { defaultState } from '../model/plans';
import { measureBetween, modelWorldPoint } from '../model/cad';

function fixture() {
  const scene = new THREE.Scene(), parent = new THREE.Group(); scene.add(parent);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial | THREE.MeshBasicMaterial[]>(new THREE.BoxGeometry(2, 2, 2), material); parent.add(mesh);
  const camera = new THREE.PerspectiveCamera(48, 1, .05, 500); camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const cast = (options = {}) => raycastVisible(ray, pointer, camera, [mesh], options);
  const cleanup = () => { mesh.geometry.dispose(); material.dispose(); };
  return { scene, parent, mesh, material, camera, ray, pointer, cast, cleanup };
}
describe('dedicated visible surface rays', () => {
  it('resets near/far and never recursively intersects outline/reference children', () => {
    const f = fixture();
    try {
      f.ray.near = 20; f.ray.far = .1;
      const decoration = new THREE.Mesh(f.mesh.geometry, f.material); decoration.position.z = 5; f.mesh.add(decoration);
      expect(f.cast()?.object).toBe(f.mesh); expect(f.cast()?.point.z).toBeCloseTo(1);
      expect(f.ray.near).toBe(0); expect(f.ray.far).toBe(Infinity);
      expect(raycastVisible(f.ray, f.pointer, f.camera, [])).toBeUndefined();
      f.pointer.set(.99, .99); expect(f.cast()).toBeUndefined();
    } finally { f.cleanup(); }
  });
  it('rejects hidden ancestors, hidden materials and zero-opacity surfaces', () => {
    const f = fixture();
    try {
      expect(f.cast()).toBeDefined(); f.parent.visible = false;
      expect(ancestorsVisible(f.mesh)).toBe(false); expect(f.cast()).toBeUndefined();
      f.parent.visible = true; f.scene.visible = false; expect(f.cast()).toBeUndefined();
      f.scene.visible = true; f.material.visible = false; expect(f.cast()).toBeUndefined();
      f.material.visible = true; f.material.transparent = true; f.material.opacity = 0; expect(f.cast()).toBeUndefined();
    } finally { f.cleanup(); }
  });
  it('matches global and local clipping, including intersection and material groups', () => {
    const f = fixture();
    try {
      const hit = f.cast()!;
      const removes = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
      const retains = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      expect(visibleSurface(hit, { clippingPlanes: [removes] })).toBe(false);
      f.material.clippingPlanes = [removes, retains];
      expect(visibleSurface(hit)).toBe(true);
      expect(visibleSurface(hit, { localClippingEnabled: true })).toBe(false);
      f.material.clipIntersection = true;
      expect(visibleSurface(hit, { localClippingEnabled: true })).toBe(true);
      f.material.clippingPlanes = [removes]; expect(visibleSurface(hit, { localClippingEnabled: true })).toBe(false);
      f.mesh.material = Array.from({ length: 6 }, () => f.material);
      expect(visibleSurface(hit, { localClippingEnabled: true })).toBe(false);
    } finally { f.cleanup(); }
  });
  it('returns a world-space hit after nested translation, rotation and nonuniform scale', () => {
    const f = fixture();
    try {
      f.parent.position.set(4, 3, -7); f.parent.rotation.set(.2, .5, -.1); f.parent.scale.set(1.8, .7, 1.2);
      f.scene.updateMatrixWorld(true);
      const expected = f.mesh.localToWorld(new THREE.Vector3(0, 0, 1));
      const normal = new THREE.Vector3(0, 0, 1).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(f.mesh.matrixWorld));
      f.camera.position.copy(expected).addScaledVector(normal, 10); f.camera.lookAt(expected);
      expect(f.cast()!.point.distanceTo(expected)).toBeLessThan(1e-6);
    } finally { f.cleanup(); }
  });
  it('prioritizes a specific ancestor opening/furniture/stair/wall before unit fallback', () => {
    const f = fixture();
    try {
      f.mesh.userData.unit = 'north'; f.parent.userData.openingId = 'window';
      expect(sceneSelection(f.mesh)).toEqual({ type: 'opening', id: 'window', unit: 'north' });
      delete f.parent.userData.openingId;
      for (const [key, type] of [['furnitureId', 'furniture'], ['stairId', 'stair'], ['wallId', 'wall']] as const) {
        f.mesh.userData[key] = 'specific'; expect(sceneSelection(f.mesh)).toMatchObject({ type, id: 'specific' }); delete f.mesh.userData[key];
      }
      expect(sceneSelection(f.mesh)).toEqual({ type: 'building', id: 'north', unit: 'north' });
      const bounds = selectionBounds([f.mesh], { type: 'building', id: 'north' }); expect(bounds.getSize(new THREE.Vector3()).toArray()).toEqual([2, 2, 2]);
      f.parent.visible = false; expect(selectionBounds([f.mesh], { type: 'building', id: 'north' }).isEmpty()).toBe(true);
    } finally { f.cleanup(); }
  });
});
describe('transient measurement state and resources', () => {
  it('keeps time/render/camera-only changes but invalidates geometry, floor, transforms and history/import revision', () => {
    const s = defaultState(), base = measurementContext(s, 'north', 'ground');
    s.minutes++; s.date = '2026-06-22'; s.view.mode = 'walk'; s.view.renderMode = 'realistic'; s.view.quality = 'standard'; s.view.planOpacity = .8; s.view.grid = true;
    expect(measurementContext(s, 'north', 'ground')).toBe(base);
    expect(measurementContext(s, 'south', 'ground')).not.toBe(base);
    expect(measurementContext(s, 'north', 'first')).not.toBe(base);
    expect(measurementContext(s, 'north', 'ground', 1)).not.toBe(base);
    for (const mutate of [() => { s.buildings.north.stairRotation = 45; }, () => { s.buildings.north.stairPosition = [2, 3]; },
      () => { s.buildings.north.width++; }, () => { s.northBearing++; }, () => { s.view.isolateFloor = 'first'; },
      () => { s.neighbors[0].enabled = false; }, () => { s.design.furnitureEdits['a-living-sofa'] = { center: [1, 2], rotation: 0, deleted: true }; }]) {
      const before = measurementContext(s, 'north', 'ground'); mutate(); expect(measurementContext(s, 'north', 'ground')).not.toBe(before);
    }
  });
  it('validates finite bounded XYZ and measures a 3-4-5 with vertical component', () => {
    expect(measureBetween(numericWorldPoint([0, 0, 0]), numericWorldPoint([3, 4, 0]))).toEqual({ distance: 5, horizontal: 3, vertical: 4 });
    expect(numericWorldPoint([-1000, 1000, 0])).toEqual([-1000, 1000, 0]);
    for (const p of [[0, 0], [0, NaN, 0], [Infinity, 0, 0], [1000.01, 0, 0], [-1001, 0, 0]]) expect(() => numericWorldPoint(p)).toThrow();
    const s = defaultState(); Object.assign(s.buildings.north, { x: 10, z: -4, rotation: 37 }); s.northBearing = 72;
    expect(measureBetween(modelWorldPoint([0, 0], 0, 'north', s), modelWorldPoint([3, 0], 4, 'north', s))?.distance).toBeCloseTo(5);
  });
  it('uses identity graphics outside architecture and disposes every line/marker allocation', () => {
    const scene = new THREE.Scene(), graphics = measurementGraphics([[2, 3, 4], [5, 7, 4]], 'red'); scene.add(graphics);
    expect(graphics.position.toArray()).toEqual([0, 0, 0]); expect(graphics.rotation.y).toBe(0);
    expect(graphics.children).toHaveLength(3);
    const spies = graphics.children.flatMap(o => {
      expect(o.castShadow).toBe(false); expect(o.userData).toEqual({});
      const m = o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      return [vi.spyOn(m.geometry, 'dispose'), vi.spyOn(m.material, 'dispose')];
    });
    disposeMeasurementGraphics(graphics); expect(scene.children).toHaveLength(0); expect(graphics.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});