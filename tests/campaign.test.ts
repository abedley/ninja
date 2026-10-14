import { describe, expect, it } from 'vitest';
import { CampaignRun } from '../src/game/campaign';
import { Records, RUNS_KEPT, type RecordStore } from '../src/game/records';
import { parseLevel, type LevelDef } from '../src/level/level';
import { LEVELS } from '../src/level/levels';
import { NinjaState } from '../src/physics/ninja';
import { TICK_RATE } from '../src/physics/simulator';
import { replay, type Plan } from '../tools/solver/solver';

/**
 * Routes through each level found by tools/solver (one-button presses:
 * [frames released, frames held]): each picks up the key and reaches the exit.
 * If you change a level, re-run
 *   npx vite-node tools/solver/solve.ts "<level name>"
 * and paste the new plan here.
 */
const ROUTES: Record<string, Plan> = {
  'First Steps': [[80,46],[26,46],[1,46],[13,46],[80,46],[80,46],[80,46],[1,35],[4,46],[80,9]],
  Backtrack: [[80,3],[80,46],[13,3],[35,46],[19,46],[80,46],[1,25],[1,46],[1,46],[1,46],[1,46],[1,46],[1,46],[1,9]],
  Minefield: [[35,35],[4,35],[35,46],[13,3],[80,35],[8,9],[60,46],[1,9],[80,46],[26,3],[19,46],[80,46],[80,46],[80,35],[4,25],[4,25],[19,46],[1,25]],
  Chimneys: [[8,46],[80,46],[8,46],[4,46],[1,35],[4,46],[80,46],[4,46],[13,46],[26,46],[13,46],[19,9],[60,46],[13,46],[1,35],[8,35],[1,35],[19,35],[19,46],[1,35]],
  Summit: [[60,46],[1,35],[1,46],[4,35],[1,35],[1,46],[1,35],[8,46],[8,46],[4,35],[1,35],[26,3],[46,46],[35,9],[80,25],[19,16],[1,9],[1,3],[1,3],[4,3],[35,46],[19,16],[19,3],[80,3],[60,35],[8,16],[60,25],[4,3],[46,46],[19,9],[46,46],[80,3]],
};

describe('campaign levels', () => {
  it('are the five levels with routes here', () => {
    expect(LEVELS.map((l) => l.name)).toEqual(Object.keys(ROUTES));
  });

  for (const def of LEVELS) {
    it(`${def.name} has a key, a door and a clock, and can be finished with one button`, () => {
      const level = parseLevel(def);
      expect(level.exit).toBeDefined();
      expect(level.time).toBeGreaterThan(0);
      let keyFrame = 0;
      const sim = replay(level, ROUTES[def.name], (s) => {
        if (!keyFrame && !s.key!.active) keyFrame = s.frame;
      });
      expect(keyFrame).toBeGreaterThan(0);
      expect(sim.won).toBe(true);
      expect(sim.ninja.state).toBe(NinjaState.Celebrating);
      expect(sim.timedOut).toBe(false);
    });
  }

  it('can all be finished on one clock, carried over from level to level', () => {
    const run = new CampaignRun(LEVELS);
    while (!run.finished) {
      const level = parseLevel(run.level);
      let start = 0;
      let end = 0;
      const sim = replay(
        level,
        ROUTES[run.level.name],
        (s) => {
          if (!start && s.timeLeft < run.clockAtStart) start = s.frame;
          if (!end && s.won) end = s.frame;
        },
        run.clockAtStart,
      );
      expect(sim.won, run.level.name).toBe(true);
      run.complete(end - start + 1, sim.timeLeft);
    }
    // The routes leave time to spare (they're quick; people will be slower).
    expect(run.finalClock / TICK_RATE).toBeGreaterThan(20);
  });
});

const tiny = (name: string, time?: number): LevelDef => ({ name, time, rows: ['N.KD'] });

describe('a campaign run', () => {
  it('starts on the first level with its time, and carries the clock over', () => {
    const run = new CampaignRun([tiny('a', 50), tiny('b', 10), tiny('c')]);
    expect(run.level.name).toBe('a');
    expect(run.clockAtStart).toBe(50 * TICK_RATE);
    run.complete(600, 2400);
    expect(run.level.name).toBe('b');
    // The second level's own time is only for playing it on its own.
    expect(run.clockAtStart).toBe(2400);
    run.complete(300, 2100);
    expect(run.isLastLevel).toBe(true);
    expect(run.finished).toBe(false);
    run.complete(900, 1500);
    expect(run.finished).toBe(true);
    expect(run.finalClock).toBe(1500);
    expect(run.levelFrames).toEqual([600, 300, 900]);
    expect(run.totalFrames).toBe(1800);
    // Nothing changes once it's over.
    run.complete(1, 1);
    expect(run.levelFrames).toHaveLength(3);
  });

  it('has a default clock if the first level has none', () => {
    expect(new CampaignRun([tiny('a')]).clockAtStart).toBe(90 * TICK_RATE);
  });
});

function memoryStore(): RecordStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('records', () => {
  it('keep the fastest time for each level', () => {
    const records = new Records(memoryStore());
    expect(records.levelBest('a')).toBeNull();
    expect(records.submitLevel('a', 900)).toBeNull();
    expect(records.submitLevel('a', 1000)).toBe(900);
    expect(records.levelBest('a')).toBe(900);
    expect(records.submitLevel('a', 800)).toBe(900);
    expect(records.levelBest('a')).toBe(800);
    expect(records.levelBest('b')).toBeNull();
  });

  it(`rank runs by time left, keeping the best ${RUNS_KEPT}`, () => {
    const records = new Records(memoryStore());
    const run = (timeLeft: number, totalFrames = 6000) => ({ timeLeft, totalFrames, date: timeLeft });
    expect(records.submitRun(run(1000))).toBe(0);
    expect(records.submitRun(run(3000))).toBe(0);
    expect(records.submitRun(run(2000))).toBe(1);
    // Ties go to the faster run.
    expect(records.submitRun(run(2000, 5000))).toBe(1);
    for (const t of [500, 400]) records.submitRun(run(t));
    expect(records.runs().map((r) => r.timeLeft)).toEqual([3000, 2000, 2000, 1000, 500]);
    expect(records.submitRun(run(100))).toBe(-1);
    expect(records.runs()).toHaveLength(RUNS_KEPT);
  });

  it('work without storage, and survive broken data', () => {
    const none = new Records(null);
    expect(none.submitLevel('a', 5)).toBeNull();
    expect(none.levelBest('a')).toBeNull();
    expect(none.submitRun({ timeLeft: 1, totalFrames: 1, date: 0 })).toBe(0);
    const store = memoryStore();
    store.data.set('ninja.campaign-runs', '{not json');
    store.data.set('ninja.level-best.a', 'nope');
    const records = new Records(store);
    expect(records.runs()).toEqual([]);
    expect(records.levelBest('a')).toBeNull();
  });
});
