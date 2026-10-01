import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildWallGeometry, normalizeApertures } from './wallGeometry';
import { buildWalkColliders, lookWalk, translateWalk, walkPositionBlocked } from './firstPersonNavigation';
import { isWithinBounds, navigationKey } from './walkNavigation';
import { defaultState, floorElevation, planPoint, ROOMS, trueWorldPoint } from '../model/plans';
import { buildArchitecture, disposeArchitecture } from '../scene/architecture';

const bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20, minY: 1.62, maxY: 2.5 };
function view() {
  const camera = new PerspectiveCamera(48, 1, .05, 500);
  camera.position.set(0, 1.62, 0);
  const target = new Vector3(2, 1.45, 0);
  camera.lookAt(target);
  return { camera, target };
}

describe('first-person walk regressions', () => {
  it('accepts the actual floor-level position produced by OrbitControls', () => {
    const { camera, target } = view();
    const controls = new OrbitControls(camera, null);
    camera.position.set(0, 1.62, 0);
    controls.target.copy(target);
    controls.update();
    expect(camera.position.y).toBeCloseTo(1.62, 12);
    expect(isWithinBounds(camera.position, bounds, .22)).toBe(true);
    expect(translateWalk(camera, target, new Vector3(.2, 0, 0), bounds, [])).toBe(true);
    expect(camera.position.x).toBe(.2);
    expect(camera.position.y).toBe(1.62);
  });

  it('allows every horizontal direction in the actual default living room', () => {
    const state = defaultState();
    const architecture = buildArchitecture(state, {
      background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
      muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8',
    });
    try {
      const colliders = buildWalkColliders(architecture.blockers);
      const room = ROOMS[0];
      const point = trueWorldPoint(planPoint(room.center, room.unit, state), state);
      for (const motion of [new Vector3(.15, 0, 0), new Vector3(-.15, 0, 0), new Vector3(0, 0, .15), new Vector3(0, 0, -.15)]) {
        const { camera, target } = view();
        camera.position.set(point[0], floorElevation(room.floor, state.buildings[room.unit]) + state.view.eyeHeight, point[1]);
        target.copy(camera.position).add(new Vector3(2, -.17, 0));
        expect(translateWalk(camera, target, motion, bounds, colliders), `motion ${motion.toArray()}`).toBe(true);
      }
    } finally { disposeArchitecture(architecture); }
  });

  it('does not treat the empty space beside a rotated wall as solid', () => {
    const wall = new Mesh(new BoxGeometry(.2, 3, 20), new MeshBasicMaterial());
    wall.rotation.y = Math.PI / 4;
    wall.position.y = 1.5;
    const colliders = buildWalkColliders([wall]);
    expect(colliders[0].bounds.containsPoint(new Vector3(4, 1.62, -4))).toBe(true);
    expect(walkPositionBlocked(new Vector3(4, 1.62, -4), colliders)).toBe(false);
    expect(walkPositionBlocked(new Vector3(4, 1.62, 4), colliders)).toBe(true);
    wall.geometry.dispose(); wall.material.dispose();
  });

  it('passes a real doorway but cannot tunnel through solid wall sections or a closed door', () => {
    const material = new MeshBasicMaterial();
    const apertures = normalizeApertures(6, 3, [{ id: 'door', center: 3, width: 1.2, sill: 0, height: 2.5 }]);
    const wall = new Mesh(buildWallGeometry(6, 3, .2, apertures), material);
    const doorway = buildWalkColliders([wall]);
    for (const [x, accepted] of [[3, true], [1, false]] as const) {
      const { camera, target } = view();
      camera.position.set(x, 1.62, -1);
      target.set(x, 1.62, 1);
      const before = camera.position.clone(), beforeTarget = target.clone();
      expect(translateWalk(camera, target, new Vector3(0, 0, 2), bounds, doorway)).toBe(accepted);
      if (!accepted) { expect(camera.position).toEqual(before); expect(target).toEqual(beforeTarget); }
    }
    const door = new Mesh(new BoxGeometry(1.2, 2.5, .06), material);
    door.position.set(3, 1.25, 0);
    const { camera, target } = view(); camera.position.set(3, 1.62, -1); target.set(3, 1.62, 1);
    expect(translateWalk(camera, target, new Vector3(0, 0, 2), bounds, buildWalkColliders([wall, door]))).toBe(false);
    wall.geometry.dispose(); door.geometry.dispose(); material.dispose();
  });

  it('preserves collision geometry under rotated and scaled ancestors', () => {
    const group = new Group(); group.rotation.y = .7; group.scale.set(1.3, 1, .8);
    const wall = new Mesh(new BoxGeometry(.2, 3, 5), new MeshBasicMaterial());
    wall.position.set(4, 1.5, 0); group.add(wall);
    const colliders = buildWalkColliders([wall]);
    expect(walkPositionBlocked(wall.getWorldPosition(new Vector3()), colliders)).toBe(true);
    wall.geometry.dispose(); wall.material.dispose();
  });

  it('keeps floor/ceiling and site boundaries; blocked motion is atomic', () => {
    const { camera, target } = view();
    for (const motion of [new Vector3(0, -.01, 0), new Vector3(0, 2, 0), new Vector3(25, 0, 0), new Vector3(NaN, 0, 0)]) {
      const before = camera.position.clone(), beforeTarget = target.clone();
      expect(translateWalk(camera, target, motion, bounds, [])).toBe(false);
      expect(camera.position).toEqual(before); expect(target).toEqual(beforeTarget);
    }
  });

  it('turns from a fixed eye and clamps pitch, unlike an orbit around a target', () => {
    const { camera, target } = view();
    const position = camera.position.clone(), oldTarget = target.clone();
    const distance = camera.position.distanceTo(target);
    lookWalk(camera, target, Math.PI / 2);
    expect(camera.position).toEqual(position);
    expect(target.distanceTo(oldTarget)).toBeGreaterThan(1);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance);
    lookWalk(camera, target, 0, 100);
    expect(camera.getWorldDirection(new Vector3()).y).toBeLessThan(1);
    expect(camera.position).toEqual(position);
  });

  it('maps physical movement keys independently of Hebrew layout', () => {
    expect(navigationKey('ש', 'KeyA')).toBe('a');
    expect(navigationKey('ק', 'KeyE')).toBe('e');
    expect(navigationKey('ArrowUp', 'ArrowUp')).toBe('ArrowUp');
  });
});