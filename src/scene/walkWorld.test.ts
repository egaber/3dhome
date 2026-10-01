import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { applyCadCommand, modelWorldPoint, resolveStairGeometry } from '../model/cad';
import { defaultState } from '../model/plans';
import { initializeProject } from '../lib/initializeProject';
import { capsuleBlocker, evaluateFreeWalk, evaluateSupportedWalk, resolveWalkPose, supportContains, type WalkPose, type WalkWorld } from '../lib/supportedWalk';
import type { SimulationState, UnitId, Vec2 } from '../model/types';
import { buildArchitecture, disposeArchitecture, type Palette } from './architecture';
import { buildWalkWorld } from './walkWorld';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424', muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };
function snapshot(s: SimulationState) {
  const a = buildArchitecture(s, palette);
  try { return buildWalkWorld(s, a)!; } finally { disposeArchitecture(a); }
}
function go(w: WalkWorld, p: WalkPose, end: Vector3, height: number, seen = new Set<number>()) {
  const d = end.clone().sub(p.eye); d.y = 0;
  const n = Math.max(1, Math.ceil(d.length() / .04));
  for (let i = 0; i < n; i++) {
    const before = p.eye.clone(), motion = d.clone().divideScalar(n);
    const result = evaluateSupportedWalk(w, p, motion, height);
    expect(result.accepted, JSON.stringify({ at: p.eye.toArray(), end: end.toArray(), support: p.supportId, result })).toBe(true);
    if (!result.accepted) throw new Error(result.reason);
    expect(p.eye).toEqual(before);
    expect(result.delta.x).toBeCloseTo(motion.x, 8); expect(result.delta.z).toBeCloseTo(motion.z, 8);
    p = result.pose;
    const support = w.supports.find(t => t.id === p.supportId);
    if (support?.kind === 'tread') seen.add(support.partIndex!);
  }
  return p;
}
function route(s: SimulationState, unit: UnitId, from: 'basement' | 'ground') {
  const g = resolveStairGeometry(s, unit, from)!, first = g.parts[0], last = g.parts[17];
  const local = (p: Vec2, y = 0) => new Vector3(...modelWorldPoint(p, y, unit, s));
  const offset = (p: Vec2, other: Vec2, amount: number): Vec2 => {
    const length = Math.hypot(p[0] - other[0], p[1] - other[1]);
    return [p[0] + (p[0] - other[0]) / length * amount, p[1] + (p[1] - other[1]) / length * amount];
  };
  const sourceY = first.bottom + first.height - g.rise / 18;
  const start = local(offset(first.center, g.parts[1].center, first.depth / 2 + .6), sourceY + s.view.eyeHeight);
  const end = local(offset(last.center, g.parts[16].center, last.depth / 2 + .45));
  const points: Vector3[] = [];
  for (let i = 0; i < 18; i++) {
    if (i === 9 && g.layout === 'u-shaped') {
      const landing = g.parts[18];
      const a = local(offset(g.parts[8].center, g.parts[7].center, g.parts[8].depth / 2 + landing.depth / 2 - .1 * (s.buildings[unit].stairScale ?? 1)));
      const b = local(offset(g.parts[9].center, g.parts[10].center, g.parts[9].depth / 2 + landing.depth / 2));
      points.push(a, b);
    }
    points.push(local(g.parts[i].center));
  }
  return { start, end, points, g, local };
}

describe('actual-scene walk snapshot', () => {
  for (const unit of ['south', 'north'] as const) for (const from of ['basement', 'ground'] as const) for (const transformed of [false, true]) {
    it(`${unit} ${from} publicly placed straight stair: 18 risers and reverse floor exit; transformed=${transformed}`, () => {
      let s = applyCadCommand(defaultState(), { type: 'stair', unit, layout: 'straight' });
      s = applyCadCommand(s, { type: 'stair-position', unit, position: unit === 'south' ? [7, 10.5] : from === 'basement' ? [6, 2] : [4, 4] });
      s = applyCadCommand(s, { type: 'stair-rotation', unit, rotation: unit === 'south' ? -90 : 90 });
      if (transformed) {
        s.northBearing = -23;
        Object.assign(s.buildings[unit], { width: s.buildings[unit].width * 1.08, depth: s.buildings[unit].depth * 1.06, rotation: 2 });
      }
      const w = snapshot(s), r = route(s, unit, from), seen = new Set<number>();
      let p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
      expect(p, capsuleBlocker(w, r.start, r.start, s.view.eyeHeight) ?? 'start').not.toBeNull();
      for (const target of [...r.points, r.end]) p = go(w, p, target, s.view.eyeHeight, seen);
      expect(seen.size).toBe(18); expect(p.floor).toBe(r.g.toFloor);
      for (const target of [...r.points].reverse().concat([r.start])) p = go(w, p, target, s.view.eyeHeight);
      expect(p.floor).toBe(from);
    });
  }
  for (const unit of ['south', 'north'] as const) for (const from of ['basement', 'ground'] as const) {
    it(`${unit} ${from} transformed U supports and real round trip`, () => {
      let s = applyCadCommand(defaultState(), { type: 'stair-rotation', unit, rotation: unit === 'south' ? 0 : 180 });
      s = applyCadCommand(s, { type: 'stair-position', unit, position: unit === 'south' ? [5.19, 8.52] : [4.8, 5.085] });
      s.northBearing = -23;
      Object.assign(s.buildings[unit], { width: s.buildings[unit].width * 1.08, depth: s.buildings[unit].depth * 1.06, rotation: 2 });
      const w = snapshot(s), r = route(s, unit, from), seen = new Set<number>();
      let p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
      expect(p, capsuleBlocker(w, r.start, r.start, s.view.eyeHeight) ?? 'unsupported start').not.toBeNull();
      for (const target of [...r.points, r.end]) p = go(w, p, target, s.view.eyeHeight, seen);
      expect(seen.size).toBe(18); expect(p.floor).toBe(r.g.toFloor);
      for (const target of [...r.points].reverse().concat([r.start])) p = go(w, p, target, s.view.eyeHeight);
      expect(p.floor).toBe(from);
    });
  }
  it('accepts the modeled maximum 6/18 riser on a physically clear U flight', () => {
    const s = defaultState(); s.buildings.south.groundHeight = 6; s.buildings.south.roofPeakHeight = 14;
    const w = snapshot(s), r = route(s, 'south', 'ground');
    let p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
    for (const target of [...r.points, r.end]) p = go(w, p, target, s.view.eyeHeight);
    expect(p.eye.y).toBeCloseTo(7.62);
  });
  it('fills only the confirmed lower U ground seam with the rendered entry apron', () => {
    const s = defaultState(), w = snapshot(s), g = resolveStairGeometry(s, 'south', 'ground')!;
    const p = new Vector3(...modelWorldPoint([g.parts[0].center[0], 9.95], 0, 'south', s));
    const contacts = w.supports.filter(t => Math.abs(t.elevation) < .001 && supportContains(t, p));
    expect(contacts).toHaveLength(1); expect(contacts[0]).toMatchObject({ kind: 'entry-apron', partIndex: 19 });
    expect(g.parts.filter(t => t.kind === 'tread')).toHaveLength(18);
    expect(resolveStairGeometry(s, 'south', 'basement')!.parts).toHaveLength(19);
  });
  it('reaches the default south U entry from the actual living-room entry pose', () => {
    const s = initializeProject(defaultState()), w = snapshot(s), r = route(s, 'south', 'ground');
    let p = resolveWalkPose(w, r.local([2.7, 14.4], s.view.eyeHeight), s.view.eyeHeight)!;
    expect(p).not.toBeNull();
    p = go(w, p, r.local([4.5925, 14.4]), s.view.eyeHeight);
    p = go(w, p, r.start, s.view.eyeHeight);
    for (const point of [...r.points, r.end]) p = go(w, p, point, s.view.eyeHeight);
    expect(p.floor).toBe('first');
  });
  it('rejects narrow/low-headroom actual variants without changing the saved pose', () => {
    const s = defaultState(); s.buildings.south.stairScale = .5; s.buildings.south.width = 5;
    const w = snapshot(s), r = route(s, 'south', 'ground'), p = resolveWalkPose(w, r.start, s.view.eyeHeight);
    if (p) {
      const before = p.eye.clone(), d = r.points[2].clone().sub(p.eye); d.y = 0;
      expect(evaluateSupportedWalk(w, p, d, s.view.eyeHeight).accepted).toBe(false); expect(p.eye).toEqual(before);
    } else expect(resolveWalkPose(w, r.local(r.g.parts[0].center, 1.81), s.view.eyeHeight)).toBeNull();
    const low = defaultState(); low.buildings.south.basementDepth = 1;
    const lowWorld = snapshot(low), lowRoute = route(low, 'south', 'basement');
    expect(resolveWalkPose(lowWorld, lowRoute.start, low.view.eyeHeight)).toBeNull();
  });
  it('follows legal compact treads without demanding a .44m longitudinal stance', () => {
    const s = defaultState(); s.buildings.south.stairScale = .75;
    const w = snapshot(s), r = route(s, 'south', 'ground');
    expect(r.g.parts[0].depth).toBeLessThan(.22);
    let p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
    expect(p).not.toBeNull();
    for (const target of [...r.points, r.end]) p = go(w, p, target, s.view.eyeHeight);
    expect(p.floor).toBe('first');
  });
  for (const unit of ['south', 'north'] as const) for (const initialized of [false, true]) {
    it(`${unit} U ground round trip: all 18 rises, real U turn, floor exit, reverse; initialized=${initialized}`, () => {
      const s = applyCadCommand(initialized ? initializeProject(defaultState()) : defaultState(), { type: 'stair-rotation', unit, rotation: unit === 'south' ? 0 : 180 });
      const w = snapshot(s), r = route(s, unit, 'ground'), seen = new Set<number>();
      let p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
      expect(p).not.toBeNull();
      for (const target of [...r.points, r.end]) p = go(w, p, target, s.view.eyeHeight, seen);
      expect(seen.size).toBe(18); expect(p.floor).toBe('first'); expect(p.stairId).toBeNull(); expect(p.eye.y).toBeCloseTo(5.02);
      const restored = resolveWalkPose(snapshot({ ...s, minutes: s.minutes + 10 }), p.eye, s.view.eyeHeight);
      expect(restored).toMatchObject({ floor: 'first', mode: 'supported' }); expect(restored!.eye).toEqual(p.eye);
      seen.clear();
      for (const target of [...r.points].reverse().concat([r.start])) p = go(w, p, target, s.view.eyeHeight, seen);
      expect(seen.size).toBe(18); expect(p.floor).toBe('ground'); expect(p.stairId).toBeNull(); expect(p.eye.y).toBeCloseTo(1.62);
    });
  }
  it('default north ground approaches are physically obstructed; no blanket exemption', () => {
    const s = defaultState(), w = snapshot(s), r = route(s, 'north', 'ground');
    expect(capsuleBlocker(w, r.start, r.start, s.view.eyeHeight)).toContain('ground-wall-3-north');
    expect(resolveWalkPose(w, r.start, s.view.eyeHeight)).toBeNull();
    const east = r.local([5.96, 6.3], s.view.eyeHeight);
    expect(capsuleBlocker(w, east, east, s.view.eyeHeight)).toContain('ground-wall-17-north');
  });
  it('rejects the discovered north straight basement wall conflict rather than bypassing its doorway frame', () => {
    let s = applyCadCommand(defaultState(), { type: 'stair', unit: 'north', layout: 'straight' });
    s = applyCadCommand(s, { type: 'stair-position', unit: 'north', position: [4, 3] });
    s = applyCadCommand(s, { type: 'stair-rotation', unit: 'north', rotation: 90 });
    const w = snapshot(s), r = route(s, 'north', 'basement');
    const p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
    expect(p).not.toBeNull();
    const d = r.points[4].clone().sub(p.eye); d.y = 0;
    expect(evaluateSupportedWalk(w, p, d, s.view.eyeHeight)).toMatchObject({ accepted: false, reason: 'collision', blocker: 'opening:north:basement:basement-wall-10-north-opening-0:0' });
  });
  it('snapshot owns geometry, preserves hidden blockers and adds only the physical balcony locally', () => {
    const s = defaultState(); s.buildings.north.firstFloorVariant = 'open-plan';
    const a = buildArchitecture(s, palette); a.group.visible = false;
    const w = buildWalkWorld(s, a)!;
    expect(w.colliders).toHaveLength(a.blockers.length + 1);
    expect(w.supports.some(t => t.kind === 'balcony')).toBe(true);
    expect(w.supports.some(t => t.id.includes('roof') || t.id.includes('furniture') || t.id.includes('grass'))).toBe(false);
    const original = w.colliders[0].triangles[0].a.clone();
    a.blockers[0].position.set(100, 100, 100); disposeArchitecture(a);
    expect(w.colliders[0].triangles[0].a).toEqual(original);
  });
  it('reconstructs contacts on stairs/landing, keeps free bookmarks, invalidates moved supports without teleporting', () => {
    const s = defaultState(), w = snapshot(s), r = route(s, 'south', 'ground');
    let p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
    p = go(w, p, r.points[4], s.view.eyeHeight);
    expect(resolveWalkPose(w, p.eye, s.view.eyeHeight)).toMatchObject({ stairId: 'stair-south-ground', mode: 'supported' });
    const harmless = snapshot({ ...s, minutes: s.minutes + 1 });
    expect(resolveWalkPose(harmless, p.eye, s.view.eyeHeight, p)!.eye).toEqual(p.eye);
    const moved = snapshot(applyCadCommand(s, { type: 'stair-position', unit: 'south', position: [8, 11] }));
    expect(resolveWalkPose(moved, p.eye, s.view.eyeHeight, p)).toBeNull();
    expect(resolveWalkPose(snapshot(s), p.eye, s.view.eyeHeight, p)!.eye).toEqual(p.eye);
    const up = evaluateFreeWalk(w, p, new Vector3(0, .2, 0), s.view.eyeHeight);
    expect(up.accepted).toBe(true);
    if (up.accepted) {
      const bookmark = resolveWalkPose(harmless, up.pose.eye, s.view.eyeHeight);
      expect(bookmark?.mode).toBe('free'); expect(bookmark?.eye).toEqual(up.pose.eye);
    }
    p = go(w, p, r.points[9], s.view.eyeHeight);
    expect(resolveWalkPose(w, p.eye, s.view.eyeHeight)).toMatchObject({ stairId: 'stair-south-ground' });
  });
  it.each(['last tread', 'near exit floor'] as const)('PageUp and elevated bookmark use destination headroom on the %s', location => {
    const s = initializeProject(defaultState()), w = snapshot(s), r = route(s, 'south', 'ground');
    const last = r.g.parts[17];
    const at = location === 'last tread' ? last.center : [last.center[0], last.center[1] + last.depth / 2 + .1] as Vec2;
    const p = resolveWalkPose(w, r.local(at, 5.02), s.view.eyeHeight)!;
    expect(p).not.toBeNull();
    expect(p.stairId).toBe(location === 'last tread' ? 'stair-south-ground' : null);
    if (location === 'near exit floor') {
      expect(evaluateFreeWalk(w, p, new Vector3(0, -.5, 0), s.view.eyeHeight)).toMatchObject({ accepted: false, reason: 'collision' });
    }
    const up = evaluateFreeWalk(w, p, new Vector3(0, .08, 0), s.view.eyeHeight);
    expect(up.accepted).toBe(true);
    if (!up.accepted) throw new Error(up.reason);
    expect(up.pose.eye.y).toBeCloseTo(5.10, 7); expect(up.delta.y).toBeCloseTo(.08, 7);
    const saved = new Vector3().fromArray(JSON.parse(JSON.stringify(up.pose.eye.toArray())) as number[]);
    const rebuilt = snapshot({ ...s, minutes: s.minutes + 1 });
    const restored = resolveWalkPose(rebuilt, saved, s.view.eyeHeight)!;
    expect(restored).toMatchObject({ mode: 'free' }); expect(restored.eye).toEqual(saved);
    expect(resolveWalkPose(rebuilt, saved, s.view.eyeHeight, up.pose)?.eye).toEqual(saved);
    const release = evaluateSupportedWalk(rebuilt, restored, new Vector3(), s.view.eyeHeight);
    expect(release).toMatchObject({ accepted: true, delta: new Vector3() });
    const motion = r.end.clone().sub(saved); motion.y = 0;
    const exit = evaluateSupportedWalk(rebuilt, restored, motion, s.view.eyeHeight);
    expect(exit.accepted).toBe(true);
    if (!exit.accepted) throw new Error(exit.reason);
    expect(exit.pose).toMatchObject({ mode: 'free', floor: 'first', stairId: null });
    expect(exit.pose.eye.y).toBeCloseTo(5.10, 7);
    const down = evaluateFreeWalk(rebuilt, exit.pose, new Vector3(0, -.08, 0), s.view.eyeHeight);
    expect(down.accepted).toBe(true);
    if (!down.accepted) throw new Error(down.reason);
    const grounded = evaluateSupportedWalk(rebuilt, down.pose, new Vector3(), s.view.eyeHeight);
    expect(grounded).toMatchObject({ accepted: true, pose: { mode: 'supported', floor: 'first', stairId: null } });
    const high = evaluateFreeWalk(w, p, new Vector3(0, 7, 0), s.view.eyeHeight);
    expect(high.accepted).toBe(true);
    if (!high.accepted) throw new Error(high.reason);
    const ceiling = w.floorLimits.find(f => f.unit === 'south' && f.floor === 'first')!.ceiling;
    expect(high.pose.eye.y).toBeCloseTo(ceiling - .8, 7);
    expect(resolveWalkPose(w, r.local(at, ceiling), s.view.eyeHeight)).toBeNull();
    const underSlab = evaluateFreeWalk(w, exit.pose, new Vector3(0, -2, 0), s.view.eyeHeight);
    expect(underSlab.accepted).toBe(true);
    if (underSlab.accepted) expect(underSlab.pose.eye.y).toBeCloseTo(5.02, 7);
  });
  it('does not shortcut flight sides, central gaps, floor holes or unavailable connections', () => {
    const s = defaultState(), w = snapshot(s), r = route(s, 'south', 'ground');
    let p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
    p = go(w, p, r.points[4], s.view.eyeHeight);
    const across = r.local(r.g.parts[13].center).sub(p.eye); across.y = 0;
    expect(evaluateSupportedWalk(w, p, across, s.view.eyeHeight).accepted).toBe(false);
    expect(w.adjacency[p.supportId!].every(id => !id.includes('basement'))).toBe(true);
    s.buildings.south.storeys = 1; s.buildings.south.roofEnabled = false;
    const one = snapshot(s);
    expect(one.supports.some(t => t.stairId === 'stair-south-ground' || t.unit === 'south' && t.floor === 'first')).toBe(false);
    expect(one.supports.some(t => t.stairId === 'stair-south-basement')).toBe(true);
    s.buildings.south.enabled = false;
    expect(snapshot(s).supports.some(t => t.unit === 'south')).toBe(false);
  });
  it('does not exempt the first-floor wall at the default south endpoint side portal', () => {
    const s = defaultState(), w = snapshot(s), r = route(s, 'south', 'ground');
    let p = resolveWalkPose(w, r.start, s.view.eyeHeight)!;
    for (const target of r.points) p = go(w, p, target, s.view.eyeHeight);
    const motion = r.local([6.7, r.g.parts[17].center[1]]).sub(p.eye); motion.y = 0;
    expect(evaluateSupportedWalk(w, p, motion, s.view.eyeHeight)).toMatchObject({ accepted: false, reason: 'collision', blocker: 'wall:south:first:first-wall-13-south:0' });
  });
  it('accepts a physically clear endpoint side portal in both directions', () => {
    const s = applyCadCommand(defaultState(), { type: 'stair-rotation', unit: 'north', rotation: 180 });
    s.buildings.north.firstFloorVariant = 'open-plan';
    const w = snapshot(s), r = route(s, 'north', 'ground');
    let p = resolveWalkPose(w, r.local(r.g.parts[17].center, 5.02), s.view.eyeHeight)!;
    expect(p).not.toBeNull();
    p = go(w, p, r.local([3.25, r.g.parts[17].center[1]]), s.view.eyeHeight);
    expect(p.floor).toBe('first'); expect(p.stairId).toBeNull();
    p = go(w, p, r.points.at(-1)!, s.view.eyeHeight);
    expect(p.stairId).toBe('stair-north-ground');
  });
});