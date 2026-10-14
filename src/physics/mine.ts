import { overlapCircleVsCircle } from './gold';
import { NINJA, NinjaState, type Ninja } from './ninja';

/**
 * Mines, as in N++ (nclone's EntityToggleMine). One class covers both kinds:
 *  - a regular mine starts Armed and kills the ninja on contact;
 *  - a toggle mine starts Safe. Touching it starts Arming it, and it becomes
 *    Armed once the ninja moves off it (or back to Safe if the ninja died).
 */
export const enum MineState {
  Armed = 0,
  Safe = 1,
  Arming = 2,
}

/** Collision radius per state. */
export const MINE_RADII: Record<MineState, number> = {
  [MineState.Armed]: 4,
  [MineState.Safe]: 3.5,
  [MineState.Arming]: 4.5,
};

export class Mine {
  state: MineState;

  constructor(
    readonly x: number,
    readonly y: number,
    /** True for a toggle mine (starts safe), false for a regular mine. */
    readonly toggle: boolean,
  ) {
    this.state = toggle ? MineState.Safe : MineState.Armed;
  }

  get radius(): number {
    return MINE_RADII[this.state];
  }

  /** Runs at the start of every frame, before the ninja moves. */
  think(ninja: Ninja): void {
    if (this.state === MineState.Armed) return;
    const touching = isValidTarget(ninja) && this.touches(ninja);
    if (this.state === MineState.Arming && !touching) {
      this.state = ninja.state === NinjaState.Dead || ninja.state === NinjaState.Disabled ? MineState.Safe : MineState.Armed;
    } else if (this.state === MineState.Safe && touching) {
      this.state = MineState.Arming;
    }
  }

  /** Runs during the ninja's post-collision step. Returns true if the mine killed the ninja. */
  logicalCollision(ninja: Ninja): boolean {
    if (this.state !== MineState.Armed || !isValidTarget(ninja) || !this.touches(ninja)) return false;
    this.state = MineState.Safe;
    // N++ records no position or speed for this death; ours are used only for the death animation.
    ninja.kill(ninja.xpos, ninja.ypos, ninja.xspeed * 0.5, ninja.yspeed * 0.5);
    return true;
  }

  private touches(ninja: Ninja): boolean {
    return overlapCircleVsCircle(this.x, this.y, this.radius, ninja.xpos, ninja.ypos, NINJA.RADIUS);
  }
}

/** Whether entities can interact with the ninja (not dead, celebrating or disabled). */
export function isValidTarget(ninja: Ninja): boolean {
  const s = ninja.state;
  return s !== NinjaState.Dead && s !== NinjaState.Celebrating && s !== NinjaState.Disabled;
}
