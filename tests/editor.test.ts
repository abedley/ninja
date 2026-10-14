import { describe, expect, it } from 'vitest';
import { blankLevel, check, exportText, importText, rectCells, resize, setCell, setCells, size } from '../src/editor/levelEdit';
import { parseLevel, type LevelDef } from '../src/level/level';
import { TOWER } from '../src/level/levels';

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
    const text = exportText(TOWER);
    expect(text.startsWith('{\n  "name": "Tower",')).toBe(true);
    // One row per line, as in levels.json.
    expect(text).toContain(`\n    "${TOWER.rows[0]}",\n`);
    const back = importText(text);
    expect(back).toEqual(TOWER);
    expect(() => parseLevel(back as LevelDef)).not.toThrow();
    // Coordinates stay on one line.
    expect(exportText(tiny(['N.'], { gold: [[6, 6]] }))).toContain('[6, 6]');
  });

  it('imports one entry or a whole levels.json list, and explains bad input', () => {
    expect(importText(JSON.stringify([TOWER]))).toEqual(TOWER);
    expect(importText('nope')).toMatch(/valid JSON/);
    expect(importText('{"name": "x"}')).toMatch(/rows/);
  });
});
