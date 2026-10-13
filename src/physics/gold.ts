/**
 * Gold, as in N++ (nclone's EntityGold): a static circle of radius 6 that is
 * collected when it overlaps the ninja. It has no effect on movement.
 *
 * N++ places entities on a 6 px grid (a quarter tile); positions here are in
 * world pixels.
 */
export const GOLD_RADIUS = 6;

export class Gold {
  active = true;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

/** True if two circles overlap (touching exactly does not count). */
export function overlapCircleVsCircle(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): boolean {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy) < r1 + r2;
}
