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
});
