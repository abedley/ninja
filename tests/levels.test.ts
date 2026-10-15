import { describe, expect, it } from 'vitest';
import { AutoRunner } from '../src/game/autoRunner';
import { parseLevel } from '../src/level/level';
import { LEVELS } from '../src/level/levels';
import { Simulator } from '../src/physics/simulator';
import { NinjaState } from '../src/physics/ninja';
import { GREASED_TILE } from '../src/physics/tileDefs';

describe('shipped levels', () => {
  for (const def of LEVELS) {
    it(`${def.name} parses and the ninja settles safely at spawn`, () => {
      const level = parseLevel(def);
      const sim = new Simulator(level.map, level.spawnX, level.spawnY);
      for (let i = 0; i < 60; i++) sim.tick(0, false);
      expect(sim.ninja.airborn).toBe(false);
      expect(sim.ninja.state).toBe(NinjaState.Immobile);
    });
  }
});

describe('level parser', () => {
  it('rejects ragged rows, unknown tiles and missing spawns', () => {
    expect(() => parseLevel({ name: 'x', rows: ['N..', '##'] })).toThrow(/expected 3/);
    expect(() => parseLevel({ name: 'x', rows: ['N.?'] })).toThrow(/unknown tile/);
    expect(() => parseLevel({ name: 'x', rows: ['...'] })).toThrow(/no spawn/);
    expect(() => parseLevel({ name: 'x', rows: ['N.<'] })).toThrow(/more than one spawn/);
  });

  it('places gold from $ tiles and from N++ entity coordinates', () => {
    const level = parseLevel({ name: 'x', rows: ['N.$', '###'], gold: [[9, 7]] });
    expect(level.map.tileAt(3, 1)).toBe(0);
    expect(level.gold).toEqual([
      { x: 3 * 24 + 12, y: 24 + 12 },
      { x: 54, y: 42 },
    ]);
  });
});

describe('gold', () => {
  it('is collected once, by running into it', () => {
    const level = parseLevel({ name: 'x', rows: ['N.....$..', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    let pickedUpOn = 0;
    for (let i = 0; i < 120; i++) {
      sim.tick(1, false);
      if (sim.goldThisTick.length) pickedUpOn = sim.frame;
    }
    expect(sim.goldCollected).toBe(1);
    expect(sim.gold[0].active).toBe(false);
    expect(pickedUpOn).toBeGreaterThan(0);
  });

  it('is not collected when a tile overhead', () => {
    const level = parseLevel({ name: 'x', rows: ['.........', '......$..', 'N........', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    for (let i = 0; i < 120; i++) sim.tick(1, false);
    expect(sim.goldCollected).toBe(0);
  });
});

describe('exit', () => {
  const corridor = (row: string) => parseLevel({ name: 'x', rows: [row, '#'.repeat(row.length)] });

  it('needs both a door (D) and a key (K)', () => {
    expect(() => corridor('N...D....')).toThrow(/both an exit door/);
    expect(() => corridor('N.K.D.D..')).toThrow(/more than one/);
    expect(corridor('N.K...D..').exit).toEqual({ door: { x: 7 * 24 + 12, y: 36 }, key: { x: 3 * 24 + 12, y: 36 } });
  });

  it('is shut until the key is collected', () => {
    const level = corridor('N.D...K..');
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    // Run right past the shut door to the key...
    for (let i = 0; i < 90; i++) sim.tick(1, false);
    expect(sim.won).toBe(false);
    expect(sim.key!.active).toBe(false);
    expect(sim.door!.open).toBe(true);
    // ...then back to the door.
    for (let i = 0; i < 120 && !sim.won; i++) sim.tick(-1, false);
    expect(sim.won).toBe(true);
    expect(sim.ninja.state).toBe(NinjaState.Celebrating);
  });

  it('ends play: the ninja stops responding, collects no more gold and the clock stops', () => {
    const level = corridor('NKD.$....');
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    sim.timeLeft = 600;
    for (let i = 0; i < 60 && !sim.won; i++) sim.tick(1, false);
    expect(sim.won).toBe(true);
    const timeLeft = sim.timeLeft;
    for (let i = 0; i < 120; i++) sim.tick(1, true);
    expect(sim.ninja.state).toBe(NinjaState.Celebrating);
    expect(sim.ninja.xspeed).toBeCloseTo(0);
    expect(sim.goldCollected).toBe(0);
    expect(sim.timeLeft).toBe(timeLeft);
  });
});

describe('clock', () => {
  it('runs one frame per tick, and at zero the ninja dies', () => {
    const level = parseLevel({ name: 'x', rows: ['N........', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    for (let i = 0; i < 30; i++) sim.tick(0, false);
    // Untimed until a time is set.
    expect(sim.timeLeft).toBe(Infinity);
    sim.timeLeft = 50;
    for (let i = 0; i < 49; i++) sim.tick(0, false);
    expect(sim.timeLeft).toBe(1);
    expect(sim.ninja.state).toBe(NinjaState.Immobile);
    sim.tick(0, false);
    expect(sim.timeLeft).toBe(0);
    expect(sim.timedOut).toBe(true);
    expect(sim.ninja.state).toBe(NinjaState.Dead);
  });

  it('gets two seconds for each piece of gold', () => {
    const level = parseLevel({ name: 'x', rows: ['N...$$...', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    sim.timeLeft = 1000;
    for (let i = 0; i < 90; i++) sim.tick(1, false);
    expect(sim.goldCollected).toBe(2);
    expect(sim.timeLeft).toBe(1000 - 90 + 2 * 120);
  });
});

describe('greased blocks (G)', () => {
  /** Jump from the floor into the wall on the right, holding jump for `hold` frames from frame 3; then a second press, if given. */
  function play(wall: string, frames: number, kick?: number) {
    const level = parseLevel({ name: 'g', rows: [...Array(8).fill('....' + wall), 'N....'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY);
    const runner = new AutoRunner(sim.ninja);
    for (let i = 0; i < 20; i++) sim.tick(0, false);
    const log: { state: NinjaState; x: number; y: number; yspeed: number; greased: boolean }[] = [];
    for (let f = 0; f < frames; f++) {
      const held = (f >= 3 && f < 48) || (kick !== undefined && f >= kick && f < kick + 10);
      sim.tick(...runner.control(sim.ninja, held));
      runner.update(sim.ninja);
      const n = sim.ninja;
      log.push({ state: n.state, x: n.xpos, y: n.ypos, yspeed: n.yspeed, greased: n.wallGreased });
    }
    return { sim, log };
  }

  it('are solid blocks: the same shape, and the same to run into and land on', () => {
    const run = (block: string) => {
      const level = parseLevel({ name: 'g', rows: ['.....', `N..${block}.`, `${block}${block}${block}${block}${block}`] });
      const sim = new Simulator(level.map, level.spawnX, level.spawnY);
      const trace: number[] = [];
      for (let i = 0; i < 120; i++) {
        sim.tick(i < 60 ? 1 : -1, i === 70);
        trace.push(sim.ninja.xpos, sim.ninja.ypos);
      }
      return trace;
    };
    expect(parseLevel({ name: 'g', rows: ['NG'] }).map.tileAt(2, 1)).toBe(GREASED_TILE);
    expect(run('G')).toEqual(run('#'));
  });

  it('have no grip: the ninja slides down their walls, speeding up, where a normal wall slows it', () => {
    const normal = play('#', 150).log.filter((e) => e.state === NinjaState.WallSliding);
    const greased = play('G', 150).log.filter((e) => e.state === NinjaState.WallSliding);
    expect(greased.length).toBeGreaterThan(10);
    expect(greased.every((e) => e.greased)).toBe(true);
    expect(normal.some((e) => e.greased)).toBe(false);
    // Speeding up all the way down, and much faster than the steady slide on a normal wall.
    for (let i = 1; i < greased.length; i++) expect(greased[i].yspeed).toBeGreaterThan(greased[i - 1].yspeed);
    expect(Math.max(...greased.map((e) => e.yspeed))).toBeGreaterThan(2 * Math.max(...normal.map((e) => e.yspeed)));
    expect(greased.length).toBeLessThan(normal.length / 1.5);
  });

  it('can still be jumped off', () => {
    const slide = play('G', 150).log.findIndex((e) => e.state === NinjaState.WallSliding);
    const { sim, log } = play('G', slide + 30, slide + 3);
    expect(sim.ninja.wallJumps).toBe(1);
    expect(log[log.length - 1].x).toBeLessThan(log[slide].x - 20);
  });
});
