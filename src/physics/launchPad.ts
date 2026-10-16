import { overlapCircleVsCircle } from './gold';
import { isValidTarget } from './mine';
import { NINJA, type Ninja } from './ninja';

/**
 * A launch pad, as in N++ (nclone's EntityLaunchPad): touching it throws the
 * ninja the way it faces. It can face any of the 8 directions N++ allows.
 *
 * In N++ a pad is always fixed to a wall, floor or ceiling, so it can only be
 * reached from its face. It doesn't need one, though: it fires whenever the
 * ninja overlaps it, unless the ninja is more than 10.1 px out in front of it
 * (so a pad on a floor fires as the ninja lands on it, not just before). Here
 * a pad can float in mid-air, so it works from behind and from the sides too.
 */
export const LAUNCH_PAD_RADIUS = 6;
const BOOST = 36 / 7;
const DIAG = Math.sqrt(2) / 2;

/** Unit vectors for N++'s orientations 0-7: right, then clockwise (y points down). */
export const LAUNCH_PAD_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [DIAG, DIAG],
  [0, 1],
  [-DIAG, DIAG],
  [-1, 0],
  [-DIAG, -DIAG],
  [0, -1],
  [DIAG, -DIAG],
];

export class LaunchPad {
  readonly normalX: number;
  readonly normalY: number;
  readonly active = true;

  constructor(
    readonly x: number,
    readonly y: number,
    /** N++ orientation, 0-7 (see LAUNCH_PAD_DIRECTIONS). */
    readonly orientation: number,
  ) {
    [this.normalX, this.normalY] = LAUNCH_PAD_DIRECTIONS[orientation];
  }

  /** Throws the ninja if it's touching; returns whether it did. */
  logicalCollision(ninja: Ninja): boolean {
    if (!isValidTarget(ninja)) return false;
    if (!overlapCircleVsCircle(this.x, this.y, LAUNCH_PAD_RADIUS, ninja.xpos, ninja.ypos, NINJA.RADIUS)) return false;
    // Not if the back of the ninja is still more than 0.1 px out in front of the pad.
    const nx = this.normalX;
    const ny = this.normalY;
    if ((this.x - (ninja.xpos - NINJA.RADIUS * nx)) * nx + (this.y - (ninja.ypos - NINJA.RADIUS * ny)) * ny < -0.1) return false;
    // Pads facing upward throw harder, to make up for gravity.
    const yboostScale = ny < 0 ? 1 - ny : 1;
    ninja.launch(nx * BOOST, ny * BOOST * yboostScale);
    return true;
  }
}
