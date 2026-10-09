import { Box3, Triangle, Vector3 } from 'three';
import { getWallApertures, modelWorldPoint } from '../model/cad';
import { floorElevation, resolvedOpenings, resolvedWalls } from '../model/plans';
import type { OpeningSpec, SimulationState, Vec2 } from '../model/types';
import type { Aperture } from './wallGeometry';
import type { PhysicalCollider } from './supportedWalk';

export const DOOR_REACH = 2.6;
export interface OpeningLeaf { x: number; z: number; width: number; depth: number; height: number; bottom: number; rotation: number; glass: boolean }
export function openingLeaves(opening: OpeningSpec, aperture: Aperture): OpeningLeaf[] {
  const frame = Math.min(.052, aperture.width / 6, aperture.height / 6);
  const width = aperture.width - frame * 2, height = aperture.height - frame * 2, bottom = aperture.sill + frame;
  const leaf = { x: aperture.center, z: 0, width, depth: opening.kind === 'door' ? .045 : .012, height, bottom, rotation: 0, glass: opening.kind !== 'door' && !opening.shutter };
  if (opening.shutter || !opening.open) return [leaf];
  if (opening.kind === 'door') {
    const side = opening.swing === 'negative' ? -1 : 1;
    return [{ ...leaf, x: aperture.center - width / 2, z: side * width / 2, rotation: -side * Math.PI / 2 }];
  }
  if (opening.kind === 'glazing') return [
    { ...leaf, x: aperture.center - width * .26, width: width * .48, z: -.025 },
    { ...leaf, x: aperture.center - width * .26, width: width * .48, z: .025 },
  ];
  return [];
}

export function openingContext(state: SimulationState, id: string) {
  const opening = resolvedOpenings(state).find(item => item.id === id && item.width > 0 && item.height > 0);
  if (!opening || !['door', 'glazing'].includes(opening.kind)) return null;
  const wall = resolvedWalls(state).find(wall => wall.id === opening.wallId);
  if (!wall) return null;
  const aperture = getWallApertures(wall, state).find(item => item.id === id);
  if (!aperture || aperture.sill > .15) return null;
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const along: Vec2 = [(wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length];
  const local = (x: number, z: number): Vec2 => [wall.a[0] + along[0] * x - along[1] * z, wall.a[1] + along[1] * x + along[0] * z];
  const elevation = floorElevation(wall.floor, state.buildings[wall.unit]);
  const handle = new Vector3(...modelWorldPoint(local(aperture.center, 0), elevation + aperture.sill + Math.min(1.15, aperture.height * .6), wall.unit, state));
  return { opening, wall, aperture, elevation, local, handle };
}

export function openingLeafColliders(state: SimulationState, id: string, open: boolean): PhysicalCollider[] {
  const context = openingContext(state, id); if (!context) throw new Error('הפתח אינו מעבר פעיל.');
  const { opening, wall, aperture, local, elevation } = context;
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return openingLeaves({ ...opening, open, shutter: false }, aperture).map((leaf, index) => {
    const points = [leaf.bottom, leaf.bottom + leaf.height].flatMap(y => ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => {
      const x = sx * leaf.width / 2, z = sz * leaf.depth / 2;
      const p = local(leaf.x + x * Math.cos(leaf.rotation) + z * Math.sin(leaf.rotation), leaf.z - x * Math.sin(leaf.rotation) + z * Math.cos(leaf.rotation));
      return new Vector3(...modelWorldPoint(p, elevation + y, wall.unit, state));
    }));
    return { id: `door-leaf:${id}:${index}`, bounds: new Box3().setFromPoints(points), triangles: faces.map(([a, b, c]) => new Triangle(points[a], points[b], points[c])) };
  });
}

export interface DoorPrompt { id: string; label: string; open: boolean }
export function nearbyDoor(state: SimulationState, eye: Vector3, target: Vector3, visible: (id: string, handle: Vector3) => boolean): DoorPrompt | null {
  const direction = target.clone().sub(eye).normalize();
  const candidates = resolvedOpenings(state).flatMap(opening => {
    if (!['door', 'glazing'].includes(opening.kind)) return [];
    const context = openingContext(state, opening.id); if (!context) return [];
    const delta = context.handle.clone().sub(eye), distance = delta.length();
    if (distance > DOOR_REACH || direction.dot(delta.normalize()) < .12) return [];
    return [{ context, distance }];
  }).sort((a, b) => a.distance - b.distance);
  const next = candidates.find(({ context }) => visible(context.opening.id, context.handle));
  return next ? { id: next.context.opening.id, label: next.context.opening.label, open: next.context.opening.open && !next.context.opening.shutter } : null;
}
