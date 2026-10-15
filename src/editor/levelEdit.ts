import { parseLevel, TILE_LEGEND, type LevelDef } from '../level/level';

/**
 * Pure editing operations on level definitions (no DOM), used by the level
 * editor. Levels are ASCII grids (see level.ts for the legend); every
 * operation returns a new definition and leaves the old one untouched, which
 * keeps undo simple.
 */

/** Characters that may appear at most once in a level; each group's members exclude each other (one spawn, facing either way). */
const UNIQUE = [['N', '<'], ['D'], ['K']];
const EMPTY = '.';
/** N++'s 6 px entity units per tile. */
const UNITS_PER_TILE = 4;

export const ENTITY_CHARS = ['N', '<', '$', '*', '%', 'D', 'K'];
export const TILE_CHARS = TILE_LEGEND.split('');

export function blankLevel(width = 12, height = 30): LevelDef {
  const rows = Array.from({ length: height }, () => EMPTY.repeat(width));
  rows[height - 1] = 'N' + EMPTY.repeat(width - 1);
  return { name: 'New level', description: '', time: 60, rows };
}

export function size(def: LevelDef): { width: number; height: number } {
  return { width: def.rows[0]?.length ?? 0, height: def.rows.length };
}

/** Set one cell. A spawn (facing either way), door or key placed here is removed from wherever else it was. */
export function setCell(def: LevelDef, x: number, y: number, ch: string): LevelDef {
  return setCells(def, [[x, y]], ch);
}

/** Set many cells to one character (the unique ones: only the last cell gets it). */
export function setCells(def: LevelDef, cells: readonly [number, number][], ch: string): LevelDef {
  const { width, height } = size(def);
  const inside = cells.filter(([x, y]) => x >= 0 && y >= 0 && x < width && y < height);
  if (!inside.length) return def;
  const grid = def.rows.map((r) => r.split(''));
  const unique = UNIQUE.find((group) => group.includes(ch));
  if (unique) {
    for (const row of grid) for (let i = 0; i < row.length; i++) if (unique.includes(row[i])) row[i] = EMPTY;
    const [x, y] = inside[inside.length - 1];
    grid[y][x] = ch;
  } else {
    for (const [x, y] of inside) grid[y][x] = ch;
  }
  const rows = grid.map((r) => r.join(''));
  return rows.every((r, i) => r === def.rows[i]) ? def : { ...def, rows };
}

/** All cells in the rectangle between two corners (inclusive). */
export function rectCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push([x, y]);
  }
  return out;
}

export type Edge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Add (count > 0) or remove (count < 0) rows or columns at one edge. Entities
 * placed by coordinates (rather than in the rows) move with the grid.
 */
export function resize(def: LevelDef, edge: Edge, count: number): LevelDef {
  const { width, height } = size(def);
  const vertical = edge === 'top' || edge === 'bottom';
  const length = vertical ? height : width;
  // Keep at least one row and column.
  const n = Math.max(count, 1 - length);
  if (n === 0) return def;
  let rows = def.rows;
  if (vertical) {
    if (n > 0) {
      const added = Array.from({ length: n }, () => EMPTY.repeat(width));
      rows = edge === 'top' ? [...added, ...rows] : [...rows, ...added];
    } else {
      rows = edge === 'top' ? rows.slice(-n) : rows.slice(0, rows.length + n);
    }
  } else if (n > 0) {
    rows = rows.map((r) => (edge === 'left' ? EMPTY.repeat(n) + r : r + EMPTY.repeat(n)));
  } else {
    rows = rows.map((r) => (edge === 'left' ? r.slice(-n) : r.slice(0, r.length + n)));
  }
  const out: LevelDef = { ...def, rows };
  if (edge === 'top') return shiftExtras(out, 0, n);
  if (edge === 'left') return shiftExtras(out, n, 0);
  return out;
}

/** Move coordinate-placed entities by whole tiles. */
function shiftExtras(def: LevelDef, dx: number, dy: number): LevelDef {
  const move = ([x, y]: [number, number]): [number, number] => [x + dx * UNITS_PER_TILE, y + dy * UNITS_PER_TILE];
  const out = { ...def };
  if (def.gold) out.gold = def.gold.map(move);
  if (def.mines) out.mines = def.mines.map(move);
  if (def.toggleMines) out.toggleMines = def.toggleMines.map(move);
  if (def.exit) out.exit = { door: move(def.exit.door), key: move(def.exit.key) };
  return out;
}

export interface Check {
  /** Problems that stop the level loading. */
  errors: string[];
  /** Things that probably aren't intended. */
  warnings: string[];
}

export function check(def: LevelDef): Check {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!def.name.trim()) errors.push('Give the level a name.');
  try {
    const level = parseLevel(def);
    if (!level.exit) warnings.push('There is no exit door and key, so the level can’t be completed.');
    if (level.time === undefined) warnings.push('There is no time limit.');
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (def.time !== undefined && !(def.time > 0)) errors.push('The time limit must be more than 0 seconds.');
  return { errors, warnings };
}

/**
 * The level as an entry for src/level/levels.json: name, description and
 * time first, then the rows one per line (and any coordinate-placed entities).
 */
export function exportText(def: LevelDef): string {
  const { name, description, time, rows, ...rest } = def;
  const entry: Record<string, unknown> = { name, description: description ?? '' };
  if (time !== undefined) entry.time = time;
  entry.rows = rows;
  Object.assign(entry, rest);
  // Like levels.json: two-space indents, short arrays (coordinates) on one line.
  return JSON.stringify(entry, null, 2).replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2]');
}

/**
 * Read a level from pasted text: one levels.json entry, or the whole array
 * (the first entry is used). Returns an error message if it isn't one.
 */
export function importText(text: string): LevelDef | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'That isn’t valid JSON. Paste one level, as exported here or as an entry in levels.json.';
  }
  if (Array.isArray(value)) value = value[0];
  const def = value as LevelDef;
  if (!def || typeof def !== 'object' || !Array.isArray(def.rows) || !def.rows.every((r) => typeof r === 'string')) {
    return 'That doesn’t look like a level: it needs a "rows" list of strings.';
  }
  return { ...def, name: typeof def.name === 'string' ? def.name : 'Imported level' };
}
