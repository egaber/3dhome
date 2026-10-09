import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultState, floorElevation, resolvedFurniture, resolvedRooms } from '../model/plans';
import { modelWorldPoint, resolveStairGeometry } from '../model/cad';
import { southFamilyProposal } from '../model/southFamilyLayout';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import type { Vec2 } from '../model/types';
import { buildWalkWorld } from './walkWorld';
import { evaluateSupportedWalk, resolveWalkPose } from '../lib/supportedWalk';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };

describe('south family actual scene', () => {
  it('walks up and down the 20-riser proposal with its landings and actual walls intact', () => {
    const state = southFamilyProposal(defaultState()), architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!, stair = resolveStairGeometry(state, 'south', 'ground')!;
      expect(architecture.blockers.some(mesh => mesh.userData.unit === 'south' && mesh.userData.role === 'stair-guard')).toBe(true);
      const first = stair.parts[0], last = stair.parts[17], landing = stair.parts.find(part => part.kind === 'landing')!;
      const start: Vec2 = [first.center[0], 12.25], finish: Vec2 = [last.center[0], 12.25];
      const route: Vec2[] = [...stair.parts.slice(0, 9).map(part => part.center), [first.center[0], landing.center[1]],
        [last.center[0], landing.center[1]], ...stair.parts.slice(9, 18).map(part => part.center), finish];
      let pose = resolveWalkPose(world, new THREE.Vector3(...modelWorldPoint(start, state.view.eyeHeight, 'south', state)), state.view.eyeHeight)!;
      expect(pose).not.toBeNull();
      const move = (points: Vec2[]) => {
        for (const point of points) {
          const end = new THREE.Vector3(...modelWorldPoint(point, 0, 'south', state));
          const motion = end.sub(pose.eye); motion.y = 0;
          const count = Math.max(1, Math.ceil(motion.length() / .035)); motion.divideScalar(count);
          for (let index = 0; index < count; index++) {
            const result = evaluateSupportedWalk(world, pose, motion, state.view.eyeHeight);
            expect(result.accepted, JSON.stringify({ position: pose.eye.toArray(), point, result })).toBe(true);
            if (!result.accepted) throw new Error(result.reason);
            pose = result.pose;
          }
        }
      };
      move(route);
      expect(pose.floor).toBe('first'); expect(pose.eye.y).toBeCloseTo(state.buildings.south.groundHeight + state.view.eyeHeight);
      move([...route.slice(0, -1)].reverse().concat([start]));
      expect(pose.floor).toBe('ground'); expect(pose.eye.y).toBeCloseTo(state.view.eyeHeight);
    } finally { disposeArchitecture(architecture); }
  });

  it('renders the stepped first-floor slab, relocated stair opening and all proposed fixtures', () => {
    const state = southFamilyProposal(defaultState()), architecture = buildArchitecture(state, palette);
    try {
      const slabs = architecture.measurementTargets.filter(mesh => mesh.userData.role === 'slab' && mesh.userData.unit === 'south' && mesh.userData.floor === 'first');
      expect(slabs).toHaveLength(1);
      const elevation = floorElevation('first', state.buildings.south);
      const hasFloor = (point: Vec2) => new THREE.Raycaster(new THREE.Vector3(...modelWorldPoint(point, elevation + .1, 'south', state)),
        new THREE.Vector3(0, -1, 0), 0, .5).intersectObjects(slabs, false).length > 0;
      expect(hasFloor([9, 7.5])).toBe(false);
      const stair = resolveStairGeometry(state, 'south', 'ground')!;
      expect(hasFloor(stair.pivot)).toBe(false);
      expect(hasFloor([2, 12.1])).toBe(true);
      for (const room of resolvedRooms(state).filter(room => room.unit === 'south' && room.floor === 'first')) expect(hasFloor(room.center), room.id).toBe(true);
      const passages: [Vec2, Vec2][] = [[[3, 9.86], [4.2, 9.86]], [[8.5, 11.61], [9.8, 11.61]],
        [[7.59, 12.1], [7.59, 11.1]], [[3.05, 12.3], [3.05, 13.3]], [[3.4, 13.32], [4.35, 13.32]], [[3.4, 14.73], [4.35, 14.73]]];
      for (const [from, to] of passages) {
        const origin = new THREE.Vector3(...modelWorldPoint(from, elevation + 1.4, 'south', state));
        const end = new THREE.Vector3(...modelWorldPoint(to, elevation + 1.4, 'south', state)), direction = end.clone().sub(origin);
        const distance = direction.length();
        expect(new THREE.Raycaster(origin, direction.normalize(), 0, distance).intersectObjects(architecture.blockers, false), `${from} -> ${to}`).toHaveLength(0);
      }
      const wallIds = new Set(architecture.pickables.filter(mesh => mesh.userData.unit === 'south' && mesh.userData.floor === 'first' && mesh.userData.wallId).map(mesh => mesh.userData.wallId));
      expect([...wallIds].every(id => String(id).startsWith('south-family-'))).toBe(true);
      for (const item of resolvedFurniture(state).filter(item => item.unit === 'south' && item.floor === 'first')) {
        expect(architecture.pickables.some(mesh => mesh.userData.furnitureId === item.id), item.id).toBe(true);
      }
    } finally { disposeArchitecture(architecture); }
  });
});