import { describe, expect, it } from 'vitest';
import { AutoRunner } from '../src/game/autoRunner';
import { parseLevel } from '../src/level/level';
import { MineState } from '../src/physics/mine';
import { NinjaState } from '../src/physics/ninja';
import { Simulator } from '../src/physics/simulator';

/** Run with the auto-runner, pressing jump on the given frames (held for `hold` frames). */
function run(rows: string[], frames: number, presses: number[] = [], hold = 20) {
  const level = parseLevel({ name: 'test', rows });
  const sim = new Simulator(level.map, level.spawnX, level.spawnY);
  for (let i = 0; i < 20; i++) sim.tick(0, false);
  const runner = new AutoRunner(sim.ninja, level.facing);
  const log: { dir: number; state: NinjaState; x: number }[] = [];
  for (let f = 0; f < frames; f++) {
    const held = presses.some((p) => f >= p && f < p + hold);
    const n = sim.ninja;
    sim.tick(...runner.control(n, held));
    runner.update(n);
    log.push({ dir: runner.dir, state: n.state, x: n.xpos });
  }
  return { sim, runner, log };
}

describe('mines in levels', () => {
  it('a mine kills the ninja running into it', () => {
    const level = parseLevel({ name: 'x', rows: ['N....*...', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    for (let i = 0; i < 120 && sim.ninja.state < NinjaState.Dead; i++) sim.tick(1, false);
    expect(sim.ninja.state).toBe(NinjaState.Dead);
    expect(sim.killedBy).toBe(sim.mines[0]);
  });

  it('a toggle mine is safe the first time, and armed once the ninja has passed it', () => {
    const level = parseLevel({ name: 'x', rows: ['N...%....', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    // Run right over it (it starts arming, then arms), then back left into it.
    for (let i = 0; i < 70; i++) sim.tick(1, false);
    expect(sim.ninja.state).toBeLessThan(NinjaState.Dead);
    expect(sim.mines[0].state).toBe(MineState.Armed);
    for (let i = 0; i < 200 && sim.ninja.state < NinjaState.Dead; i++) sim.tick(-1, false);
    expect(sim.ninja.state).toBe(NinjaState.Dead);
  });
});

describe('auto-runner', () => {
  const room = ['........', '........', '........', 'N.......'];

  it('runs right from the start, and turns around at walls on the ground', () => {
    const { log } = run(room, 400);
    expect(log[0].dir).toBe(1);
    const turns = log.filter((e, i) => i > 0 && e.dir !== log[i - 1].dir).length;
    expect(turns).toBeGreaterThanOrEqual(2);
    expect(log.every((e) => e.state !== NinjaState.WallSliding)).toBe(true);
  });

  it('clings to a wall it jumps into, then kicks off it the other way', () => {
    const shaft = ['#....#', '#....#', '#....#', '#....#', '#....#', '#....#', '#N...#'];
    // Jump from the floor into the right wall, and wait.
    const clinging = run(shaft, 90, [10], 45);
    expect(clinging.log.some((e) => e.state === NinjaState.WallSliding)).toBe(true);
    expect(clinging.runner.dir).toBe(1);
    expect(clinging.sim.ninja.wallJumps).toBe(0);

    // Tap while clinging: a wall jump, after which the ninja heads left.
    const slideFrame = clinging.log.findIndex((e) => e.state === NinjaState.WallSliding);
    const kicked = run(shaft, slideFrame + 15, [10, slideFrame + 2], 12);
    expect(kicked.sim.ninja.wallJumps).toBe(1);
    expect(kicked.runner.dir).toBe(-1);
    expect(kicked.sim.ninja.xspeed).toBeLessThan(0);
  });

  it('turns around when wedged under a sloping ceiling, where there is no wall to hit', () => {
    // z: a 45° ceiling coming down to the floor; j and f/b: steep and mild ones; y: running left.
    for (const rows of [['........', 'N......z'], ['........', 'N......j'], ['........', 'N.....fb'], ['........', 'y......<']]) {
      const { log } = run(rows, 300);
      const start = log[0].dir;
      const turn = log.findIndex((e) => e.dir !== start);
      expect(turn, rows.join('/')).toBeGreaterThan(0);
      // It was stuck, not still moving, when it turned, and it then runs back the other way.
      expect(Math.abs(log[turn].x - log[turn - 6].x), rows.join('/')).toBeLessThan(1);
      expect((log[turn + 40].x - log[turn].x) * start, rows.join('/')).toBeLessThan(-20);
    }
  });

  it("doesn't turn while setting off, or running up a slope it can climb", () => {
    // Up to the top of the ramp (where it's launched up the wall).
    const { log } = run(['......#', '.....##', 'N.../##'], 66);
    expect(Math.max(...log.map((e) => e.x))).toBeGreaterThan(130);
    expect(log.every((e) => e.dir === 1)).toBe(true);
  });

  it('starts running left from a spawn facing left (<)', () => {
    const { log } = run(['.......<'], 30);
    expect(log[0].dir).toBe(-1);
    expect(log[29].x).toBeLessThan(log[0].x);
  });
});
