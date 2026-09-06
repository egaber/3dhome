import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { buildWallGeometry, normalizeApertures, splitWall } from './wallGeometry';
import type { Aperture, NormalizedAperture, WallPanel } from './wallGeometry';

const WINDOW: NormalizedAperture = { id: 'window', center: 2, width: 2, sill: 1, height: 1 };
const OVERLAPPING: Aperture[] = [
  { id: 'a', center: 2, width: 2, sill: 1, height: 2 },
  { id: 'b', center: 3, width: 2, sill: 1.5, height: 2 },
];
const disposables: { dispose(): void }[] = [];

afterEach(() => {
  for (const resource of disposables.splice(0)) resource.dispose();
});

function area(panels: WallPanel[]): number {
  return panels.reduce((sum, panel) => sum + panel.width * panel.height, 0);
}

function aperturePanel(opening: Aperture): WallPanel {
  return { x: opening.center - opening.width / 2, y: opening.sill, width: opening.width, height: opening.height };
}

function overlapArea(a: WallPanel, b: WallPanel): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

// Independent oracle: inclusion-exclusion, NOT another sweep implementation.
// Only used with small test sets (at most seven openings).
function unionArea(openings: Aperture[]): number {
  let total = 0;
  for (let mask = 1; mask < 2 ** openings.length; mask += 1) {
    let left = -Infinity;
    let right = Infinity;
    let bottom = -Infinity;
    let top = Infinity;
    let count = 0;
    for (let i = 0; i < openings.length; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      const opening = openings[i];
      left = Math.max(left, opening.center - opening.width / 2);
      right = Math.min(right, opening.center + opening.width / 2);
      bottom = Math.max(bottom, opening.sill);
      top = Math.min(top, opening.sill + opening.height);
      count += 1;
    }
    total += (count % 2 === 1 ? 1 : -1) * Math.max(0, right - left) * Math.max(0, top - bottom);
  }
  return total;
}

function expectPartition(length: number, height: number, openings: Aperture[]): WallPanel[] {
  const normalized = normalizeApertures(length, height, openings);
  const panels = splitWall(length, height, openings);
  expect(area(panels)).toBeCloseTo(length * height - unionArea(normalized), 10);
  for (const [i, panel] of panels.entries()) {
    expect(panel.width).toBeGreaterThan(0);
    expect(panel.height).toBeGreaterThan(0);
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(length + 1e-12);
    expect(panel.y + panel.height).toBeLessThanOrEqual(height + 1e-12);
    for (const opening of normalized) {
      expect(overlapArea(panel, aperturePanel(opening))).toBeLessThan(1e-12);
    }
    for (const other of panels.slice(i + 1)) {
      expect(overlapArea(panel, other)).toBeLessThan(1e-12);
    }
  }
  return panels;
}

function wall(length = 4, height = 3, thickness = 0.4, openings: Aperture[] = [WINDOW]) {
  const geometry = buildWallGeometry(length, height, thickness, openings);
  const material = new THREE.MeshBasicMaterial(); // FrontSide: catches incorrect winding.
  disposables.push(geometry, material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function ray(mesh: THREE.Mesh, origin: [number, number, number], direction: [number, number, number]) {
  return new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize())
    .intersectObject(mesh, false);
}

function through(mesh: THREE.Mesh, x: number, y: number, side = 1) {
  return ray(mesh, [x, y, 5 * side], [0, 0, -side]);
}

describe('normalizeApertures', () => {
  it('preserves IDs, order, overlaps, and duplicate IDs without mutating the input', () => {
    const input = [
      { ...WINDOW, id: 'same' },
      { ...WINDOW, id: 'same', center: 2.5 },
      { ...WINDOW, id: 'third', width: 1 },
    ];
    const before = structuredClone(input);
    input.forEach(Object.freeze);
    Object.freeze(input);
    const normalized = normalizeApertures(6, 4, input);
    expect(normalized).toEqual(before);
    expect(normalized).not.toBe(input);
    normalized.forEach((opening, i) => expect(opening).not.toBe(input[i]));
    normalized[0].width = 0.25;
    expect(input).toEqual(before);
  });

  it('drops zero width/height instead of enlarging a disabled opening', () => {
    expect(normalizeApertures(4, 3, [
      { ...WINDOW, width: 0 }, { ...WINDOW, height: 0 }, { ...WINDOW, width: -0 },
    ])).toEqual([]);
  });

  it('enforces the positive minimum width and clamps centers at either wall boundary', () => {
    const [left, right, narrow] = normalizeApertures(4, 3, [
      { ...WINDOW, id: 'left', center: -100 },
      { ...WINDOW, id: 'right', center: 100 },
      { ...WINDOW, id: 'narrow', width: 0.001 },
    ]);
    expect(left.center).toBe(1);
    expect(right.center).toBe(3);
    expect(narrow.width).toBe(0.05);
    expect(narrow.center).toBe(2);
  });

  it('clamps oversized finite values before arithmetic and permits a ground-level door', () => {
    const [opening] = normalizeApertures(4, 3, [{
      id: 'large', center: Number.MAX_VALUE, width: Number.MAX_VALUE,
      sill: -Number.MAX_VALUE, height: Number.MAX_VALUE,
    }]);
    expect(opening).toEqual({ id: 'large', center: 2, width: 4, sill: 0, height: 2.95 });
    expect(normalizeApertures(4, 3, [{ ...WINDOW, center: -Number.MAX_VALUE }])[0].center).toBe(1);
  });

  it('keeps a 0.05 m lintel without requiring a 0.05 m threshold', () => {
    const [door, high] = normalizeApertures(4, 3, [
      { ...WINDOW, id: 'door', sill: 0, height: 10 },
      { ...WINDOW, id: 'high', sill: 2.6, height: 10 },
    ]);
    expect(door.sill).toBe(0);
    expect(door.height).toBeCloseTo(2.95, 12);
    expect(high.sill).toBe(2.6);
    expect(high.height).toBeCloseTo(0.35, 12);
    expect(high.sill + high.height).toBeCloseTo(2.95, 12);
  });

  it.each([2.95, 3, 3.1, Number.MAX_VALUE])('drops a sill at %s, never shifting it to the floor', (sill) => {
    expect(normalizeApertures(4, 3, [{ ...WINDOW, sill }])).toEqual([]);
    expect(splitWall(4, 3, [{ ...WINDOW, sill }])).toEqual([{ x: 0, y: 0, width: 4, height: 3 }]);
  });

  it('retains genuinely small positive heights, including the last space below the lintel', () => {
    const [short, high] = normalizeApertures(4, 3, [
      { ...WINDOW, id: 'short', height: 0.001 },
      { ...WINDOW, id: 'high', sill: 2.94, height: 1 },
    ]);
    expect(short.height).toBe(0.001);
    expect(high.sill).toBe(2.94);
    expect(high.height).toBeCloseTo(0.01, 12);
  });

  it('fits narrow/short walls without negative dimensions or invented minimum heights', () => {
    const [opening] = normalizeApertures(0.03, 0.06, [{ ...WINDOW, sill: 0 }]);
    expect(opening.width).toBe(0.03);
    expect(opening.center).toBe(0.015);
    expect(opening.height).toBeCloseTo(0.01, 12);
    for (const height of [0.05, 0.04, 1e-6]) {
      expect(normalizeApertures(0.03, height, [WINDOW])).toEqual([]);
      expect(splitWall(0.03, height, [WINDOW])).toEqual([{ x: 0, y: 0, width: 0.03, height }]);
    }
  });

  it('is idempotent, including clamped dimensions and overlapping openings', () => {
    const once = normalizeApertures(4, 3, [
      { ...WINDOW, width: 10, center: -10, sill: -1, height: 10 },
      { ...WINDOW, center: 1.375, width: 0.001, sill: 2.94 },
    ]);
    expect(normalizeApertures(4, 3, once)).toEqual(once);
  });

  it.each(['center', 'width', 'sill', 'height'] as const)('rejects non-finite %s rather than inventing values', (field) => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const input = [{ ...WINDOW, [field]: value }];
      for (const action of [
        () => normalizeApertures(4, 3, input),
        () => splitWall(4, 3, input),
        () => buildWallGeometry(4, 3, 0.2, input),
      ]) {
        expect(action).toThrow(RangeError);
        expect(action).toThrow(`openings[0].${field}`);
      }
    }
  });

  it.each(['width', 'height'] as const)('rejects negative %s while reserving zero for disabled openings', (field) => {
    expect(() => normalizeApertures(4, 3, [{ ...WINDOW, [field]: -1 }]))
      .toThrow(new RegExp(`${field} must be nonnegative`));
  });

  it('validates fields even on disabled, out-of-wall, or too-short-wall openings', () => {
    for (const opening of [
      { ...WINDOW, width: 0, center: NaN },
      { ...WINDOW, height: 0, sill: Infinity },
      { ...WINDOW, sill: 3, width: NaN },
    ]) {
      expect(() => normalizeApertures(4, 3, [opening])).toThrow(RangeError);
      expect(() => normalizeApertures(4, 0.01, [opening])).toThrow(RangeError);
    }
  });
});

describe('wall dimension validation', () => {
  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid wall length/height %s across all APIs', (value) => {
    for (const [length, height] of [[value, 3], [4, value]]) {
      expect(() => normalizeApertures(length, height, [])).toThrow(RangeError);
      expect(() => splitWall(length, height, [])).toThrow(RangeError);
      expect(() => buildWallGeometry(length, height, 0.2, [])).toThrow(RangeError);
    }
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid thickness %s', (thickness) => {
    expect(() => buildWallGeometry(4, 3, thickness, [])).toThrow(RangeError);
    expect(() => buildWallGeometry(4, 3, thickness, [])).toThrow(/thickness/);
  });

  it('throws instead of generating infinite or underflowed Float32 wall coordinates', () => {
    for (const value of [Number.MAX_VALUE, Number.MIN_VALUE]) {
      for (const [length, height, thickness] of [[value, 3, 0.2], [4, value, 0.2], [4, 3, value]]) {
        expect(() => buildWallGeometry(length, height, thickness, [])).toThrow(/Float32/);
      }
    }
  });
});

describe('splitWall: horizontal sweep and vertical union', () => {
  it('returns the whole wall with no enabled openings', () => {
    expect(splitWall(4, 3, [])).toEqual([{ x: 0, y: 0, width: 4, height: 3 }]);
    expect(splitWall(4, 3, [{ ...WINDOW, height: 0 }])).toEqual(splitWall(4, 3, []));
  });

  it('returns exact positive-area piers, sill, and lintel for one window', () => {
    expect(expectPartition(4, 3, [WINDOW])).toEqual([
      { x: 0, y: 0, width: 1, height: 3 },
      { x: 1, y: 0, width: 2, height: 1 },
      { x: 1, y: 2, width: 2, height: 1 },
      { x: 3, y: 0, width: 1, height: 3 },
    ]);
  });

  it('subtracts an L-shaped overlapping union, not the sum or bounding rectangle', () => {
    const panels = expectPartition(6, 4, OVERLAPPING);
    // 24 - (4 + 4 - 1 * 1.5) = 17.5 square metres.
    expect(area(panels)).toBe(17.5);
    expect(splitWall(6, 4, [...OVERLAPPING].reverse())).toEqual(panels);
  });

  it('does not refill or double-subtract identical and nested holes', () => {
    const outer = { id: 'outer', center: 3, width: 4, sill: 0.5, height: 3 };
    const panels = expectPartition(6, 4, [outer, { ...outer, id: 'duplicate' }, WINDOW]);
    expect(area(panels)).toBe(12);
  });

  it('unions touching edges without zero-area panels, while preserving separate vertical gaps', () => {
    expectPartition(6, 4, [
      { id: 'left', center: 1.5, width: 1, sill: 0.5, height: 1 },
      { id: 'right', center: 2.5, width: 1, sill: 0.5, height: 1 },
      { id: 'above', center: 2, width: 2, sill: 1.5, height: 1 },
    ]);
    const separated = expectPartition(6, 4, [
      { ...WINDOW, sill: 0.5, height: 0.5 },
      { ...WINDOW, id: 'upper', sill: 2, height: 1 },
    ]);
    expect(separated).toContainEqual({ x: 1, y: 1, width: 2, height: 1 });
  });

  it('preserves very thin solid gaps instead of merging nearby boundary events with an epsilon', () => {
    const gap = 1e-10;
    const panels = expectPartition(6, 4, [
      { id: 'left', center: 1.5, width: 1, sill: 0.5, height: 1 },
      { id: 'right', center: 2.5 + gap, width: 1, sill: 0.5, height: 1 },
    ]);
    const pier = panels.find((panel) => panel.x === 2 && panel.width < 1e-8);
    expect(pier).toBeDefined();
    expect(pier!.width).toBeCloseTo(gap, 14);
    expect(pier!.height).toBe(4);
  });

  it('subtracts a full-width ground-level door leaving only the top clearance', () => {
    const panels = expectPartition(4, 3, [{ ...WINDOW, width: 100, sill: 0, height: 100 }]);
    expect(panels).toHaveLength(1);
    expect(panels[0].y).toBeCloseTo(2.95, 12);
    expect(panels[0].height).toBeCloseTo(0.05, 12);
    expect(area(panels)).toBeCloseTo(0.2, 12);
  });

  it('agrees with inclusion-exclusion over reproducible overlapping and clamped cases', () => {
    let seed = 0x50414e45;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let trial = 0; trial < 40; trial += 1) {
      const openings = Array.from({ length: 7 }, (_, i): Aperture => ({
        id: `${trial}-${i}`,
        center: -1 + random() * 8,
        width: 0.001 + random() * 8,
        sill: -0.5 + random() * 5,
        height: 0.001 + random() * 5,
      }));
      const panels = expectPartition(6, 4, openings);
      expect(splitWall(6, 4, [...openings].reverse())).toEqual(panels);
    }
  });
});

describe('buildWallGeometry: actual three-dimensional holes', () => {
  it.each([1, -1])('passes rays through a window, but blocks wall/sill/lintel from side %s', (side) => {
    const mesh = wall();
    expect(through(mesh, 2, 1.5, side)).toHaveLength(0);
    for (const [x, y] of [[0.5, 1.5], [3.5, 1.5], [2, 0.5], [2, 2.5]]) {
      const hits = through(mesh, x, y, side);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].point.z).toBeCloseTo(side * 0.2, 7);
      expect(hits[0].face!.normal.z).toBe(side);
    }
  });

  it('has sharp sill, lintel, and jamb edges, not a painted rectangular window', () => {
    const mesh = wall();
    for (const [x, y] of [[2, 1.0001], [2, 1.9999], [1.0001, 1.5], [2.9999, 1.5]]) {
      expect(through(mesh, x, y)).toHaveLength(0);
    }
    for (const [x, y] of [[2, 0.9999], [2, 2.0001], [0.9999, 1.5], [3.0001, 1.5], [2, 1], [2, 2]]) {
      expect(through(mesh, x, y).length).toBeGreaterThan(0);
    }
  });

  it('leaves a door open all the way to ground zero, including just below 0.05 m', () => {
    const mesh = wall(4, 3, 0.4, [{ ...WINDOW, width: 1, sill: 0, height: 2.1 }]);
    for (const y of [0, 0.0001, 0.025, 1, 2.0999]) {
      expect(through(mesh, 2, y)).toHaveLength(0);
      expect(through(mesh, 2, y, -1)).toHaveLength(0);
    }
    expect(through(mesh, 2, 2.1001).length).toBeGreaterThan(0);
    expect(through(mesh, 1, 0.025).length).toBeGreaterThan(0);
  });

  it('does not move an out-of-wall sill to the floor or cut holes for disabled openings', () => {
    const mesh = wall(4, 3, 0.4, [
      { ...WINDOW, sill: 3 }, { ...WINDOW, width: 0 }, { ...WINDOW, height: 0 },
    ]);
    expect(mesh.geometry.getAttribute('position').count).toBe(36);
    expect(through(mesh, 2, 0.025).length).toBeGreaterThan(0);
    expect(through(mesh, 2, 1.5).length).toBeGreaterThan(0);
  });

  it('has no geometry in either opening or their overlap, but preserves the union concavities', () => {
    const mesh = wall(6, 4, 0.4, OVERLAPPING);
    for (const [x, y] of [[1.5, 1.25], [2.5, 2], [3.5, 3.25], [2, 2], [3, 2]]) {
      expect(through(mesh, x, y)).toHaveLength(0);
      expect(through(mesh, x, y, -1)).toHaveLength(0);
    }
    for (const [x, y] of [[1.5, 3.25], [3.5, 1.25]]) {
      expect(through(mesh, x, y).length).toBeGreaterThan(0);
    }
  });

  it('does not insert a seam face across touching apertures', () => {
    const mesh = wall(4, 3, 0.4, [
      { ...WINDOW, center: 1.5, width: 1 },
      { ...WINDOW, id: 'adjacent', center: 2.5, width: 1 },
    ]);
    expect(through(mesh, 2, 1.5)).toHaveLength(0);
    expect(ray(mesh, [1.5, 1.5, 0], [1, 0, 0])[0].point.x).toBe(3);
  });

  it.each([
    { direction: [-1, 0, 0], point: [1, 1.5, 0], normal: [1, 0, 0] },
    { direction: [1, 0, 0], point: [3, 1.5, 0], normal: [-1, 0, 0] },
    { direction: [0, -1, 0], point: [2, 1, 0], normal: [0, 1, 0] },
    { direction: [0, 1, 0], point: [2, 2, 0], normal: [0, -1, 0] },
  ])('includes a correctly oriented full-depth reveal with normal $normal', ({ direction, point, normal }) => {
    const mesh = wall();
    const hits = ray(mesh, [2, 1.5, 0], direction as [number, number, number]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.toArray()).toEqual(point);
    expect(hits[0].face!.normal.toArray()).toEqual(normal);
  });

  it('lets an oblique sun ray through but blocks a grazing ray on the jamb reveal', () => {
    const mesh = wall();
    expect(ray(mesh, [2, 1.5, 1], [0.2, 0, -1])).toHaveLength(0);
    const hits = ray(mesh, [1.2, 1.5, 1], [-0.2, 0, -1]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.x).toBeCloseTo(1, 12);
    expect(hits[0].point.z).toBeCloseTo(0, 12);
    expect(hits[0].face!.normal.x).toBe(1);
  });

  it('returns one finite nonindexed geometry with UVs, flat outward normals, and the correct solid volume', () => {
    const geometry = wall().geometry;
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uvs = geometry.getAttribute('uv');
    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(geometry.index).toBeNull();
    expect(geometry.groups).toEqual([]);
    expect(positions.count).toBe(splitWall(4, 3, [WINDOW]).length * 36);
    expect(normals.count).toBe(positions.count);
    expect(uvs.count).toBe(positions.count);
    for (const attribute of [positions, normals, uvs]) {
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    }

    let volume = 0;
    let frontArea = 0;
    for (let i = 0; i < positions.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, i);
      const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      expect(cross.length()).toBeGreaterThan(0);
      for (let j = 0; j < 3; j += 1) {
        const normal = new THREE.Vector3().fromBufferAttribute(normals, i + j);
        expect(normal.length()).toBe(1);
        expect(cross.clone().normalize().dot(normal)).toBeCloseTo(1, 12);
      }
      if (normals.getZ(i) === 1) frontArea += cross.length() / 2;
      volume += a.dot(b.clone().cross(c)) / 6;
    }
    expect(frontArea).toBeCloseTo(12 - 2, 10);
    expect(volume).toBeCloseTo((12 - 2) * 0.4, 6);
  });

  it('computes bounds in wall coordinates, centered only through its thickness', () => {
    const geometry = wall(6, 4, 0.4, OVERLAPPING).geometry;
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingBox!.min.x).toBe(0);
    expect(geometry.boundingBox!.min.y).toBe(0);
    expect(geometry.boundingBox!.min.z).toBeCloseTo(-0.2, 7);
    expect(geometry.boundingBox!.max.x).toBe(6);
    expect(geometry.boundingBox!.max.y).toBe(4);
    expect(geometry.boundingBox!.max.z).toBeCloseTo(0.2, 7);
    expect(geometry.boundingSphere!.center.toArray()).toEqual([3, 2, 0]);
    expect(geometry.boundingSphere!.radius).toBeCloseTo(Math.hypot(3, 2, 0.2), 7);
  });

  it('meshes sub-0.05 m walls and thin positive wall thicknesses without NaN', () => {
    const mesh = wall(0.02, 0.04, 0.001, [{ ...WINDOW, sill: 0 }]);
    expect(mesh.geometry.getAttribute('position').count).toBe(36);
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(0.02, 8);
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(0.04, 8);
    expect(mesh.geometry.boundingBox!.max.z).toBeCloseTo(0.0005, 9);
    expect(through(mesh, 0.01, 0.02).length).toBeGreaterThan(0);
  });
});