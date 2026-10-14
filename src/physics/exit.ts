import { overlapCircleVsCircle } from './gold';
import { NINJA, NinjaState, type Ninja } from './ninja';

/**
 * The exit, as in N++ (nclone's EntityExit and EntityExitSwitch): touching the
 * switch (the key) opens the door, and touching the open door completes the
 * level.
 */
export const EXIT_DOOR_RADIUS = 12;
export const EXIT_KEY_RADIUS = 6;

export class ExitDoor {
  /** Opened by the key. N++ adds the door to its entity grid then, so it can be touched from the next frame. */
  open = false;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  /** Returns true if the ninja reached the door and won (not if a mine got it first this frame). */
  logicalCollision(ninja: Ninja): boolean {
    if (!overlapCircleVsCircle(this.x, this.y, EXIT_DOOR_RADIUS, ninja.xpos, ninja.ypos, NINJA.RADIUS)) return false;
    ninja.win();
    return ninja.state === NinjaState.Celebrating;
  }
}

export class ExitKey {
  /** False once collected. */
  active = true;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  /** Returns true if the ninja collected the key. (Like N++, this ignores the ninja's state.) */
  logicalCollision(ninja: Ninja): boolean {
    if (!overlapCircleVsCircle(this.x, this.y, EXIT_KEY_RADIUS, ninja.xpos, ninja.ypos, NINJA.RADIUS)) return false;
    this.active = false;
    return true;
  }
}
