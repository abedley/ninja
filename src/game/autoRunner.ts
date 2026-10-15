import type { HorInput, Ninja } from '../physics/ninja';

/**
 * On the ground, moving less than this (px per frame) in the running
 * direction for STUCK_FRAMES frames in a row means the ninja can't go any
 * further that way. (Setting off from standing still, it's past this from the
 * second frame.)
 */
const MIN_PROGRESS = 0.05;
const STUCK_FRAMES = 6;

/**
 * One-button control: the ninja always runs, and the player only jumps.
 *
 * The running direction is set by the last wall the ninja hit:
 *  - running into a wall on the ground turns it around, and so does anything
 *    else that stops it getting any further on the ground (being wedged under
 *    a sloping ceiling, or pushed back down a slope too steep to run up);
 *  - in the air it keeps pushing into the wall it hit, so it clings and slides
 *    down; jumping off the wall sends it the other way.
 */
export class AutoRunner {
  dir: -1 | 1;
  private wasHeld = false;
  private seenWallJumps: number;
  /** Frames in a row the ninja has been on the ground without getting anywhere. */
  private stuckFrames = 0;

  constructor(ninja: Ninja, dir: -1 | 1 = 1) {
    this.dir = dir;
    this.seenWallJumps = ninja.wallJumps;
  }

  /** A copy, for the solver to branch from. */
  clone(): AutoRunner {
    return Object.assign(Object.create(AutoRunner.prototype) as AutoRunner, this);
  }

  /**
   * The inputs for the next tick, horizontal and jump, from whether the jump
   * button is held. Call update() after the tick.
   */
  control(ninja: Ninja, held: boolean): [HorInput, boolean] {
    const press = held && !this.wasHeld;
    this.wasHeld = held;
    return [press ? this.jumpDir(ninja) : this.dir, held];
  }

  /** Update the direction from what happened during the tick. */
  update(ninja: Ninja): void {
    if (ninja.wallJumps !== this.seenWallJumps) {
      // A wall jump (possibly from a jump buffered just before touching the wall).
      this.seenWallJumps = ninja.wallJumps;
      this.dir = away(ninja.wallNormal);
    } else if (ninja.walled && !ninja.airborn) {
      this.dir = away(ninja.wallNormal);
    }
    const progress = (ninja.xpos - ninja.xposOld) * this.dir;
    this.stuckFrames = !ninja.airborn && progress < MIN_PROGRESS ? this.stuckFrames + 1 : 0;
    if (this.stuckFrames >= STUCK_FRAMES) {
      this.dir = this.dir === 1 ? -1 : 1;
      this.stuckFrames = 0;
    }
  }

  /** The direction to push on the frame a jump starts. */
  private jumpDir(ninja: Ninja): -1 | 1 {
    // Turn away from a wall before jumping off it: N gives the much bigger
    // wall jump when you aren't pushing into the wall.
    if (ninja.airborn && ninja.walled) this.dir = away(ninja.wallNormal);
    return this.dir;
  }
}

/** The direction pointing away from a wall with the given normal. */
function away(wallNormal: number): -1 | 1 {
  return wallNormal < 0 ? -1 : 1;
}
