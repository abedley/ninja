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
