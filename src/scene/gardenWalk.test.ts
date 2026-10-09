import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { octoberProject } from '../lib/octoberAlternative';
import { applyCadCommand, modelWorldPoint } from '../model/cad';
import { openingContext, openingLeafColliders, nearbyDoor } from '../lib/doorInteraction';
import { gardenViewpoint, isOutside } from '../lib/gardenNavigation';
import { capsuleBlocker, evaluateSupportedWalk, resolveWalkPose, type WalkPose, type WalkWorld } from '../lib/supportedWalk';
import { applyLandscapeCommand } from '../model/landscape';
import type { SimulationState, UnitId, Vec2 } from '../model/types';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import { buildWalkWorld } from './walkWorld';
import { sceneSelection } from '../lib/viewerMeasurement';
import { roomEntryPoints } from '../lib/showroom';
import { resolvedRooms } from '../model/plans';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424', muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };
function walk(world: WalkWorld, pose: WalkPose, target: THREE.Vector3, height: number): WalkPose {
  const delta = target.clone().sub(pose.eye); delta.y = 0;
  const count = Math.max(1, Math.ceil(delta.length() / .06)); delta.divideScalar(count);
  for (let i = 0; i < count; i++) {
    const result = evaluateSupportedWalk(world, pose, delta, height);
    expect(result.accepted, JSON.stringify({ position: pose.eye.toArray(), target: target.toArray(), result,
      startBlocker: result.accepted ? null : capsuleBlocker(world, pose.eye, pose.eye, height), support: pose.supportId })).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    pose = result.pose;
  }
  return pose;
}

describe('real indoor/outdoor passages', () => {
  it('aligns the garden start with the actual clear sliding half, not the stacked glass panels', () => {
    const state = applyCadCommand(octoberProject(), { type: 'opening', id: 'october-ground-1-north-opening-1', patch: { open: true } });
    const scene = buildArchitecture(state, palette, undefined, true);
    try {
      const world = buildWalkWorld(state, scene, true)!, view = gardenViewpoint(state, 'north');
      const start = new THREE.Vector3(...view.position), pose = resolveWalkPose(world, start, state.view.eyeHeight);
      expect(pose).not.toBeNull();
      const finish = new THREE.Vector3(...modelWorldPoint([7.17, .6], state.view.eyeHeight, 'north', state));
      const inside = walk(world, pose!, finish, state.view.eyeHeight);
      expect(isOutside(world, inside)).toBe(false);
      expect(isOutside(world, walk(world, inside, start, state.view.eyeHeight))).toBe(true);
    } finally { disposeArchitecture(scene); }
  });
  it('has a supported furniture-clear entry position in every room on the attached ground plan', () => {
    const state = octoberProject(), scene = buildArchitecture(state, palette, undefined, true);
    try {
      const world = buildWalkWorld(state, scene, true)!;
      for (const room of resolvedRooms(state).filter(room => room.floor === 'ground')) {
        expect(roomEntryPoints(room).some(point => resolveWalkPose(world, new THREE.Vector3(...modelWorldPoint(point, state.view.eyeHeight, room.unit, state)), state.view.eyeHeight)), room.id).toBe(true);
      }
    } finally { disposeArchitecture(scene); }
  });
  it.each([
    { unit: 'north', route: [[10.8, 5.04], [8, 5.04], [8, 6.49], [9.1, 6.49], [9.1, 7.5], [9.1, 6.49], [8, 6.49], [8.09, 7.5], [8, 6.49], [8, 5.04]] },
    { unit: 'south', route: [[7.725, 11.23], [6.94, 11.23], [6.94, 9.91], [7.2, 9.8], [6.94, 9.91], [6.94, 11.23], [7.725, 11.23]] },
  ] as { unit: UnitId; route: Vec2[] }[])('keeps internal $unit bathroom and safe-room passages walkable with the furnished plan', ({ unit, route }) => {
    const state = octoberProject(), scene = buildArchitecture(state, palette, undefined, true);
    try {
      const world = buildWalkWorld(state, scene, true)!;
      const worldPoint = (point: Vec2) => new THREE.Vector3(...modelWorldPoint(point, state.view.eyeHeight, unit, state));
      let pose = resolveWalkPose(world, worldPoint(route[0]), state.view.eyeHeight);
      expect(pose).not.toBeNull();
      for (const point of route.slice(1)) pose = walk(world, pose!, worldPoint(point), state.view.eyeHeight);
      expect(pose?.floor).toBe('ground');
    } finally { disposeArchitecture(scene); }
  });
  it.each([
    { unit: 'north', id: 'october-ground-3-north-opening-1', from: [10.8, 5.04], to: [12.5, 5.04] },
    { unit: 'south', id: 'october-ground-12-south-opening-0', from: [8.3, 10.99], to: [10.1, 10.99] },
    { unit: 'north', id: 'october-ground-1-north-opening-2', from: [10.25, .8], to: [10.25, -2] },
    { unit: 'south', id: 'october-ground-6-south-opening-0', from: [5.3, 15.02], to: [7.2, 15.02] },
  ] as { unit: UnitId; id: string; from: Vec2; to: Vec2 }[])('opens $id and walks outside and back without bypassing walls or falling through wells', ({ unit, id, from, to }) => {
    const state = applyCadCommand(octoberProject(), { type: 'opening', id, patch: { open: true } }), scene = buildArchitecture(state, palette, undefined, true);
    try {
      const world = buildWalkWorld(state, scene, true)!, height = state.view.eyeHeight;
      const position = (p: Vec2) => new THREE.Vector3(...modelWorldPoint(p, height, unit, state));
      const initial = resolveWalkPose(world, position(from), height);
      expect(initial, capsuleBlocker(world, position(from), position(from), height) ?? 'start support').not.toBeNull();
      let pose = walk(world, initial!, position(to), height);
      expect(isOutside(world, pose)).toBe(true);
      expect(pose.eye.y).toBeCloseTo(height, 5);
      pose = walk(world, pose, position(from), height);
      expect(isOutside(world, pose)).toBe(false);
    } finally { disposeArchitecture(scene); }
  });
  it('keeps a closed door solid and refuses a closing panel intersecting the visitor', () => {
    const state = octoberProject(), id = 'october-ground-3-north-opening-1', scene = buildArchitecture(state, palette, undefined, true);
    try {
      const world = buildWalkWorld(state, scene, true)!, context = openingContext(state, id)!;
      const a = new THREE.Vector3(...modelWorldPoint([11.3, 5.04], state.view.eyeHeight, 'north', state));
      const b = new THREE.Vector3(...modelWorldPoint([12.3, 5.04], state.view.eyeHeight, 'north', state));
      expect(capsuleBlocker(world, a, b, state.view.eyeHeight)).not.toBeNull();
      const doorway = context.handle.clone(); doorway.y = state.view.eyeHeight;
      const proposed = { ...world, colliders: openingLeafColliders(state, id, false) };
      expect(capsuleBlocker(proposed, doorway, doorway, state.view.eyeHeight)).toContain(id);
      expect(nearbyDoor(state, a, context.handle, () => true)?.id).toBe(id);
      expect(nearbyDoor(state, a, context.handle, () => false)).toBeNull();
      expect(nearbyDoor(state, a.clone().addScalar(40), context.handle, () => true)).toBeNull();
    } finally { disposeArchitecture(scene); }
  });
  it('renders every plant as an independently selectable object and removes deleted geometry and collisions', () => {
    const original = octoberProject(), id = 'garden-north-olive';
    const state: SimulationState = applyLandscapeCommand(original, { type: 'delete', id });
    const scene = buildArchitecture(state, palette, undefined, true);
    try {
      expect(scene.pickables.some(mesh => mesh.userData.landscapeId === id)).toBe(false);
      const plant = scene.pickables.find(mesh => mesh.userData.landscapeId)!;
      expect(sceneSelection(plant)?.type).toBe('landscape');
      const world = buildWalkWorld(state, scene, true)!;
      expect(world.colliders.some(collider => collider.id.includes(id))).toBe(false);
      expect(new Set(scene.pickables.flatMap(mesh => mesh.userData.landscapeId ? [mesh.userData.landscapeId] : [])).size).toBe(7);
    } finally { disposeArchitecture(scene); }
  });
});
