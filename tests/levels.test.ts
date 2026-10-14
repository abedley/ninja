import { describe, expect, it } from 'vitest';
import { parseLevel } from '../src/level/level';
import { LEVELS } from '../src/level/levels';
import { Simulator } from '../src/physics/simulator';
import { NinjaState } from '../src/physics/ninja';

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
