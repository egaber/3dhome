import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyCadCommand, getWallApertures, modelWorldPoint, resolveStairGeometry } from '../model/cad';
import { BASE_DEPTH, BASE_WIDTH, EDITABLE_WALLS, FOOTPRINTS, SLAB, WALLS, defaultState, floorElevation, resolvedFurniture, resolvedWalls } from '../model/plans';
import { furnitureParts } from '../model/furnitureParts';
import type { FloorId, SimulationState, UnitId, Vec2 } from '../model/types';
import { buildArchitecture, disposeArchitecture, type Architecture, type Palette } from './architecture';

const palette: Palette = { background: '#f7f4ef', surface: '#ffffff', soft: '#f5f5f5', border: '#dedede', text: '#242424',
  muted: '#5c5c5c', accent: '#b11f4b', success: '#16a34a', warning: '#f59e0b', link: '#0078d4', wall: '#f4f1e8' };
function down(meshes: THREE.Mesh[], p: Vec2, elevation: number, unit: UnitId, s: SimulationState) {
  const origin = new THREE.Vector3(...modelWorldPoint(p, elevation + .1, unit, s));
  return new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, SLAB + .2).intersectObjects(meshes, false);
}
function slab(a: Architecture, unit: UnitId, floor: FloorId) { return a.measurementTargets.filter(m => m.userData.role === 'slab' && m.userData.unit === unit && m.userData.floor === floor); }
function inside(p: Vec2, ring: Vec2[]) {
  let value = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) value = !value;
  }
  return value;
}

describe('actual generated stair meshes and destination slab rays', () => {
  for (const unit of ['north', 'south'] as const) for (const layout of ['straight', 'u-shaped'] as const) for (const transformed of [false, true]) {
    it(`${unit} ${layout} transformed=${transformed}: returned parts and holes agree`, () => {
      const s = defaultState(); s.buildings[unit].stairLayout = layout;
      if (transformed) { Object.assign(s.buildings[unit], { x: 8, z: -9, rotation: 39, width: BASE_WIDTH * 1.3, depth: BASE_DEPTH[unit] * .7 }); s.northBearing = -71; }
      const a = buildArchitecture(s, palette);
      try {
        for (const from of ['basement', 'ground'] as const) {
          const stair = resolveStairGeometry(s, unit, from)!;
          const meshes = a.measurementTargets.filter(m => m.userData.stairId === `stair-${unit}-${from}`);
          expect(meshes).toHaveLength(stair.parts.length);
          stair.parts.forEach((p, index) => {
            const m = meshes[index], world = m.getWorldPosition(new THREE.Vector3());
            const expected = modelWorldPoint(p.center, p.bottom + p.height / 2, unit, s);
            expect(world.distanceTo(new THREE.Vector3(...expected))).toBeLessThan(1e-8);
            m.geometry.computeBoundingBox();
            const size = m.geometry.boundingBox!.getSize(new THREE.Vector3());
            expect(size.x).toBeCloseTo(p.width, 6); expect(size.z).toBeCloseTo(p.depth, 6); expect(size.y).toBeCloseTo(p.height, 6);
            expect(a.blockers).toContain(m); expect(a.pickables).toContain(m);
            const top = down([m], p.center, p.bottom + p.height, unit, s);
            expect(top.length).toBeGreaterThan(0); expect(top[0].point.y).toBeCloseTo(p.bottom + p.height, 6);
          });
          const floorMeshes = slab(a, unit, stair.toFloor); expect(floorMeshes).toHaveLength(1);
          const elevation = floorElevation(stair.toFloor, s.buildings[unit]);
          // A dense local grid checks both cutout misses AND surrounding solid hits,
          // including the longer straight extension and the retained other flight.
          // Sample off Float32 triangle edges; test both sides of the aperture edge below.
          for (let x = 3.413; x < 6.7; x += .37) for (let z = unit === 'north' ? 1.513 : 6.913; z < (unit === 'north' ? 6.7 : 10.4); z += .31) {
            const p: Vec2 = [x, z];
            const expected = inside(p, FOOTPRINTS[stair.toFloor][unit]) && !inside(p, stair.footprint);
            expect(down(floorMeshes, p, elevation, unit, s).length > 0, `${stair.toFloor} ${p}`).toBe(expected);
          }
          const edge = stair.footprint[2][1], x = (stair.footprint[0][0] + stair.footprint[1][0]) / 2;
          expect(down(floorMeshes, [x, edge - .001], elevation, unit, s)).toHaveLength(0);
          expect(down(floorMeshes, [x, edge + .001], elevation, unit, s).length).toBeGreaterThan(0);
        }
        const p: Vec2 = unit === 'north' ? [4.2, 5] : [4.6, 8.5];
        expect(down(slab(a, unit, 'basement'), p, -s.buildings[unit].basementDepth, unit, s).length).toBeGreaterThan(0);
        const roof = a.measurementTargets.filter(m => m.userData.role === 'roof-floor-slab' && m.userData.unit === unit);
        expect(down(roof, p, s.buildings[unit].groundHeight + s.buildings[unit].upperHeight, unit, s).length).toBeGreaterThan(0);
        expect(a.measurementTargets.some(m => m.userData.fromFloor === 'first' || m.userData.toFloor === 'roof')).toBe(false);
      } finally { disposeArchitecture(a); }
    });
  }
  it.each(['north', 'south'] as const)('has no first flight/first slab with one storey and no holes in the flat roof of %s', unit => {
    const s = defaultState(); s.buildings[unit].storeys = 1; s.buildings[unit].roofEnabled = false; s.buildings[unit].stairLayout = 'straight';
    const a = buildArchitecture(s, palette);
    try {
      expect(slab(a, unit, 'first')).toEqual([]);
      expect(a.measurementTargets.filter(m => m.userData.stairId === `stair-${unit}-ground`)).toEqual([]);
      const p: Vec2 = unit === 'north' ? [4.2, 5] : [4.6, 8.5];
      expect(down(a.measurementTargets.filter(m => m.userData.role === 'roof' && m.userData.unit === unit), p, s.buildings[unit].groundHeight, unit, s).length).toBeGreaterThan(0);
    } finally { disposeArchitecture(a); }
    s.buildings[unit].enabled = false; const disabled = buildArchitecture(s, palette);
    try { expect(disabled.measurementTargets.some(m => m.userData.unit === unit)).toBe(false); } finally { disposeArchitecture(disabled); }
  });
});

describe('actual variant aperture/furniture scene integration', () => {
  it('only renders canonical active concept wall/glazing IDs and keeps deck decoration', () => {
    const s = defaultState(); s.buildings.north.firstFloorVariant = 'open-plan';
    const a = buildArchitecture(s, palette);
    try {
      const walls = a.pickables.filter(m => m.userData.unit === 'north' && m.userData.floor === 'first' && m.userData.role === 'wall');
      expect(walls.map(m => m.userData.wallId).sort()).toEqual(EDITABLE_WALLS.filter(w => w.provenance === 'concept').map(w => w.id).sort());
      expect(walls.every(m => m.userData.provenance === 'concept')).toBe(true);
      expect(a.pickables.some(m => m.userData.role === 'balcony' && m.userData.unit === 'north')).toBe(true);
      expect(a.pickables.filter(m => m.userData.role === 'opening' && m.userData.unit === 'north' && m.userData.floor === 'first').every(m => m.userData.openingId.startsWith('concept'))).toBe(true);
    } finally { disposeArchitecture(a); }
  });
  it('rays through a moved, rotated and nonuniformly scaled wall respect openings and shutters', () => {
    let s = defaultState(); const wall = WALLS[0], id = wall.openings[0].id;
    s = applyCadCommand(s, { type: 'wall', id: wall.id, edit: { a: [1, 1], b: [7, 5], deleted: false } });
    for (const opening of wall.openings) s = applyCadCommand(s, { type: 'delete-opening', id: opening.id });
    s = applyCadCommand(s, { type: 'opening', id, patch: { width: 1.2, height: 1.35, sill: .95, position: .5 } });
    Object.assign(s.buildings.north, { width: 15, depth: 5, x: 3, z: -4, rotation: -27 }); s.northBearing = 48;
    for (const shutter of [false, true]) {
      s = applyCadCommand(s, { type: 'opening', id, patch: { shutter } });
      const a = buildArchitecture(s, palette);
      try {
        const wallMesh = a.pickables.find(m => m.userData.wallId === wall.id && m.userData.role === 'wall')!;
        const aperture = getWallApertures(resolvedWalls(s).find(w => w.id === wall.id)!, s)[0];
        const origin = wallMesh.parent!.localToWorld(new THREE.Vector3(aperture.center, aperture.sill + aperture.height / 2, -1));
        const target = wallMesh.parent!.localToWorld(new THREE.Vector3(aperture.center, aperture.sill + aperture.height / 2, 1));
        const ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize(), 0, origin.distanceTo(target));
        expect(ray.intersectObject(wallMesh, false)).toEqual([]);
        const blockers = a.blockers.filter(m => m.userData.wallId === wall.id);
        expect(ray.intersectObjects(blockers, false).length > 0).toBe(shutter);
        expect(ray.intersectObjects(a.measurementTargets.filter(m => m.userData.openingId === id), false).length).toBeGreaterThan(0);
      } finally { disposeArchitecture(a); }
    }
  });
  it('places each shared furniture part under local rotation BEFORE unit scale, independently and nonblocking', () => {
    let s = defaultState(); Object.assign(s.buildings.north, { width: 15, depth: 5, x: -3, z: 7, rotation: 39 });
    const seed = resolvedFurniture(s).find(i => i.kind === 'sink' && i.unit === 'north')!;
    s = applyCadCommand(s, { type: 'furniture', id: seed.id, edit: { center: [5, 3], rotation: 50, width: 1.1, depth: .8, height: 1.2, deleted: false } });
    const a = buildArchitecture(s, palette);
    try {
      for (const item of resolvedFurniture(s)) {
        const meshes = a.measurementTargets.filter(m => m.userData.furnitureId === item.id), parts = furnitureParts(item);
        expect(meshes).toHaveLength(parts.length);
        parts.forEach((part, i) => {
          const r = -item.rotation * Math.PI / 180, [x, z] = part.center;
          const local: Vec2 = [item.center[0] + x * Math.cos(r) + z * Math.sin(r), item.center[1] - x * Math.sin(r) + z * Math.cos(r)];
          const expected = modelWorldPoint(local, floorElevation(item.floor, s.buildings[item.unit]) + part.bottom + part.height / 2, item.unit, s);
          expect(meshes[i].getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(...expected))).toBeLessThan(1e-8);
          expect(a.blockers).not.toContain(meshes[i]); expect(a.pickables).toContain(meshes[i]); expect(meshes[i].userData.opaque).toBe(false);
        });
      }
      expect(a.measurementTargets.every(m => m instanceof THREE.Mesh && m.userData.role !== 'outline')).toBe(true);
      expect(a.measurementTargets.some(m => ['grid', 'sunlight', 'reference', 'person'].includes(m.userData.role))).toBe(false);
    } finally { disposeArchitecture(a); }
  });
  it('disposes actual generated geometries, outlines, shared materials exactly once', () => {
    const a = buildArchitecture(defaultState(), palette), parent = new THREE.Group(); parent.add(a.group);
    const geometries = new Set<THREE.BufferGeometry>();
    a.group.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Line) geometries.add(o.geometry); });
    const spies = [...geometries].map(g => vi.spyOn(g, 'dispose'));
    const materials = [...new Set(a.materials)].map(m => vi.spyOn(m, 'dispose'));
    disposeArchitecture(a);
    for (const spy of [...spies, ...materials]) { expect(spy).toHaveBeenCalledTimes(1); spy.mockRestore(); }
    expect(a.group.parent).toBeNull();
  });
});