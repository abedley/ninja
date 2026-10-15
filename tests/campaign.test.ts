import { describe, expect, it } from 'vitest';
import { CampaignRun } from '../src/game/campaign';
import { Records, RUNS_KEPT, type RecordStore } from '../src/game/records';
import { CAMPAIGNS, resolveCampaign, type Campaign } from '../src/level/campaigns';
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
  'First Steps': [[80,46],[19,46],[8,35],[26,46],[80,46],[80,46],[80,46],[1,35],[1,46],[4,46]],
  Backtrack: [[80,3],[80,16],[35,46],[80,16],[80,3],[8,25],[1,46],[1,46],[1,46],[1,46],[1,46],[1,46],[1,9]],
  Minefield: [[35,35],[4,35],[35,46],[13,3],[80,35],[8,16],[60,46],[1,16],[80,46],[26,3],[19,46],[80,46],[80,46],[80,35],[4,25],[4,25],[19,46],[1,25]],
  Chimneys: [[8,46],[80,46],[8,46],[4,46],[1,35],[4,46],[80,46],[4,46],[19,46],[19,16],[46,46],[19,35],[26,46],[13,46],[4,46],[80,35],[13,46],[8,46],[8,46],[4,46],[8,9],[46,46],[1,46]],
  Summit: [[60,46],[1,35],[1,46],[4,35],[1,35],[1,46],[1,35],[8,46],[8,46],[4,35],[1,35],[26,3],[46,46],[35,9],[80,25],[1,35],[4,9],[46,46],[46,3],[46,3],[80,46],[80,9],[8,3],[4,9],[26,3],[60,46],[13,25],[80,46],[60,9],[19,3],[46,46]],
};

describe('campaign levels', () => {
  it('are every level, each with a route here', () => {
    expect(CAMPAIGNS.flatMap((c) => c.levels.map((l) => l.name))).toEqual(Object.keys(ROUTES));
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
    const run = new CampaignRun(CAMPAIGNS[0]);
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
const campaign = (time: number, ...levels: LevelDef[]): Campaign => ({ name: 'c', time, levels });

describe('a campaign run', () => {
  it("starts on the first level with the campaign's time, and carries the clock over", () => {
    const run = new CampaignRun(campaign(50, tiny('a', 20), tiny('b', 10), tiny('c')));
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

});

describe('campaigns.json', () => {
  it('names levels from levels.json', () => {
    const levels = [tiny('a'), tiny('b')];
    expect(resolveCampaign({ name: 'c', time: 9, levels: ['b', 'a'] }, levels).levels).toEqual([levels[1], levels[0]]);
    expect(() => resolveCampaign({ name: 'c', time: 9, levels: ['a', 'x'] }, levels)).toThrow(/"x"/);
    expect(() => resolveCampaign({ name: 'c', time: 9, levels: [] }, levels)).toThrow(/no levels/);
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
    expect(records.submitRun('c', run(1000))).toBe(0);
    expect(records.submitRun('c', run(3000))).toBe(0);
    expect(records.submitRun('c', run(2000))).toBe(1);
    // Ties go to the faster run.
    expect(records.submitRun('c', run(2000, 5000))).toBe(1);
    for (const t of [500, 400]) records.submitRun('c', run(t));
    expect(records.runs('c').map((r) => r.timeLeft)).toEqual([3000, 2000, 2000, 1000, 500]);
    expect(records.submitRun('c', run(100))).toBe(-1);
    expect(records.runs('c')).toHaveLength(RUNS_KEPT);
    // Each campaign has its own table.
    expect(records.runs('d')).toEqual([]);
  });

  it('give runs from before campaigns had names to the first campaign', () => {
    const store = memoryStore();
    const old = JSON.stringify([{ timeLeft: 900, totalFrames: 6000, date: 1 }]);
    store.data.set('ninja.campaign-runs', old);
    const records = new Records(store);
    records.adoptOldRuns('c');
    expect(records.runs('c').map((r) => r.timeLeft)).toEqual([900]);
    // Only once: later runs aren't overwritten.
    records.submitRun('c', { timeLeft: 1000, totalFrames: 6000, date: 2 });
    records.adoptOldRuns('c');
    expect(records.runs('c')).toHaveLength(2);
  });

  it('work without storage, and survive broken data', () => {
    const none = new Records(null);
    expect(none.submitLevel('a', 5)).toBeNull();
    expect(none.levelBest('a')).toBeNull();
    expect(none.submitRun('c', { timeLeft: 1, totalFrames: 1, date: 0 })).toBe(0);
    const store = memoryStore();
    store.data.set('ninja.campaign-runs.c', '{not json');
    store.data.set('ninja.level-best.a', 'nope');
    const records = new Records(store);
    expect(records.runs('c')).toEqual([]);
    expect(records.levelBest('a')).toBeNull();
  });
});
