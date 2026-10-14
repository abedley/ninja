/**
 * Best times, kept in the browser's storage:
 *  - for each level, the fastest clear (frames from the first tap to the door);
 *  - for the campaign, the best runs, ranked by the time left on the clock at
 *    the end (the run's score: gold adds to it), with each run's total time.
 */

/** The part of the Storage API used here (so tests can pass a stand-in). */
export interface RecordStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RunRecord {
  /** Frames left on the clock at the end. */
  timeLeft: number;
  /** Frames taken over all five levels (successful attempts only). */
  totalFrames: number;
  /** When the run was finished (ms since the epoch). */
  date: number;
}

/** How many runs the campaign table keeps. */
export const RUNS_KEPT = 5;
const LEVEL_PREFIX = 'ninja.level-best.';
const RUNS_KEY = 'ninja.campaign-runs';

export class Records {
  constructor(private readonly store: RecordStore | null) {}

  /** The fastest clear of a level, in frames, if it has been cleared. */
  levelBest(name: string): number | null {
    const v = Number(this.read(LEVEL_PREFIX + name));
    return v > 0 ? v : null;
  }

  /** Record a clear of a level; returns the previous best (null if none). */
  submitLevel(name: string, frames: number): number | null {
    const best = this.levelBest(name);
    if (best === null || frames < best) this.write(LEVEL_PREFIX + name, String(frames));
    return best;
  }

  /** The best runs so far, best first. */
  runs(): RunRecord[] {
    try {
      const list = JSON.parse(this.read(RUNS_KEY) ?? '[]') as RunRecord[];
      return Array.isArray(list) ? list.filter((r) => r && r.timeLeft >= 0 && r.totalFrames > 0) : [];
    } catch {
      return [];
    }
  }

  /** Record a finished run; returns its place in the table (0 = best), or -1 if it didn't make it. */
  submitRun(run: RunRecord): number {
    const runs = [...this.runs(), run].sort((a, b) => b.timeLeft - a.timeLeft || a.totalFrames - b.totalFrames || a.date - b.date);
    const kept = runs.slice(0, RUNS_KEPT);
    this.write(RUNS_KEY, JSON.stringify(kept));
    return kept.indexOf(run);
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
