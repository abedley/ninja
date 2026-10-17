import { LAUNCH_PAD_DIRECTIONS } from './launchPad';
import { NINJA, type Ninja } from './ninja';

/**
 * A one-way platform, as in N++ (nclone's EntityOneWayPlatform): a solid
 * surface 24 px across, centred on its position, that only stops the ninja
 * coming from the side it faces. From behind (or along it) the ninja passes
 * straight through. Facing up, it's a ledge to jump up through and land on.
 *
 * It faces one of N++'s directions: 0 right, 2 down, 4 left, 6 up (the same
 * numbering as launch pads; N++ has no diagonal one-ways).
 */
export const ONE_WAY_SEMI_SIDE = 12;
export const ONE_WAY_DIRECTIONS = [0, 2, 4, 6] as const;

export interface Depenetration {
  /** The push's direction (the platform's normal) and length. */
  nx: number;
  ny: number;
  len: number;
}

export class OneWayPlatform {
  readonly normalX: number;
  readonly normalY: number;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly orientation: number,
  ) {
    // (Integers, as nclone has them, so zeros keep their sign in the arithmetic below.)
    [this.normalX, this.normalY] = LAUNCH_PAD_DIRECTIONS[orientation].map((v) => Math.round(v)) as [number, number];
  }

  /** How far to push the ninja out of the platform, or null if it isn't in it (or is coming from behind). */
  depenetration(ninja: Ninja): Depenetration | null {
    const nx = this.normalX;
    const ny = this.normalY;
    const dx = ninja.xpos - this.x;
    const dy = ninja.ypos - this.y;
    const lateralDist = dy * nx - dx * ny;
    const direction = (ninja.yspeed * nx - ninja.xspeed * ny) * lateralDist;
    // The platform is wider for a ninja moving towards its middle.
    const radiusScalar = direction < 0 ? 0.9 : 0.51;
    if (Math.abs(lateralDist) >= radiusScalar * NINJA.RADIUS + ONE_WAY_SEMI_SIDE) return null;
    const normalDist = dx * nx + dy * ny;
    if (!(normalDist > 0 && normalDist <= NINJA.RADIUS)) return null;
    // Only when moving into it, and only if the ninja was (almost) outside it last frame.
    if (ninja.xspeed * nx + ninja.yspeed * ny > 0) return null;
    const normalDistOld = (ninja.xposOld - this.x) * nx + (ninja.yposOld - this.y) * ny;
    if (NINJA.RADIUS - normalDistOld > 1.1) return null;
    return { nx, ny, len: NINJA.RADIUS - normalDist };
  }

  /** In the logical step: the wall normal, if the ninja is against the platform's face and it's a wall (facing sideways). */
  wallNormal(ninja: Ninja): number {
    return this.depenetration(ninja) && Math.abs(this.normalX) === 1 ? this.normalX : 0;
  }
}
