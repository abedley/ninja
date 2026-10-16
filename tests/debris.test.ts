import { describe, expect, it } from 'vitest';
import { Debris } from '../src/game/debris';
import { parseAscii } from './helpers';

describe('death debris', () => {
  it('settles on the floor instead of falling through it', () => {
    const level = parseAscii({ name: 'box', rows: ['.....', '..N..', '#####'] });
    const debris = Debris.explode(level.map, [[[50, 40], [50, 46]], [[46, 44], [54, 44]]], [50, 36], 2, -3);
    for (let i = 0; i < 600; i++) debris.step();
    // Floor top is at y = 3 * 24 = 72; nothing should end up below it.
    const pieces = (debris as unknown as { pieces: { x: number; y: number }[] }).pieces;
    for (const p of pieces) {
      expect(p.y).toBeLessThanOrEqual(72);
      expect(p.y).toBeGreaterThan(24);
      expect(p.x).toBeGreaterThan(24);
      expect(p.x).toBeLessThan(6 * 24);
    }
  });
});
