import { NinjaState, type HorInput, type Ninja } from '../physics/ninja';

/**
 * A press on a wall held this many frames (0.13 s) is a hold, a full jump away
 * from the wall; released sooner, it's a tap, a short hop.
 */
export const WALL_TAP_FRAMES = 8;

/**
 * One-button control: the ninja always runs, and the player only jumps.
 *
 * The running direction is set by the last wall the ninja hit:
 *  - running into a wall on the ground turns it around;
 *  - in the air it keeps pushing into the wall it hit, so it clings and slides
 *    down; jumping off the wall sends it the other way.
 *
 * Jumping off a wall while sliding down it depends on how long the press is.
 * N gives two wall jumps: a short hop when pushing into the wall, and a full
 * jump when not. Which one has to be chosen on the frame of the jump, so the
 * press isn't passed on straight away: released within WALL_TAP_FRAMES it
 * becomes the short hop (on release), and held longer it becomes the full
 * jump (then, with the rest of the press as its hold).
 */
export class AutoRunner {
  dir: -1 | 1;
  /** Frames a press on a wall has been waiting to become a hop or a jump, or -1. */
  pending = -1;
  private wasHeld = false;
  private seenWallJumps: number;

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
    if (press && ninja.state === NinjaState.WallSliding) this.pending = 0;
    if (this.pending >= 0) {
      if (ninja.state === NinjaState.WallSliding) {
        // Released: the short hop, still pushing into the wall.
        if (!held) {
          this.pending = -1;
          return [this.dir, true];
        }
        // Still held: wait, or (held long enough) the full jump.
        if (++this.pending < WALL_TAP_FRAMES) return [this.dir, false];
      }
      // Held long enough, or no longer on the wall (slid off its end, landed): jump now.
      this.pending = -1;
      return [this.jumpDir(ninja), true];
    }
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
