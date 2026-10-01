import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export const MIN_VIEW_DISTANCE = 2;
export const MAX_VIEW_DISTANCE = 120;
export const ZOOM_STEP = 5;
const DEFAULT_DISTANCE = Math.hypot(23, 22, 26);
const MIN_WALK_ZOOM = .5;
const MAX_WALK_ZOOM = 3;

export type ViewMode = 'orbit' | 'plan' | 'walk';

export function zoomKeyDirection(key: string, code = ''): -1 | 0 | 1 {
  if (key === '+' || key === '=' || code === 'NumpadAdd') return 1;
  if (key === '-' || code === 'NumpadSubtract') return -1;
  return 0;
}

export function panKeyDirection(key: string): { x: number; y: number } | null {
  switch (key) {
    case 'ArrowLeft': return { x: -1, y: 0 };
    case 'ArrowRight': return { x: 1, y: 0 };
    case 'ArrowUp': return { x: 0, y: 1 };
    case 'ArrowDown': return { x: 0, y: -1 };
    default: return null;
  }
}

export function restoredZoom(zoom: number | undefined): number {
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0
    ? MathUtils.clamp(zoom, MIN_WALK_ZOOM, MAX_WALK_ZOOM) : 1;
}

/** A logarithmic track gives useful precision both near the model and far away. */
export function readViewZoom(camera: PerspectiveCamera, target: Vector3, mode: ViewMode) {
  const ratio = mode === 'walk' ? restoredZoom(camera.zoom)
    : DEFAULT_DISTANCE / Math.max(MIN_VIEW_DISTANCE, camera.position.distanceTo(target));
  const min = mode === 'walk' ? MIN_WALK_ZOOM : DEFAULT_DISTANCE / MAX_VIEW_DISTANCE;
  const max = mode === 'walk' ? MAX_WALK_ZOOM : DEFAULT_DISTANCE / MIN_VIEW_DISTANCE;
  return {
    level: MathUtils.clamp(100 * Math.log(ratio / min) / Math.log(max / min), 0, 100),
    percent: Math.round(ratio * 100),
  };
}

export function applyViewZoom(camera: PerspectiveCamera, target: Vector3, mode: ViewMode, level: number): void {
  if (!Number.isFinite(level)) return;
  const fraction = MathUtils.clamp(level, 0, 100) / 100;
  if (mode === 'walk') {
    // Optical zoom never changes the walk position or bypasses collision checks.
    camera.zoom = MIN_WALK_ZOOM * (MAX_WALK_ZOOM / MIN_WALK_ZOOM) ** fraction;
    camera.updateProjectionMatrix();
    return;
  }
  const offset = camera.position.clone().sub(target);
  if (offset.lengthSq() < .000001) return;
  const distance = MAX_VIEW_DISTANCE * (MIN_VIEW_DISTANCE / MAX_VIEW_DISTANCE) ** fraction;
  camera.position.copy(target).add(offset.setLength(distance));
}

/** Translate camera and target together in screen space, including the top view. */
export function panView(camera: PerspectiveCamera, target: Vector3, x: number, y: number, viewportHeight: number): void {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return;
  camera.updateMatrixWorld();
  const step = 32 * 2 * camera.position.distanceTo(target)
    * Math.tan(MathUtils.degToRad(camera.fov / 2)) / camera.zoom / viewportHeight;
  const motion = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(x * step)
    .addScaledVector(new Vector3().setFromMatrixColumn(camera.matrixWorld, 1), y * step);
  camera.position.add(motion);
  target.add(motion);
}