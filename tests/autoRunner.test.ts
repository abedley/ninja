import { describe, expect, it } from 'vitest';
import { AutoRunner, WALL_TAP_FRAMES } from '../src/game/autoRunner';
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

  it('starts running left from a spawn facing left (<)', () => {
    const { log } = run(['.......<'], 30);
    expect(log[0].dir).toBe(-1);
    expect(log[29].x).toBeLessThan(log[0].x);
  });

  describe('on a wall', () => {
    const shaft = ['#.....', '#.....', '#.....', '#.....', '#.....', '#.....', '#.....', '#.....', '#.....', '#.....', '#....N'];
    /** Drop the ninja onto the right wall, high up, and let it slide; pressing on the given frames. */
    function slide(presses: [frame: number, hold: number][], frames: number) {
      const level = parseLevel({ name: 'test', rows: shaft });
      const sim = new Simulator(level.map, level.spawnX, level.spawnY - 8 * 24);
      const runner = new AutoRunner(sim.ninja);
      const log: { jump: boolean; state: NinjaState; y: number }[] = [];
      for (let f = 0; f < frames; f++) {
        const held = presses.some(([p, h]) => f >= p && f < p + h);
        const [hor, jump] = runner.control(sim.ninja, held);
        sim.tick(hor, jump);
        runner.update(sim.ninja);
        log.push({ jump, state: sim.ninja.state, y: sim.ninja.ypos });
      }
      return { sim, runner, log };
    }
    const PRESS = 40;
    const rise = (log: { y: number }[]) => log[PRESS].y - Math.min(...log.slice(PRESS).map((e) => e.y));

    it('a tap is a short hop, on release', () => {
      const { sim, runner, log } = slide([[PRESS, 4]], PRESS + 30);
      expect(log[PRESS - 1].state).toBe(NinjaState.WallSliding);
      // The press waits while held, and the hop comes when it's let go.
      expect(log.slice(PRESS, PRESS + 4).every((e) => !e.jump && e.state === NinjaState.WallSliding)).toBe(true);
      expect(log[PRESS + 4].jump).toBe(true);
      expect(log[PRESS + 5].jump).toBe(false);
      expect(sim.ninja.wallJumps).toBe(1);
      expect(runner.dir).toBe(-1);
      expect(rise(log)).toBeLessThan(8);
    });

    it(`a press held for ${WALL_TAP_FRAMES} frames is a full jump, held for the rest of the press`, () => {
      const short = slide([[PRESS, WALL_TAP_FRAMES + 1]], PRESS + 60);
      expect(short.log.findIndex((e) => e.jump)).toBe(PRESS + WALL_TAP_FRAMES - 1);
      expect(short.log.filter((e) => e.jump)).toHaveLength(2);
      expect(rise(short.log)).toBeGreaterThan(8);
      const long = slide([[PRESS, 50]], PRESS + 90);
      expect(rise(long.log)).toBeGreaterThan(rise(short.log) + 20);
      expect(long.runner.dir).toBe(-1);
      expect(long.sim.ninja.wallJumps).toBe(1);
    });

    it('jumps straight away if the ninja reaches the floor while the press waits', () => {
      const landed = slide([], 400).log.findIndex((e) => e.state < NinjaState.Jumping);
      expect(landed).toBeGreaterThan(PRESS);
      const { log } = slide([[landed - 3, 30]], landed + 10);
      expect(log.findIndex((e) => e.jump)).toBe(landed + 1);
      expect(log[landed + 1].state).toBe(NinjaState.Jumping);
    });
  });
});
