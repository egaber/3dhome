import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { capsuleBlocker, evaluateSupportedWalk, resolveWalkPose, supportContains, type WalkPose, type WalkWorld } from '../lib/supportedWalk';
import { applyCadCommand, modelWorldPoint, resolveStairGeometry, stairPartOrder } from '../model/cad';
import { areaOf, defaultState, floorElevation, resolvedRooms } from '../model/plans';
import { northBedroomProposal } from '../model/northBedroomLayout';
import { northEntranceStairProposal } from '../model/northStairLayout';
import { NORTH_GROUND_ROOMS, northGroundStairProposal } from '../model/northGroundLayout';
import { stairPortals } from '../model/stairSafety';
import type { Vec2 } from '../model/types';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import { buildWalkWorld } from './walkWorld';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };

function walkTo(world: WalkWorld, initial: WalkPose, target: THREE.Vector3, height: number): WalkPose {
  const motion = target.clone().sub(initial.eye); motion.y = 0;
  const steps = Math.max(1, Math.ceil(motion.length() / .04));
  motion.divideScalar(steps);
  let pose = initial;
  for (let index = 0; index < steps; index++) {
    const result = evaluateSupportedWalk(world, pose, motion, height);
    expect(result.accepted, JSON.stringify({ at: pose.eye.toArray(), target: target.toArray(), result })).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    pose = result.pose;
  }
  return pose;
}

describe('attached north ground-floor U stair', () => {
  it.each([
    { fromFloor: 'basement', transformed: false }, { fromFloor: 'ground', transformed: false },
    { fromFloor: 'first', transformed: false }, { fromFloor: 'ground', transformed: true },
    { fromFloor: 'first', transformed: true },
  ] as const)('walks from $fromFloor to the next level and back with the furnished plan and guards; transformed=$transformed', ({ fromFloor, transformed }) => {
    const state = northGroundStairProposal(northBedroomProposal(defaultState()));
    state.buildings.north.stairToRoof = true;
    if (transformed) {
      state.northBearing = 31;
      state.buildings.north = { ...state.buildings.north, rotation: 17, width: 13.3, depth: 7.52, x: 1, z: -6 };
    }
    const architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!;
      const stair = resolveStairGeometry(state, 'north', fromFloor)!;
      const parts = stairPartOrder(stair).map(index => stair.parts[index]);
      const portals = stairPortals(stair);
      const local = (point: Vec2, height = 0) => new THREE.Vector3(...modelWorldPoint(point, height, 'north', state));
      const outside = (portal: Vec2, tread: Vec2): Vec2 => {
        const length = Math.hypot(portal[0] - tread[0], portal[1] - tread[1]);
        return [portal[0] + (portal[0] - tread[0]) / length * .45, portal[1] + (portal[1] - tread[1]) / length * .45];
      };
      const start = local(outside(portals.entry.center, parts[0].center), floorElevation(fromFloor, state.buildings.north) + state.view.eyeHeight);
      const finish = local(outside(portals.exit.center, parts.at(-1)!.center));
      const destination = world.supports.find(support => support.unit === 'north' && support.floor === stair.toFloor && support.kind === 'floor')!;
      expect(destination).toBeDefined();
      expect(supportContains(destination, local(parts.find(part => part.kind === 'landing')!.center))).toBe(false);
      let pose = resolveWalkPose(world, start, state.view.eyeHeight);
      expect(pose, capsuleBlocker(world, start, start, state.view.eyeHeight) ?? 'stair entry').not.toBeNull();
      if (fromFloor === 'ground') {
        const entry = resolveWalkPose(world, local([8.52, 4.99], state.view.eyeHeight), state.view.eyeHeight)!;
        expect(entry).not.toBeNull();
        pose = walkTo(world, entry, local([8.30, 3.10]), state.view.eyeHeight);
        pose = walkTo(world, pose, start, state.view.eyeHeight);
      }
      const points = parts.map(part => local(part.center));
      for (const point of points) pose = walkTo(world, pose!, point, state.view.eyeHeight);
      expect(resolveWalkPose(world, pose!.eye, state.view.eyeHeight)).not.toBeNull();
      pose = walkTo(world, pose!, finish, state.view.eyeHeight);
      expect(pose).toMatchObject({ floor: stair.toFloor, mode: 'supported', stairId: null });
      if (fromFloor === 'ground') {
        for (const point of [[4.525, 2.77], [5.815, 2.77], [5.815, 3.29], [5.815, 2.77], [4.525, 2.77]] as Vec2[]) {
          pose = walkTo(world, pose, local(point), state.view.eyeHeight);
        }
        pose = walkTo(world, pose, finish, state.view.eyeHeight);
      }
      for (const point of [...points].reverse().concat([start])) pose = walkTo(world, pose, point, state.view.eyeHeight);
      expect(pose).toMatchObject({ floor: fromFloor, mode: 'supported', stairId: null });
    } finally { disposeArchitecture(architecture); }
  });

  it('keeps ground-floor tour entry positions clear of the modeled furniture and walls', () => {
    const state = northGroundStairProposal(northBedroomProposal(defaultState())), architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!;
      for (const room of NORTH_GROUND_ROOMS) {
        const eye = new THREE.Vector3(...modelWorldPoint(room.center, state.view.eyeHeight, 'north', state));
        expect(capsuleBlocker(world, eye, eye, state.view.eyeHeight), room.id).toBeNull();
        expect(resolveWalkPose(world, eye, state.view.eyeHeight), room.id).toMatchObject({ mode: 'supported', floor: 'ground' });
      }
    } finally { disposeArchitecture(architecture); }
  });
});

describe('north entrance-facing ascent and narrow straight basement stair', () => {
  for (const fromFloor of ['ground', 'basement'] as const) it(`has unobstructed supported steps on ${fromFloor}`, () => {
    const state = northEntranceStairProposal(northBedroomProposal(defaultState()));
    const architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!;
      const stair = resolveStairGeometry(state, 'north', fromFloor)!;
      const parts = stairPartOrder(stair).map(index => stair.parts[index]);
      const portals = stairPortals(stair);
      const local = (point: Vec2, height = 0) => new THREE.Vector3(...modelWorldPoint(point, height, 'north', state));
      const outside = (portal: Vec2, tread: Vec2): Vec2 => {
        const length = Math.hypot(portal[0] - tread[0], portal[1] - tread[1]);
        return [portal[0] + (portal[0] - tread[0]) / length * .45, portal[1] + (portal[1] - tread[1]) / length * .45];
      };
      const start = local(outside(portals.entry.center, parts[0].center), floorElevation(fromFloor, state.buildings.north) + state.view.eyeHeight);
      const finish = local(outside(portals.exit.center, parts.at(-1)!.center));
      let pose = resolveWalkPose(world, start, state.view.eyeHeight);
      expect(pose, capsuleBlocker(world, start, start, state.view.eyeHeight) ?? 'initial support').not.toBeNull();
      if (fromFloor === 'ground') {
        const entrance = resolveWalkPose(world, local([8.405, 5.23], state.view.eyeHeight), state.view.eyeHeight);
        expect(entrance).not.toBeNull();
        pose = walkTo(world, entrance!, start, state.view.eyeHeight);
      }
      const points = parts.map(part => local(part.center));
      for (const point of [...points, finish]) pose = walkTo(world, pose!, point, state.view.eyeHeight);
      expect(pose).toMatchObject({ floor: stair.toFloor, stairId: null, mode: 'supported' });
      if (fromFloor === 'ground') {
        pose = walkTo(world, pose!, local([6.99, 3.21]), state.view.eyeHeight);
        pose = walkTo(world, pose, local([6.99, 2.77]), state.view.eyeHeight);
        pose = walkTo(world, pose, local([6.99, 3.21]), state.view.eyeHeight);
        pose = walkTo(world, pose, finish, state.view.eyeHeight);
      }
      for (const point of [...points].reverse().concat([start])) pose = walkTo(world, pose!, point, state.view.eyeHeight);
      expect(pose).toMatchObject({ floor: fromFloor, stairId: null, mode: 'supported' });
    } finally { disposeArchitecture(architecture); }
  });

  it('faces the entrance upstairs and cuts only a narrow straight basement footprint at ground level', () => {
    const original = defaultState(), state = northEntranceStairProposal(original);
    const ascent = resolveStairGeometry(state, 'north', 'ground')!, basement = resolveStairGeometry(state, 'north', 'basement')!;
    expect(ascent.entry!.center[1]).toBeCloseTo(5.35, 5);
    expect(ascent.parts[0].center[0]).toBeLessThan(ascent.entry!.center[0]);
    expect(ascent.parts.filter(part => part.kind === 'landing')).toHaveLength(2);
    expect(new Set(basement.parts.map(part => part.center[0].toFixed(5))).size).toBe(1);
    expect(areaOf(basement.footprint)).toBeLessThan(areaOf(resolveStairGeometry(original, 'north', 'basement')!.footprint) * .6);
    expect(state.buildings.south).toBe(original.buildings.south);
    expect(state.design).toBe(original.design);
  });

  it('connects the stair hall to all bedrooms, bathrooms and laundry through real open doors', () => {
    const state = northEntranceStairProposal(northBedroomProposal(defaultState())), architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!;
      const local = (point: Vec2) => new THREE.Vector3(...modelWorldPoint(point, state.buildings.north.groundHeight + state.view.eyeHeight, 'north', state));
      const start = resolveWalkPose(world, local([6.99, 2.77]), state.view.eyeHeight)!;
      expect(start).not.toBeNull();
      const routes: Record<string, Vec2[]> = {
        west: [[4.55, 2.81], [3.50, 2.81], [2.10, 3.50]],
        'west-bath': [[4.55, 2.81], [3.50, 2.81], [2.10, 3.50], [2.10, 4.95], [2.59, 4.95], [2.59, 5.80]],
        master: [[6.99, 1.80], [8.60, 1.80], [9.00, 2.12]],
        'master-bath': [[6.99, 1.80], [8.72, 1.80], [8.72, 5.32], [9.80, 5.32]],
        laundry: [[4.55, 2.77], [4.55, 1.30]],
        southeast: [[6.99, 6.60], [8.95, 6.85], [9.35, 8.00]],
        'southeast-bath': [[6.99, 6.60], [7.33, 6.85], [7.33, 7.80]],
      };
      for (const [room, points] of Object.entries(routes)) {
        let pose = start;
        for (const point of points) {
          try { pose = walkTo(world, pose, local(point), state.view.eyeHeight); }
          catch (error) {
            throw new Error(JSON.stringify({ room, point, footprint: resolveStairGeometry(state, 'north', 'ground')!.footprint, error: String(error) }));
          }
        }
        expect(pose, room).toMatchObject({ unit: 'north', floor: 'first', stairId: null, mode: 'supported' });
        for (const point of [...points].reverse().slice(1).concat([[6.99, 2.77]])) pose = walkTo(world, pose, local(point), state.view.eyeHeight);
      }
    } finally { disposeArchitecture(architecture); }
  });

  it('provides supported, furniture-clear tour entry points for every attached-plan room', () => {
    const state = northEntranceStairProposal(northBedroomProposal(defaultState())), architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!;
      const blocked = resolvedRooms(state).filter(room => room.id.startsWith('north-bedrooms-')).flatMap(room => {
        const eye = new THREE.Vector3(...modelWorldPoint(room.center, state.buildings.north.groundHeight + state.view.eyeHeight, 'north', state));
        const pose = resolveWalkPose(world, eye, state.view.eyeHeight);
        const blocker = capsuleBlocker(world, eye, eye, state.view.eyeHeight);
        return !pose || blocker ? [{ room: room.id, supported: !!pose, blocker }] : [];
      });
      expect(blocked).toEqual([]);
    } finally { disposeArchitecture(architecture); }
  });

  it.each([
    { fromFloor: 'first', transformed: false }, { fromFloor: 'ground', transformed: false },
    { fromFloor: 'basement', transformed: false }, { fromFloor: 'first', transformed: true },
  ] as const)('walks $fromFloor in both directions with roof guards; transformed=$transformed', ({ fromFloor, transformed }) => {
    const original = northEntranceStairProposal(northBedroomProposal(defaultState()));
    if (transformed) {
      original.northBearing = 31;
      original.buildings.north = { ...original.buildings.north, rotation: 17, width: 13.3, depth: 7.52, x: 1, z: -1 };
    }
    const state = applyCadCommand(original, { type: 'stair-roof', unit: 'north', enabled: true });
    const architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!;
      const stair = resolveStairGeometry(state, 'north', fromFloor)!;
      const parts = stairPartOrder(stair).map(index => stair.parts[index]);
      const portals = stairPortals(stair);
      const local = (point: Vec2, height = 0) => new THREE.Vector3(...modelWorldPoint(point, height, 'north', state));
      const outside = (portal: Vec2, tread: Vec2): Vec2 => {
        const length = Math.hypot(portal[0] - tread[0], portal[1] - tread[1]);
        return [portal[0] + (portal[0] - tread[0]) / length * .45, portal[1] + (portal[1] - tread[1]) / length * .45];
      };
      const start = local(outside(portals.entry.center, parts[0].center), floorElevation(fromFloor, state.buildings.north) + state.view.eyeHeight);
      const finish = local(outside(portals.exit.center, parts.at(-1)!.center));
      let pose = resolveWalkPose(world, start, state.view.eyeHeight);
      expect(pose, capsuleBlocker(world, start, start, state.view.eyeHeight) ?? 'source support').not.toBeNull();
      if (fromFloor === 'first') {
        const hall = resolveWalkPose(world, local([6.99, 2.77], state.buildings.north.groundHeight + state.view.eyeHeight), state.view.eyeHeight);
        expect(hall).not.toBeNull();
        pose = walkTo(world, hall!, local([6.99, 5.35]), state.view.eyeHeight);
        pose = walkTo(world, pose, start, state.view.eyeHeight);
        const roof = world.supports.find(support => support.unit === 'north' && support.floor === 'roof' && support.kind === 'floor')!;
        expect(roof).toBeDefined();
        expect(supportContains(roof, local(parts[8].center))).toBe(false);
      }
      const points = parts.map(part => local(part.center));
      for (const point of points) pose = walkTo(world, pose!, point, state.view.eyeHeight);
      expect(resolveWalkPose(world, pose!.eye, state.view.eyeHeight)).toMatchObject({ floor: fromFloor, stairId: pose!.stairId });
      pose = walkTo(world, pose!, finish, state.view.eyeHeight);
      expect(pose).toMatchObject({ floor: stair.toFloor, stairId: null, mode: 'supported' });
      if (fromFloor === 'first') {
        pose = walkTo(world, pose!, local([7.2, 3.21]), state.view.eyeHeight);
        expect(pose.floor).toBe('roof');
        pose = walkTo(world, pose, finish, state.view.eyeHeight);
      }
      for (const point of [...points].reverse().concat([start])) pose = walkTo(world, pose!, point, state.view.eyeHeight);
      expect(pose).toMatchObject({ floor: fromFloor, stairId: null, mode: 'supported' });
    } finally { disposeArchitecture(architecture); }
  });
});