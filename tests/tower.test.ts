import { describe, expect, it } from 'vitest';
import { AutoRunner } from '../src/game/autoRunner';
import { parseLevel } from '../src/level/level';
import { TOWER } from '../src/level/levels';
import { NinjaState } from '../src/physics/ninja';
import { Simulator } from '../src/physics/simulator';
import { TILE_SIZE } from '../src/physics/tileDefs';
import { replay, type Plan } from '../tools/solver/solver';

/**
 * A route up the Tower found by tools/solver (one-button presses: [frames
 * released, frames held]). If you change the level, re-run
 *   npx vite-node tools/solver/solve.ts Tower
 * and paste the new plan here.
 */
const TOWER_ROUTE: Plan = [[80,35],[4,46],[1,25],[8,46],[13,46],[1,35],[4,46],[35,46],[80,46],[80,46],[80,35],[13,46],[1,46],[35,9]];

describe('Tower', () => {
  it('can be climbed with one button', () => {
    const level = parseLevel(TOWER);
    let highest = Infinity;
    const sim = replay(level, TOWER_ROUTE, (s) => (highest = Math.min(highest, s.ninja.ypos)));
    // Reached the finish room (the top three rows) and survived.
    expect(highest).toBeLessThan(4 * TILE_SIZE);
    expect(sim.ninja.state).toBeLessThan(NinjaState.Dead);
  });
});

/** Run with the auto-runner, pressing jump on the given frames (held for `hold` frames). */
function run(rows: string[], frames: number, presses: number[] = [], hold = 20) {
  const level = parseLevel({ name: 'test', rows });
  const sim = new Simulator(level.map, level.spawnX, level.spawnY);
  for (let i = 0; i < 20; i++) sim.tick(0, false);
  const runner = new AutoRunner(sim.ninja);
  const log: { dir: number; state: NinjaState; x: number }[] = [];
  for (let f = 0; f < frames; f++) {
    const held = presses.some((p) => f >= p && f < p + hold);
    const n = sim.ninja;
    sim.tick(runner.input(n, held && !n.jumpInputOld), held);
    runner.update(n);
    log.push({ dir: runner.dir, state: n.state, x: n.xpos });
  }
  return { sim, runner, log };
}

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
});
