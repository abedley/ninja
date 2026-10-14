import type { LevelDef } from '../level/level';
import { TICK_RATE } from '../physics/simulator';

/** Starting clock, in seconds, for a campaign whose first level doesn't set one. */
const DEFAULT_START_TIME = 90;

/**
 * One run through the campaign: the levels in order, on one clock. The clock
 * carries over, so each level starts with the time left at the end of the one
 * before. A death sends the ninja back to the start of the current level, with
 * the clock back where it was when the level began.
 *
 * Times are in frames (60 per second), as the simulator counts them.
 */
export class CampaignRun {
  /** Index of the level being played. */
  index = 0;
  /** The clock at the start of the current level, which a death goes back to. */
  clockAtStart: number;
  /** Frames taken to clear each level so far (the successful attempt only). */
  readonly levelFrames: number[] = [];
  /** Whether the last level has been cleared. */
  finished = false;

  constructor(readonly levels: readonly LevelDef[]) {
    if (!levels.length) throw new Error('The campaign has no levels');
    this.clockAtStart = (levels[0].time ?? DEFAULT_START_TIME) * TICK_RATE;
  }

  get level(): LevelDef {
    return this.levels[this.index];
  }

  get isLastLevel(): boolean {
    return this.index === this.levels.length - 1;
  }

  /** The time left at the end of the run (once finished). */
  get finalClock(): number {
    return this.clockAtStart;
  }

  /** Total frames taken over the levels cleared so far. */
  get totalFrames(): number {
    return this.levelFrames.reduce((a, b) => a + b, 0);
  }

  /**
   * The current level was cleared in `frames`, with `clockLeft` frames left on
   * the clock. Moves on to the next level, which starts with that time.
   */
  complete(frames: number, clockLeft: number): void {
    if (this.finished) return;
    this.levelFrames.push(frames);
    this.clockAtStart = clockLeft;
    if (this.isLastLevel) this.finished = true;
    else this.index++;
  }
}
