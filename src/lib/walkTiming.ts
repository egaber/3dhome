export const WALK_SPEED = 2.3;
export const WALK_TAP_DISTANCE = .08;

export function tapCoveredUntil(now: number): number {
  return now + WALK_TAP_DISTANCE / WALK_SPEED * 1000;
}

/** A tap already pays for its first 8 cm; a frame cannot bill the same time again. */
export function heldWalkSeconds(frameSeconds: number, now: number, coveredUntil: number): number {
  return Math.max(0, Math.min(frameSeconds, (now - coveredUntil) / 1000));
}
