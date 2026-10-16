import { NINJA, NinjaState, type Ninja } from './ninja';

/**
 * Gold, as in N++ (nclone's EntityGold): a static circle of radius 6 that is
 * collected when it overlaps the ninja. It has no effect on movement.
 *
 * N++ places entities on a 6 px grid (a quarter tile); positions here are in
 * world pixels.
 */
export const GOLD_RADIUS = 6;

/**
 * Toggle gold (not in N++) works like a toggle mine, but for good: it starts
 * Dormant, and can't be collected. Touching it starts Waking it, and it's
 * Ready once the ninja moves off it (or Dormant again if the ninja died), so
 * it's collected the next time the ninja passes through. Regular gold starts
 * Ready.
 */
export const enum GoldState {
  Ready = 0,
  Dormant = 1,
  Waking = 2,
}

export class Gold {
  /** False once collected. */
  active = true;
  state: GoldState;

  constructor(
    readonly x: number,
    readonly y: number,
    /** True for toggle gold. */
    readonly toggle = false,
  ) {
    this.state = toggle ? GoldState.Dormant : GoldState.Ready;
  }

  /** Runs at the start of every frame, before the ninja moves (as a toggle mine's does). */
  think(ninja: Ninja): void {
    if (this.state === GoldState.Ready || !this.active) return;
    const s = ninja.state;
    const valid = s !== NinjaState.Dead && s !== NinjaState.Celebrating && s !== NinjaState.Disabled;
    const touching = valid && this.touches(ninja);
    if (this.state === GoldState.Waking && !touching) this.state = s === NinjaState.Dead || s === NinjaState.Disabled ? GoldState.Dormant : GoldState.Ready;
    else if (this.state === GoldState.Dormant && touching) this.state = GoldState.Waking;
  }

  touches(ninja: Ninja): boolean {
    return overlapCircleVsCircle(this.x, this.y, GOLD_RADIUS, ninja.xpos, ninja.ypos, NINJA.RADIUS);
  }
}

/** True if two circles overlap (touching exactly does not count). */
export function overlapCircleVsCircle(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): boolean {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy) < r1 + r2;
}
