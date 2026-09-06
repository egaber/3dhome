import * as THREE from 'three';

export interface Aperture {
  id: string;
  /** Metres from the wall's start along its length. */
  center: number;
  width: number;
  /** Metres above the floor; zero permits a door without a threshold. */
  sill: number;
  height: number;
}

export interface WallPanel {
  /** Left edge along the wall, in metres. */
  x: number;
  /** Bottom edge above the floor, in metres. */
  y: number;
  width: number;
  height: number;
}

export interface NormalizedAperture extends Aperture {}

const MIN_APERTURE_WIDTH = 0.05;
const TOP_CLEARANCE = 0.05;

function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero.`);
  }
}

/**
 * Return independent, unmutated copies, preserving IDs and input order.
 * Wall dimensions must be finite and positive. Aperture dimensions must be
 * finite and nonnegative; a zero width or height disables an aperture.
 *
 * Positive widths are clamped to [min(0.05, length), length], and centers are
 * moved only as far as necessary to fit horizontally (no extra jamb margin).
 * Negative sills become zero. Heights are limited by a 0.05 m top clearance;
 * positive short heights are not enlarged. An aperture with no room above its
 * sill is dropped, never relocated downwards. Walls at most 0.05 m high have
 * no apertures. Overlaps are deliberately retained for union subtraction.
 */
export function normalizeApertures(
  length: number,
  wallHeight: number,
  openings: Aperture[],
): Aperture[] {
  requirePositive(length, 'length');
  requirePositive(wallHeight, 'wallHeight');

  const normalized: NormalizedAperture[] = [];
  for (const [index, opening] of openings.entries()) {
    // Validate even disabled/out-of-wall apertures: NaN must not disappear
    // silently just because another field would have disabled this opening.
    for (const field of ['center', 'width', 'sill', 'height'] as const) {
      if (!Number.isFinite(opening[field])) {
        throw new RangeError(`openings[${index}].${field} must be a finite number.`);
      }
    }
    for (const field of ['width', 'height'] as const) {
      if (opening[field] < 0) {
        throw new RangeError(`openings[${index}].${field} must be nonnegative (zero disables it).`);
      }
    }
    if (opening.width === 0 || opening.height === 0) continue;

    const sill = Math.max(0, opening.sill);
    const availableHeight = wallHeight - TOP_CLEARANCE - sill;
    if (availableHeight <= 0) continue;

    // Clamp before arithmetic so even very large finite user inputs stay finite.
    const width = Math.min(length, Math.max(MIN_APERTURE_WIDTH, opening.width));
    const center = Math.max(width / 2, Math.min(length - width / 2, opening.center));
    normalized.push({
      id: opening.id,
      center,
      width,
      sill,
      height: Math.min(opening.height, availableHeight),
    });
  }
  return normalized;
}

/** Partition the wall's solid area, subtracting the UNION of all apertures. */
export function splitWall(length: number, height: number, openings: Aperture[]): WallPanel[] {
  const holes = normalizeApertures(length, height, openings).map((opening) => ({
    left: Math.max(0, opening.center - opening.width / 2),
    right: Math.min(length, opening.center + opening.width / 2),
    bottom: opening.sill,
    top: Math.min(height, opening.sill + opening.height),
  }));

  // Sorting vertically once also sorts every active subset in the x sweep.
  holes.sort((a, b) => a.bottom - b.bottom || a.top - b.top);
  const edges = [...new Set([0, length, ...holes.flatMap((hole) => [hole.left, hole.right])])]
    .sort((a, b) => a - b);
  const panels: WallPanel[] = [];

  for (let i = 0; i < edges.length - 1; i += 1) {
    const x = edges[i];
    const right = edges[i + 1];
    const width = right - x;
    let y = 0;

    // No aperture starts/ends inside this strip. Complement the sorted vertical
    // union, merging both overlaps and touching intervals via the cursor.
    for (const hole of holes) {
      if (hole.left >= right || hole.right <= x) continue;
      if (hole.bottom > y) {
        panels.push({ x, y, width, height: hole.bottom - y });
      }
      y = Math.max(y, hole.top);
    }
    if (y < height) panels.push({ x, y, width, height: height - y });
  }
  // Deliberately no epsilon-based merging: it could erase thin solid piers.
  return panels;
}

// Four counterclockwise corners per outward-facing box side.
const BOX_FACES = [
  { corners: [4, 5, 6, 7], normal: [0, 0, 1] }, // front
  { corners: [1, 0, 3, 2], normal: [0, 0, -1] }, // back
  { corners: [5, 1, 2, 6], normal: [1, 0, 0] }, // right
  { corners: [0, 4, 7, 3], normal: [-1, 0, 0] }, // left
  { corners: [7, 6, 2, 3], normal: [0, 1, 0] }, // top
  { corners: [0, 1, 5, 4], normal: [0, -1, 0] }, // bottom
] as const;
const QUAD_TRIANGLES = [0, 1, 2, 0, 2, 3] as const;
const QUAD_UVS = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;

/**
 * One nonindexed geometry of closed panel boxes, with real full-depth holes
 * and outward-facing jamb/sill/lintel reveals. Coordinates are x in [0,length],
 * y in [0,height], and z in [-thickness/2, thickness/2]. Internal panel faces
 * may coincide within solid material, but never fill an aperture.
 *
 * Includes flat normals, per-face UVs, and computed bounds. The caller owns
 * disposal and sets castShadow/receiveShadow on the Mesh, not the geometry.
 */
export function buildWallGeometry(
  length: number,
  height: number,
  thickness: number,
  openings: Aperture[],
): THREE.BufferGeometry {
  requirePositive(thickness, 'thickness');
  const panels = splitWall(length, height, openings);
  const halfDepth = thickness / 2;
  for (const [name, value] of [
    ['length', length], ['height', height], ['thickness / 2', halfDepth],
  ] as const) {
    const coordinate = Math.fround(value);
    if (!Number.isFinite(coordinate) || coordinate <= 0) {
      throw new RangeError(`${name} must fit a positive, finite Float32 coordinate.`);
    }
  }

  const vertexCount = panels.length * 36;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let vertex = 0;

  for (const panel of panels) {
    const x0 = panel.x;
    const x1 = panel.x + panel.width;
    const y0 = panel.y;
    const y1 = panel.y + panel.height;
    const corners = [
      [x0, y0, -halfDepth], [x1, y0, -halfDepth],
      [x1, y1, -halfDepth], [x0, y1, -halfDepth],
      [x0, y0, halfDepth], [x1, y0, halfDepth],
      [x1, y1, halfDepth], [x0, y1, halfDepth],
    ];
    for (const face of BOX_FACES) {
      for (const corner of QUAD_TRIANGLES) {
        // Write absolute shared endpoints directly: translating already-rounded
        // Float32 BoxGeometry vertices can introduce cracks between panels.
        positions.set(corners[face.corners[corner]], vertex * 3);
        normals.set(face.normal, vertex * 3);
        uvs.set(QUAD_UVS[corner], vertex * 2);
        vertex += 1;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}