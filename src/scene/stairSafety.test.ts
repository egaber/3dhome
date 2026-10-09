import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyCadCommand, modelWorldPoint, resolveStairGeometry } from '../model/cad';
import { defaultState } from '../model/plans';
import { DEFAULT_STAIR_PATH } from '../model/stairPath';
import { stairOpeningEdges, stairPortals, stairRailEdges, STAIR_GLASS_HEIGHT } from '../model/stairSafety';
import { southWestProposal } from '../model/southWestLayout';
import type { Vec2 } from '../model/types';
import { capsuleBlocker, evaluateSupportedWalk, resolveWalkPose, type WalkPose, type WalkWorld } from '../lib/supportedWalk';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import { buildWalkWorld } from './walkWorld';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };
function edited(secondTurn = false, firstLandingAfter = 11) {
  let state = southWestProposal(defaultState());
  state = applyCadCommand(state, { type: 'stair-path', unit: 'south', fromFloor: 'ground', path: {
    ...DEFAULT_STAIR_PATH, ...(secondTurn ? { landingAfter: firstLandingAfter, secondLanding: { turn: 'right', landingAfter: 15, landingDepth: .92 } } : {}),
  } });
  return applyCadCommand(state, { type: 'stair-protection', unit: 'south', railing: true, openingGlass: true });
}

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

describe('actual custom stairs, handrails and transparent opening barriers', () => {
  for (const secondTurn of [false, true]) it(`keeps the source and destination passages open and the handrails finite; second turn=${secondTurn}`, () => {
    const state = edited(secondTurn);
    for (const fromFloor of ['basement', 'ground'] as const) {
      const stair = resolveStairGeometry(state, 'south', fromFloor)!;
      const rail = stairRailEdges(stair);
      expect(rail.length).toBeGreaterThan(25);
      expect(rail.every(edge => [...edge.a, ...edge.b, edge.elevationA, edge.elevationB].every(Number.isFinite))).toBe(true);
      const exit = stairPortals(stair).exit;
      const glass = stairOpeningEdges(stair, fromFloor === 'basement' ? resolveStairGeometry(state, 'south', 'ground') : null);
      expect(glass.length).toBeGreaterThan(1);
      expect(glass.some(edge => Math.hypot((edge.a[0] + edge.b[0]) / 2 - exit.center[0], (edge.a[1] + edge.b[1]) / 2 - exit.center[1]) < .01)).toBe(false);
    }
  });
  for (const secondTurn of [false, true]) it(`renders rails, clear glass and the full opening with real glass collisions; second turn=${secondTurn}`, () => {
    const state = edited(secondTurn), architecture = buildArchitecture(state, palette);
    try {
      architecture.group.updateWorldMatrix(true, true);
      const guards = architecture.pickables.filter(mesh => mesh.userData.role === 'stair-guard' && mesh.userData.unit === 'south');
      expect(guards.length).toBeGreaterThan(50);
      const glass = architecture.measurementTargets.filter(mesh => mesh.userData.role === 'stair-opening-glass');
      expect(glass.some(mesh => mesh.userData.floor === 'ground')).toBe(true);
      expect(glass.some(mesh => mesh.userData.floor === 'first')).toBe(true);
      for (const panel of glass) {
        const material = panel.material as THREE.MeshStandardMaterial;
        expect(material.transparent).toBe(true);
        expect(material.opacity).toBeGreaterThan(0);
        expect(material.opacity).toBeLessThan(.35);
        expect(architecture.blockers).not.toContain(panel);
        expect(new THREE.Box3().setFromObject(panel).getSize(new THREE.Vector3()).y).toBeCloseTo(STAIR_GLASS_HEIGHT);
      }
      const ground = resolveStairGeometry(state, 'south', 'ground')!;
      const slabs = architecture.measurementTargets.filter(mesh => mesh.userData.role === 'slab' && mesh.userData.unit === 'south' && mesh.userData.floor === 'first');
      const hasFloor = (point: Vec2) => new THREE.Raycaster(new THREE.Vector3(...modelWorldPoint(point, 3.5, 'south', state)),
        new THREE.Vector3(0, -1, 0), 0, .5).intersectObjects(slabs, false).length > 0;
      const landings = ground.parts.filter(part => part.kind === 'landing');
      expect(landings).toHaveLength(secondTurn ? 2 : 1);
      for (const landing of landings) expect(hasFloor(landing.center)).toBe(false);
      expect(hasFloor(ground.parts.at(-1)!.center)).toBe(false);
      const world = buildWalkWorld(state, architecture)!;
      expect(world.colliders.filter(collider => collider.id.startsWith('stair-opening-glass:'))).toHaveLength(glass.length);
      const supports = world.supports.filter(support => support.stairId === 'stair-south-ground').sort((left, right) => left.partIndex! - right.partIndex!);
      expect(supports).toHaveLength(17);
      for (let index = 1; index < supports.length; index++) expect(world.adjacency[supports[index - 1].id]).toContain(supports[index].id);
      expect(world.adjacency[supports.at(-1)!.id].some(id => id.startsWith('slab:south:first'))).toBe(true);
    } finally { disposeArchitecture(architecture); }
  });
  it('does not add new protection geometry to old projects or disabled stair connections', () => {
    const state = defaultState();
    Object.assign(state.buildings.south, { stairEnabled: false, stairRailing: true, stairOpeningGlass: true });
    const architecture = buildArchitecture(state, palette);
    try { expect(architecture.pickables.some(mesh => ['stair-guard', 'stair-opening-glass'].includes(mesh.userData.role))).toBe(false); }
    finally { disposeArchitecture(architecture); }
  });
  for (const secondTurn of [false, true]) it(`blocks a swept walking capsule across glass while leaving both floor exit portals clear; second turn=${secondTurn}`, () => {
    const state = edited(secondTurn), architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!;
      const barriers = { ...world, colliders: world.colliders.filter(collider => /^stair-opening-(glass|frame):/.test(collider.id)) };
      const local = (point: Vec2, height: number) => new THREE.Vector3(...modelWorldPoint(point, height, 'south', state));
      for (const fromFloor of ['basement', 'ground'] as const) {
        const stair = resolveStairGeometry(state, 'south', fromFloor)!;
        const elevation = fromFloor === 'basement' ? 0 : state.buildings.south.groundHeight;
        const edges = stairOpeningEdges(stair, fromFloor === 'basement' ? resolveStairGeometry(state, 'south', 'ground') : null);
        const edge = edges.find(candidate => Math.hypot(candidate.b[0] - candidate.a[0], candidate.b[1] - candidate.a[1]) > .8)!;
        const length = Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]);
        const normal: Vec2 = [-(edge.b[1] - edge.a[1]) / length, (edge.b[0] - edge.a[0]) / length];
        const middle: Vec2 = [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2];
        const across = (point: Vec2, direction: Vec2, distance: number) => local([point[0] + direction[0] * distance, point[1] + direction[1] * distance], elevation + state.view.eyeHeight);
        expect(capsuleBlocker(barriers, across(middle, normal, -.4), across(middle, normal, .4), state.view.eyeHeight)).toMatch(/^stair-opening-/);
        const portal = stairPortals(stair).exit;
        const width = Math.hypot(portal.b[0] - portal.a[0], portal.b[1] - portal.a[1]);
        const forward: Vec2 = [-(portal.b[1] - portal.a[1]) / width, (portal.b[0] - portal.a[0]) / width];
        expect(capsuleBlocker(barriers, across(portal.center, forward, -.4), across(portal.center, forward, .4), state.view.eyeHeight)).toBeNull();
      }
    } finally { disposeArchitecture(architecture); }
  });
  for (const route of [
    { secondTurn: false },
    { secondTurn: true },
    { secondTurn: true, position: [.75, 10.75] as Vec2, firstLandingAfter: 12 },
  ]) it(`walks the west route to the first floor and back with real walls, rails and glass intact; route=${JSON.stringify(route)}`, () => {
    const { secondTurn } = route;
    const state = edited(secondTurn, route.firstLandingAfter);
    if (route.position) state.buildings.south.stairPosition = [...route.position];
    const architecture = buildArchitecture(state, palette);
    try {
      const world = buildWalkWorld(state, architecture)!;
      const stair = resolveStairGeometry(state, 'south', 'ground')!;
      const local = (point: Vec2, height = 0) => new THREE.Vector3(...modelWorldPoint(point, height, 'south', state));
      const start = local([stair.entry!.center[0], stair.entry!.center[1] + .45], state.view.eyeHeight);
      const finish = local([stair.exit!.center[0] + (secondTurn ? 0 : .45), stair.exit!.center[1] + (secondTurn ? .45 : 0)]);
      let pose = resolveWalkPose(world, start, state.view.eyeHeight);
      expect(pose, capsuleBlocker(world, start, start, state.view.eyeHeight) ?? 'initial support').not.toBeNull();
      const points = stair.parts.map(part => local(part.center));
      for (const point of [...points, finish]) pose = walkTo(world, pose!, point, state.view.eyeHeight);
      expect(pose).toMatchObject({ floor: 'first', stairId: null, mode: 'supported' });
      for (const point of [...points].reverse().concat([start])) pose = walkTo(world, pose!, point, state.view.eyeHeight);
      expect(pose).toMatchObject({ floor: 'ground', stairId: null, mode: 'supported' });
    } finally { disposeArchitecture(architecture); }
  });
});