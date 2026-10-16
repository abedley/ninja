import { describe, expect, it } from 'vitest';
import { blankLevel, check, exportText, importText, rectCells, resize, setCell, setCells, setLaunchPads, setQuarters, size } from '../src/editor/levelEdit';
import { parseLevel, type LevelDef } from '../src/level/level';
import testLevels from './fixtures/levels.json';

/** A test level (tests/fixtures/levels.json) with plenty in it. */
const SUMMIT = (testLevels as LevelDef[])[testLevels.length - 1];

const tiny = (rows: string[], extra: Partial<LevelDef> = {}): LevelDef => ({ name: 'Tiny', description: '', rows, ...extra });

describe('level editor operations', () => {
  it('starts with a blank level that loads', () => {
    const def = blankLevel(8, 5);
    expect(size(def)).toEqual({ width: 8, height: 5 });
    expect(check(def).errors).toEqual([]);
  });

  it('paints cells without touching the original', () => {
    const def = tiny(['N...']);
    const next = setCell(def, 2, 0, '#');
    expect(next.rows).toEqual(['N.#.']);
    expect(def.rows).toEqual(['N...']);
    // Painting what's already there changes nothing.
    expect(setCell(next, 2, 0, '#')).toBe(next);
    // Out of range is ignored.
    expect(setCell(def, 9, 0, '#')).toBe(def);
  });

  it('keeps one spawn, one door and one key', () => {
    let def = tiny(['N.D.', 'K...']);
    def = setCell(def, 3, 1, 'N');
    def = setCell(def, 1, 0, 'D');
    def = setCell(def, 2, 1, 'K');
    expect(def.rows).toEqual(['.D..', '..KN']);
    // A rectangle of doors is one door, at the last cell.
    expect(setCells(def, rectCells(0, 0, 1, 1), 'D').rows).toEqual(['....', '.DKN']);
    // A spawn facing left replaces the one facing right, and back.
    def = setCell(def, 0, 0, '<');
    expect(def.rows).toEqual(['<D..', '..K.']);
    expect(setCell(def, 1, 1, 'N').rows).toEqual(['.D..', '.NK.']);
  });

  it('puts mines in quarters of tiles, up to four per tile', () => {
    const def = tiny(['N...', '....']);
    // Half-tile steps: tile (1, 0) has quarters (2..3, 0..1).
    const four = setQuarters(def, [[2, 0], [3, 0], [2, 1], [3, 1]], 'mines');
    // Entity units: the tile spans 8..12 across (the border is 0..4) and 4..8 down.
    expect(four.mines).toEqual([[9, 5], [11, 5], [9, 7], [11, 7]]);
    expect(def.mines).toBeUndefined();
    const level = parseLevel(four);
    expect(level.mines.map((m) => [m.x, m.y])).toEqual([[54, 30], [66, 30], [54, 42], [66, 42]]);
    // Placing the same again changes nothing; a toggle mine replaces the mine in its quarter.
    expect(setQuarters(four, [[2, 0], [2, 0]], 'mines')).toBe(four);
    const swapped = setQuarters(four, [[3, 1]], 'toggleMines');
    expect(swapped.mines).toEqual([[9, 5], [11, 5], [9, 7]]);
    expect(swapped.toggleMines).toEqual([[11, 7]]);
    // Erasing one quarter, then the whole tile.
    expect(setQuarters(swapped, [[2, 0]], null).mines).toEqual([[11, 5], [9, 7]]);
    const erased = setCell(swapped, 1, 0, '.');
    expect(erased.mines).toBeUndefined();
    expect(erased.toggleMines).toBeUndefined();
    // Outside the level is ignored.
    expect(setQuarters(def, [[8, 0], [-1, 0]], 'mines')).toBe(def);
    // Shrinking the level drops the ones left outside it.
    expect(resize(four, 'left', -2).mines).toBeUndefined();
    expect(resize(four, 'right', -2).mines).toHaveLength(4);
    // And they're exported, and load back the same.
    expect(importText(exportText(four))).toEqual(four);
    // Gold works the same way, and also takes over a quarter from a mine.
    const gold = setQuarters(four, [[2, 0], [4, 2]], 'gold');
    expect(gold.gold).toEqual([[9, 5], [13, 9]]);
    expect(gold.mines).toEqual([[11, 5], [9, 7], [11, 7]]);
    expect(parseLevel(gold).gold.map((g) => [g.x, g.y])).toEqual([[54, 30], [78, 54]]);
    expect(setCell(gold, 1, 0, '.').gold).toEqual([[13, 9]]);
  });

  it('places launch pads on points of the entity grid, one per point', () => {
    const level = tiny(['N...', '....', '####']);
    // A pad facing up on top of the floor (its top edge is 6 px unit 12), and one facing left in mid-air.
    const one = setLaunchPads(level, [[10, 12]], 6);
    expect(one.launchPads).toEqual([[10, 12, 6]]);
    expect(level.launchPads).toBeUndefined();
    const two = setLaunchPads(one, [[13, 7]], 4);
    expect(two.launchPads).toEqual([[13, 7, 4], [10, 12, 6]]);
    // Placing on a taken point turns the pad there; the same pad again changes nothing.
    expect(setLaunchPads(two, [[10, 12]], 7).launchPads).toEqual([[13, 7, 4], [10, 12, 7]]);
    expect(setLaunchPads(two, [[10, 12]], 6)).toBe(two);
    // Points on the border's inner edge are fine; further out, nothing happens.
    expect(setLaunchPads(level, [[4, 4]], 0).launchPads).toEqual([[4, 4, 0]]);
    expect(setLaunchPads(level, [[3, 8]], 0)).toBe(level);
    expect(setLaunchPads(level, [[21, 8]], 0)).toBe(level);
    // Removing.
    expect(setLaunchPads(two, [[13, 7], [10, 12]], null).launchPads).toBeUndefined();
    // Exported with each pad on one line, and read back the same.
    const text = exportText(two);
    expect(text).toContain('"launchPads": [\n    [13, 7, 4],\n    [10, 12, 6]\n  ]');
    expect(importText(text)).toEqual(two);
    expect(parseLevel(two).launchPads).toEqual([
      { x: 78, y: 42, orientation: 4 },
      { x: 60, y: 72, orientation: 6 },
    ]);
  });

  it('moves launch pads with the grid, and erases them with their tile', () => {
    const level = setLaunchPads(tiny(['N...', '....', '####']), [[10, 12], [13, 7]], 6);
    expect(resize(level, 'left', 1).launchPads).toEqual([[17, 7, 6], [14, 12, 6]]);
    expect(resize(level, 'top', 2).launchPads).toEqual([[13, 15, 6], [10, 20, 6]]);
    // The mid-air pad (13, 7) is in the tile at column 2, row 0.
    expect(setCell(level, 2, 0, '.').launchPads).toEqual([[10, 12, 6]]);
    expect(resize(level, 'right', -2).launchPads).toEqual([[10, 12, 6]]);
  });

  it('fills rectangles', () => {
    expect(setCells(tiny(['N...', '....']), rectCells(3, 1, 1, 0), '#').rows).toEqual(['N###', '.###']);
  });

  it('grows and shrinks at each edge, moving coordinate-placed entities along', () => {
    const def = tiny(['N.', '..'], { gold: [[6, 6]], exit: { door: [10, 6], key: [6, 10] } });
    const top = resize(def, 'top', 2);
    expect(top.rows).toEqual(['..', '..', 'N.', '..']);
    expect(top.gold).toEqual([[6, 14]]);
    expect(top.exit).toEqual({ door: [10, 14], key: [6, 18] });
    expect(resize(def, 'bottom', 1).rows).toEqual(['N.', '..', '..']);
    expect(resize(def, 'left', 1).rows).toEqual(['.N.', '...']);
    expect(resize(def, 'left', 1).gold).toEqual([[10, 6]]);
    expect(resize(def, 'right', -1).rows).toEqual(['N', '.']);
    expect(resize(def, 'top', -1).rows).toEqual(['..']);
    // Never below one row or column.
    expect(resize(def, 'right', -5).rows).toEqual(['N', '.']);
  });

  it('reports problems', () => {
    expect(check(tiny(['....'])).errors.join()).toMatch(/no spawn/);
    expect(check(tiny(['N..D'])).errors.join()).toMatch(/both an exit door/);
    expect(check({ ...tiny(['N...']), name: ' ' }).errors.join()).toMatch(/name/);
    expect(check(tiny(['N.KD'])).warnings.join()).toMatch(/no time limit/);
    expect(check(tiny(['N...'], { time: 30 })).warnings.join()).toMatch(/no exit/);
    expect(check(tiny(['N.KD'], { time: 30 }))).toEqual({ errors: [], warnings: [] });
  });

  it('exports an entry for levels.json that loads back the same', () => {
    const text = exportText(SUMMIT);
    expect(text.startsWith('{\n  "name": "Summit",')).toBe(true);
    // One row per line, as in levels.json.
    expect(text).toContain(`\n    ${JSON.stringify(SUMMIT.rows[0])},\n`);
    const back = importText(text);
    expect(back).toEqual(SUMMIT);
    expect(() => parseLevel(back as LevelDef)).not.toThrow();
    // Coordinates stay on one line.
    expect(exportText(tiny(['N.'], { gold: [[6, 6]] }))).toContain('[6, 6]');
  });

  it('imports one entry or a whole levels.json list, and explains bad input', () => {
    expect(importText(JSON.stringify([SUMMIT]))).toEqual(SUMMIT);
    expect(importText('nope')).toMatch(/valid JSON/);
    expect(importText('{"name": "x"}')).toMatch(/rows/);
  });
});
