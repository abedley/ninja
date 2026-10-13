import type { HorInput, Ninja } from '../physics/ninja';

/**
 * One-button control: the ninja always runs, and the player only jumps.
 *
 * The running direction is set by the last wall the ninja hit:
 *  - running into a wall on the ground turns it around;
 *  - in the air it keeps pushing into the wall it hit, so it clings and slides
 *    down; jumping off the wall sends it the other way.
 */
export class AutoRunner {
  dir: -1 | 1;
  private seenWallJumps: number;

  constructor(ninja: Ninja, dir: -1 | 1 = 1) {
    this.dir = dir;
    this.seenWallJumps = ninja.wallJumps;
  }

  /** Horizontal input for the next tick. `newPress` is true on the tick a jump press starts. */
  input(ninja: Ninja, newPress: boolean): HorInput {
    // Turn away from a wall before jumping off it: N gives a much bigger wall
    // jump when you aren't pushing into the wall.
    if (newPress && ninja.airborn && ninja.walled) this.dir = away(ninja.wallNormal);
    return this.dir;
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
}

/** The direction pointing away from a wall with the given normal. */
function away(wallNormal: number): -1 | 1 {
  return wallNormal < 0 ? -1 : 1;
}
