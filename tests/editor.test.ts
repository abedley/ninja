import { describe, expect, it } from 'vitest';
import { blankLevel, check, clearRect, copyClip, copyRect, flipClip, pasteClip, exportLevels, exportText, fillStamp, flipStamp, importText, placeObject, placeStamp, rectCells, removeObjects, resize, setCell, setCells, size, stampCorner } from '../src/editor/levelEdit';
import { TILE_POLYS } from '../src/game/tileShapes';
import { parseLevel, TILE_LEGEND, type Coord, type LevelDef } from '../src/level/level';
import testLevels from './fixtures/levels.json';

/** A test level (tests/fixtures/levels.json) with plenty in it. */
const SUMMIT = (testLevels as LevelDef[])[testLevels.length - 1];

/** A small level, with the ninja in the middle of its top-left tile (6 px units: tiles are 4 across, after the border). */
const tiny = (rows: string[], extra: Partial<LevelDef> = {}): LevelDef => ({ name: 'Tiny', description: '', rows, spawn: [6, 6], ...extra });

describe('level editor operations', () => {
  it('starts with a blank level that loads, the ninja in the bottom-left tile', () => {
    const def = blankLevel(8, 5);
    expect(size(def)).toEqual({ width: 8, height: 5 });
    expect(def.spawn).toEqual([6, 22]);
    expect(check(def).errors).toEqual([]);
  });

  it('paints terrain without touching the original, or the objects', () => {
    const def = tiny(['....'], { gold: [[14, 6]] });
    const next = setCell(def, 2, 0, '#');
    expect(next.rows).toEqual(['..#.']);
    expect(def.rows).toEqual(['....']);
    expect(next.gold).toEqual([[14, 6]]);
    // Painting what's already there changes nothing.
    expect(setCell(next, 2, 0, '#')).toBe(next);
    // Out of range is ignored.
    expect(setCell(def, 9, 0, '#')).toBe(def);
    // Erasing a tile leaves the gold in it.
    expect(setCell(next, 2, 0, '.').gold).toEqual([[14, 6]]);
  });

  it('fills rectangles', () => {
    expect(setCells(tiny(['....', '....']), rectCells(3, 1, 1, 0), '#').rows).toEqual(['.###', '.###']);
  });

  it('places stamps by their top-left corner, clipped to the level', () => {
    const def = tiny(['....', '....', '....']);
    expect(placeStamp(def, 1, 1, ['cg']).rows).toEqual(['....', '.cg.', '....']);
    expect(placeStamp(def, 3, 0, ['k', 'o']).rows).toEqual(['...k', '...o', '....']);
    expect(placeStamp(def, 3, 2, ['cg']).rows).toEqual(['....', '....', '...c']);
    expect(placeStamp(def, -1, -1, ['##', '#.']).rows).toEqual(['....', '....', '....']);
    expect(placeStamp(placeStamp(def, 1, 1, ['cg']), 1, 1, ['cg'], true)).toEqual(def);
    // A pasted block overwrites everything under it, empty cells too.
    expect(placeStamp(tiny(['####']), 1, 0, ['.G']).rows).toEqual(['#.G#']);
  });

  it('repeats a stamp across a rectangle, from where it started', () => {
    const def = tiny(['.....', '.....']);
    expect(fillStamp(def, rectCells(0, 0, 4, 1), [0, 0], ['cg']).rows).toEqual(['cgcgc', 'cgcgc']);
    expect(fillStamp(def, rectCells(1, 0, 4, 1), [4, 1], ['k', 'o']).rows).toEqual(['.oooo', '.kkkk']);
    // The block under the pointer, for dragging: stamps line up with the first one.
    expect(stampCorner(['cg'], [1, 1], [4, 3])).toEqual([3, 3]);
    expect(stampCorner(['cg'], [1, 1], [0, 0])).toEqual([-1, 0]);
    expect(stampCorner(['k', 'o'], [1, 1], [2, 4])).toEqual([2, 3]);
  });

  it('copies rectangles of terrain', () => {
    const def = tiny(['#..G', '.cg.', '..#.']);
    expect(copyRect(def, 2, 2, 1, 0)).toEqual(['..', 'cg', '.#']);
    expect(copyRect(def, 3, 1, 9, 9)).toEqual(['.', '.']);
    expect(copyRect(def, 5, 0, 9, 9)).toEqual([]);
  });

  it('flips stamps, mirroring each tile to the one with the mirrored shape', () => {
    expect(flipStamp(['cg', '#.'], 'horizontal')).toEqual(['hd', '.#']);
    expect(flipStamp(['k', 'o'], 'vertical')).toEqual(['n', 'j']);
    expect(flipStamp(flipStamp(['ea'], 'vertical'), 'vertical')).toEqual(['ea']);
    // Every tile against its drawn shape.
    const shape = (id: number, f: (x: number, y: number) => [number, number] = (x, y) => [x, y]) =>
      (TILE_POLYS[id] ?? [])
        .map(([x, y]) => f(x, y).map((v) => Math.round(v * 1000) / 1000 + 0).join(','))
        .sort()
        .join(' ');
    for (const ch of TILE_LEGEND) {
      const id = TILE_LEGEND.indexOf(ch);
      expect(shape(TILE_LEGEND.indexOf(flipStamp([ch], 'horizontal')[0][0])), ch).toBe(shape(id, (x, y) => [24 - x, y]));
      expect(shape(TILE_LEGEND.indexOf(flipStamp([ch], 'vertical')[0][0])), ch).toBe(shape(id, (x, y) => [x, 24 - y]));
    }
  });

  it('copies, clears and pastes rectangles with the objects in them', () => {
    // Tiles are 4 units across from 4 (the border's inner edge): column 1 spans 8-12, row 1 spans 8-12.
    const def = tiny(['....', '.#..', '....'], {
      gold: [[10, 6], [18, 10]],
      toggleGold: [[12, 8]],
      mines: [[10, 12]],
      launchPads: [[9, 14, 7]],
      key: [11, 11],
    });
    // Columns 1-2, rows 1-2: objects on the rectangle's edges count.
    const clip = copyClip(def, 2, 2, 1, 1);
    expect(clip.rows).toEqual(['#.', '..']);
    expect(clip.objects).toEqual({ key: [7, 7], toggleGold: [[8, 4]], mines: [[6, 8]], launchPads: [[5, 10, 7]] });
    // Clearing takes the terrain and the objects.
    const cleared = clearRect(def, 1, 1, 2, 2);
    expect(cleared.rows).toEqual(['....', '....', '....']);
    expect([cleared.gold, cleared.toggleGold, cleared.mines, cleared.launchPads, cleared.key]).toEqual([def.gold, undefined, undefined, undefined, undefined]);
    // Pasting at the top-left: the objects come along, and there's still one key.
    const pasted = pasteClip(def, 0, 0, clip);
    expect(pasted.rows).toEqual(['#...', '....', '....']);
    expect(pasted.key).toEqual([7, 7]);
    // The start was under the paste, but there's only one: it stays.
    expect(pasted.spawn).toEqual([6, 6]);
    expect(pasted.launchPads).toEqual([[9, 14, 7], [5, 10, 7]]);
    // What's under a paste goes, objects too (the gold at 10, 6; the toggle gold and mine are replaced by the copies).
    expect([pasted.gold, pasted.toggleGold, pasted.mines]).toEqual([[[18, 10]], [[8, 4]], [[6, 8]]]);
    // Pasting the same again changes nothing.
    expect(pasteClip(pasted, 0, 0, clip)).toBe(pasted);
    // Off the level's edge, the rest is left out.
    expect(pasteClip(def, 3, 2, clip).rows).toEqual(['....', '.#..', '...#']);
  });

  it('flips copied objects with the terrain, turning launch pads and the start', () => {
    const clip = { rows: ['#.', '..'], objects: { spawn: [6, 7] as Coord, gold: [[11, 5]] as Coord[], launchPads: [[5, 10, 7], [8, 4, 2]] as [number, number, number][] } };
    const h = flipClip(clip, 'horizontal');
    // The clip spans 4 to 12 across: x becomes 16 - x.
    expect(h).toEqual({ rows: ['.#', '..'], objects: { spawn: [10, 7], facing: 'left', gold: [[5, 5]], launchPads: [[11, 10, 5], [8, 4, 2]] } });
    expect(flipClip(h, 'horizontal')).toEqual(clip);
    const v = flipClip(clip, 'vertical');
    expect(v.objects).toEqual({ spawn: [6, 9], gold: [[11, 11]], launchPads: [[5, 6, 1], [8, 12, 6]] });
  });

  it('places objects on any point of the 6 px grid, one per point', () => {
    const def = tiny(['....', '....', '####']);
    // Gold in a tile's corner, a mine on the floor's top edge (6 px unit 12), a pad in mid-air.
    let d = placeObject(def, [9, 5], { kind: 'gold' });
    d = placeObject(d, [13, 12], { kind: 'mines' });
    d = placeObject(d, [15, 7], { kind: 'launchPads', orientation: 4 });
    d = placeObject(d, [11, 9], { kind: 'toggleMines' });
    expect(def.gold).toBeUndefined();
    expect([d.gold, d.mines, d.launchPads, d.toggleMines]).toEqual([[[9, 5]], [[13, 12]], [[15, 7, 4]], [[11, 9]]]);
    // The same again changes nothing; something else on a taken point replaces what was there.
    expect(placeObject(d, [9, 5], { kind: 'gold' })).toBe(d);
    const swapped = placeObject(d, [9, 5], { kind: 'mines' });
    expect(swapped.gold).toBeUndefined();
    expect(swapped.mines).toEqual([[13, 12], [9, 5]]);
    // Turning a launch pad.
    expect(placeObject(d, [15, 7], { kind: 'launchPads', orientation: 6 }).launchPads).toEqual([[15, 7, 6]]);
    // Points on the playable area's edges are fine; beyond them, nothing happens.
    expect(placeObject(def, [4, 4], { kind: 'gold' }).gold).toEqual([[4, 4]]);
    expect(placeObject(def, [3, 8], { kind: 'gold' })).toBe(def);
    expect(placeObject(def, [21, 8], { kind: 'gold' })).toBe(def);
    expect(parseLevel(d).gold).toEqual([{ x: 54, y: 30 }]);
  });

  it('keeps one spawn, one key and one door: placing one moves it', () => {
    let d = tiny(['....', '....']);
    d = placeObject(d, [10, 10], { kind: 'key' });
    d = placeObject(d, [18, 6], { kind: 'door' });
    d = placeObject(d, [14, 10], { kind: 'key' });
    expect([d.key, d.door]).toEqual([[14, 10], [18, 6]]);
    // The spawn, facing left and then back to the right.
    d = placeObject(d, [6, 10], { kind: 'spawn', facing: 'left' });
    expect([d.spawn, d.facing]).toEqual([[6, 10], 'left']);
    d = placeObject(d, [8, 10], { kind: 'spawn' });
    expect([d.spawn, d.facing]).toEqual([[8, 10], undefined]);
    expect(parseLevel(d).exit).toEqual({ key: { x: 84, y: 60 }, door: { x: 108, y: 36 } });
  });

  it('removes the objects near the pointer', () => {
    const d = tiny(['....', '....'], { gold: [[9, 5], [11, 5]], mines: [[17, 9]], key: [14, 10], door: [18, 6], launchPads: [[10, 9, 6]] });
    // Within 1.5 units of a point: the gold at (9, 5) but not (11, 5).
    expect(removeObjects(d, [[8, 5]]).gold).toEqual([[11, 5]]);
    // Along a drag.
    const swept = removeObjects(d, [[10, 9], [14, 10], [18, 6]]);
    expect([swept.launchPads, swept.key, swept.door, swept.mines]).toEqual([undefined, undefined, undefined, [[17, 9]]]);
    // Removing the spawn takes its facing with it; nowhere near anything changes nothing.
    const noSpawn = removeObjects({ ...d, facing: 'left' }, [[6, 6]]);
    expect([noSpawn.spawn, noSpawn.facing, noSpawn.gold]).toEqual([undefined, undefined, d.gold]);
    expect(removeObjects(d, [[22, 12]])).toBe(d);
  });

  it('grows and shrinks at each edge, moving the objects along', () => {
    const def = tiny(['..', '..'], { gold: [[6, 6]], key: [6, 10], door: [10, 6], launchPads: [[10, 12, 6]] });
    const top = resize(def, 'top', 2);
    expect(top.rows).toEqual(['..', '..', '..', '..']);
    expect([top.spawn, top.gold, top.key, top.door, top.launchPads]).toEqual([[6, 14], [[6, 14]], [6, 18], [10, 14], [[10, 20, 6]]]);
    expect(resize(def, 'bottom', 1).rows).toEqual(['..', '..', '..']);
    expect(resize(def, 'left', 1).rows).toEqual(['...', '...']);
    expect(resize(def, 'left', 1).gold).toEqual([[10, 6]]);
    // Objects left outside a smaller level go (the edge itself is still inside).
    const narrow = resize(def, 'right', -1);
    expect(narrow.rows).toEqual(['.', '.']);
    expect([narrow.door, narrow.launchPads, narrow.gold]).toEqual([undefined, undefined, [[6, 6]]]);
    expect(resize(def, 'top', -1).rows).toEqual(['..']);
    expect(resize(def, 'top', -1).spawn).toBeUndefined();
    // Never below one row or column.
    expect(resize(def, 'right', -5).rows).toEqual(['.', '.']);
  });

  it('reports problems', () => {
    expect(check({ ...tiny(['....']), spawn: undefined }).errors.join()).toMatch(/no spawn/);
    expect(check(tiny(['....'], { door: [18, 6] })).errors.join()).toMatch(/both an exit door/);
    expect(check({ ...tiny(['....']), name: ' ' }).errors.join()).toMatch(/name/);
    const exit = { key: [10, 6] as Coord, door: [18, 6] as Coord };
    expect(check(tiny(['....'], exit)).warnings.join()).toMatch(/no time limit/);
    expect(check(tiny(['....'], { time: 30 })).warnings.join()).toMatch(/no exit/);
    expect(check(tiny(['#...'], { time: 30, ...exit })).warnings.join()).toMatch(/inside a solid block/);
    expect(check(tiny(['....'], { time: 30, ...exit }))).toEqual({ errors: [], warnings: [] });
  });

  it('exports an entry for levels.json that loads back the same', () => {
    const text = exportText(SUMMIT);
    expect(text.startsWith('{\n  "name": "Summit",')).toBe(true);
    // One row per line, then the objects, each point on one line.
    expect(text).toContain(`\n    ${JSON.stringify(SUMMIT.rows[0])},\n`);
    expect(text).toMatch(/"rows": \[[^\]]*\],\n {2}"spawn": \[\d+, \d+\],/);
    expect(text).toMatch(/"gold": \[\n {4}\[\d+, \d+\],/);
    const back = importText(text);
    expect(back).toEqual(SUMMIT);
    expect(() => parseLevel(back as LevelDef)).not.toThrow();
    expect(exportText(tiny(['.'], { launchPads: [[6, 8, 6]] }))).toContain('[6, 8, 6]');
    // A whole file: the entries in a list.
    expect(JSON.parse(exportLevels([SUMMIT, SUMMIT]))).toEqual([SUMMIT, SUMMIT]);
  });

  it('imports one entry or a whole levels.json list, and explains bad input', () => {
    expect(importText(JSON.stringify([SUMMIT]))).toEqual(SUMMIT);
    expect(importText('nope')).toMatch(/valid JSON/);
    expect(importText('{"name": "x"}')).toMatch(/rows/);
  });

  it('brings levels in the old format up to date as they come in', () => {
    const old = { name: 'Old', rows: ['N.$.', '....'], exit: { key: [10, 10], door: [18, 6] } };
    expect(importText(JSON.stringify(old))).toEqual({ name: 'Old', rows: ['....', '....'], spawn: [6, 6], gold: [[14, 6]], key: [10, 10], door: [18, 6] });
  });
});
