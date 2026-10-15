import { DEFAULT_LEVEL_TIME } from '../level/level';
import { GOLD_TIME_BONUS, TICK_RATE } from '../physics/simulator';

/**
 * High scores, kept in the browser's storage:
 *  - for each level, the best clear, scored by 30 s less the time taken
 *    (frames from the first tap to the door) plus two seconds for each piece
 *    of gold;
 *  - for each campaign, the best runs, ranked by the time left on the clock
 *    at the end (the run's score: gold adds to it), with each run's total time.
 */

/** The part of the Storage API used here (so tests can pass a stand-in). */
export interface RecordStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RunRecord {
  /** Frames left on the clock at the end. */
  timeLeft: number;
  /** Frames taken over all the campaign's levels (successful attempts only). */
  totalFrames: number;
  /** When the run was finished (ms since the epoch). */
  date: number;
}

/** A clear of a level. */
export interface LevelRecord {
  /** Frames from the first tap to the door. */
  frames: number;
  /** Gold collected. */
  gold: number;
}

/**
 * A clear's score, in frames: DEFAULT_LEVEL_TIME less the time taken, plus
 * GOLD_TIME_BONUS per gold (higher is better; it can be negative). It's the
 * time that would be left on a 30 s clock, whatever the level's own clock.
 */
export const levelScore = (r: LevelRecord): number => DEFAULT_LEVEL_TIME * TICK_RATE - r.frames + r.gold * GOLD_TIME_BONUS;

/** How many runs the campaign table keeps. */
export const RUNS_KEPT = 5;
const LEVEL_PREFIX = 'ninja.level-best.';
const RUNS_PREFIX = 'ninja.campaign-runs.';

export class Records {
  constructor(private readonly store: RecordStore | null) {}

  /** The best-scoring clear of a level, if it has been cleared. */
  levelBest(name: string): LevelRecord | null {
    const text = this.read(LEVEL_PREFIX + name);
    if (text === null) return null;
    try {
      const v = JSON.parse(text) as unknown;
      // Before gold counted, only the time was kept: count it as a clear with no gold.
      const r = typeof v === 'number' ? { frames: v, gold: 0 } : (v as LevelRecord);
      return r && r.frames > 0 && r.gold >= 0 ? { frames: r.frames, gold: r.gold } : null;
    } catch {
      return null;
    }
  }

  /** Record a clear of a level; returns the previous best (null if none). */
  submitLevel(name: string, clear: LevelRecord): LevelRecord | null {
    const best = this.levelBest(name);
    if (best === null || levelScore(clear) > levelScore(best)) this.write(LEVEL_PREFIX + name, JSON.stringify(clear));
    return best;
  }

  /** A campaign's best runs so far, best first. */
  runs(campaign: string): RunRecord[] {
    try {
      const list = JSON.parse(this.read(RUNS_PREFIX + campaign) ?? '[]') as RunRecord[];
      return Array.isArray(list) ? list.filter((r) => r && r.timeLeft >= 0 && r.totalFrames > 0) : [];
    } catch {
      return [];
    }
  }

  /** Record a finished run; returns its place in the table (0 = best), or -1 if it didn't make it. */
  submitRun(campaign: string, run: RunRecord): number {
    const runs = [...this.runs(campaign), run].sort((a, b) => b.timeLeft - a.timeLeft || a.totalFrames - b.totalFrames || a.date - b.date);
    const kept = runs.slice(0, RUNS_KEPT);
    this.write(RUNS_PREFIX + campaign, JSON.stringify(kept));
    return kept.indexOf(run);
  }

  /** Runs recorded before there was more than one campaign become this campaign's. */
  adoptOldRuns(campaign: string): void {
    const old = this.read('ninja.campaign-runs');
    if (old !== null && this.read(RUNS_PREFIX + campaign) === null) this.write(RUNS_PREFIX + campaign, old);
  }

  private read(key: string): string | null {
    try {
      return this.store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.store?.setItem(key, value);
    } catch {
      /* storage unavailable or full: the record just isn't kept */
    }
  }
}

/** The browser's storage, if it can be used. */
export function browserStore(): RecordStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
