export type WalkKey = 'w' | 'a' | 's' | 'd' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'PageUp' | 'PageDown';

export interface WalkInput {
  forward: number;
  strafe: number;
  vertical: number;
}

export interface WalkBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export const MOVEMENT_KEYS: ReadonlySet<string> = new Set([
  'w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown',
]);

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    || target.closest('[contenteditable="true"]') !== null;
}

export function keyToInput(key: string): WalkInput {
  switch (key) {
    case 'w': case 'ArrowUp': return { forward: 1, strafe: 0, vertical: 0 };
    case 's': case 'ArrowDown': return { forward: -1, strafe: 0, vertical: 0 };
    case 'a': case 'ArrowLeft': return { forward: 0, strafe: -1, vertical: 0 };
    case 'd': case 'ArrowRight': return { forward: 0, strafe: 1, vertical: 0 };
    case 'PageUp': return { forward: 0, strafe: 0, vertical: 1 };
    case 'PageDown': return { forward: 0, strafe: 0, vertical: -1 };
    default: return { forward: 0, strafe: 0, vertical: 0 };
  }
}

export function aggregateInput(keys: Iterable<string>, pointer: WalkInput = { forward: 0, strafe: 0, vertical: 0 }): WalkInput {
  const result = { ...pointer };
  for (const key of keys) {
    const input = keyToInput(key);
    result.forward += input.forward;
    result.strafe += input.strafe;
    result.vertical += input.vertical;
  }
  const length = Math.hypot(result.forward, result.strafe, result.vertical);
  return length > 1 ? {
    forward: result.forward / length,
    strafe: result.strafe / length,
    vertical: result.vertical / length,
  } : result;
}

export function clampToBounds(position: { x: number; y: number; z: number }, bounds: WalkBounds): { x: number; y: number; z: number } {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, position.y)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, position.z)),
  };
}

export function isWithinBounds(position: { x: number; y: number; z: number }, bounds: WalkBounds, radius = 0): boolean {
  // Camera matrix updates can put an eye at 1.6199999999999999 instead of 1.62.
  // This numerical tolerance must not turn a valid floor-level step into a no-op.
  const epsilon = 1e-6;
  return position.x >= bounds.minX + radius - epsilon && position.x <= bounds.maxX - radius + epsilon
    && position.z >= bounds.minZ + radius - epsilon && position.z <= bounds.maxZ - radius + epsilon
    && position.y >= bounds.minY - epsilon && position.y <= bounds.maxY + epsilon;
}

export function navigationKey(key: string, code = ''): string {
  // Physical WASD/QE keys also work when the active keyboard layout is Hebrew.
  if (/^Key[WASDQE]$/.test(code)) return code.slice(3).toLowerCase();
  return key.length === 1 ? key.toLowerCase() : key;
}
