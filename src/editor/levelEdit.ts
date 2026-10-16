import { DEFAULT_LEVEL_TIME, parseLevel, TILE_LEGEND, type LevelDef } from '../level/level';

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
  return { name: 'New level', description: '', time: DEFAULT_LEVEL_TIME, rows };
}

export function size(def: LevelDef): { width: number; height: number } {
  return { width: def.rows[0]?.length ?? 0, height: def.rows.length };
}

/** Set one cell. A spawn (facing either way), door or key placed here is removed from wherever else it was. */
export function setCell(def: LevelDef, x: number, y: number, ch: string): LevelDef {
  return setCells(def, [[x, y]], ch);
}

/**
 * Set many cells to one character (the unique ones: only the last cell gets
 * it). Erasing (".") also removes the coordinate-placed gold, mines and launch
 * pads inside those cells (a pad on a tile's edge counts as in the tile below
 * or to the right of it).
 */
export function setCells(def: LevelDef, cells: readonly [number, number][], ch: string): LevelDef {
  const { width, height } = size(def);
  const inside = cells.filter(([x, y]) => x >= 0 && y >= 0 && x < width && y < height);
  if (!inside.length) return def;
  if (ch === EMPTY) {
    const erased = new Set(inside.map(([x, y]) => `${x},${y}`));
    def = withoutExtras(def, ([ux, uy]) => erased.has(`${Math.floor(ux / UNITS_PER_TILE) - 1},${Math.floor(uy / UNITS_PER_TILE) - 1}`));
  }
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

/** Entities that can be placed in a quarter of a tile (by coordinates, in the level's lists). */
export type QuarterKind = 'gold' | 'mines' | 'toggleMines';
const QUARTER_KINDS: QuarterKind[] = ['gold', 'mines', 'toggleMines'];

/**
 * Put gold, a mine or a toggle mine (or nothing: null) in quarters of tiles. Quarters
 * are given in half-tile steps across the level's rows: (2x + 0 or 1, 2y + 0 or
 * 1) for the left/right, top/bottom quarter of the tile at (x, y). A quarter
 * holds one thing, so placing replaces whatever was there.
 */
export function setQuarters(def: LevelDef, quarters: readonly [number, number][], kind: QuarterKind | null): LevelDef {
  const { width, height } = size(def);
  const taken = new Map<string, [number, number]>();
  for (const [hx, hy] of quarters) {
    if (hx < 0 || hy < 0 || hx >= 2 * width || hy >= 2 * height) continue;
    const p: [number, number] = [quarterCentre(hx), quarterCentre(hy)];
    taken.set(`${p[0]},${p[1]}`, p);
  }
  if (!taken.size) return def;
  const out: LevelDef = { ...def };
  for (const k of QUARTER_KINDS) {
    const before = def[k] ?? [];
    let list = before.filter(([x, y]) => !taken.has(`${x},${y}`));
    if (k === kind) list = [...list, ...taken.values()];
    list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    if (list.length === before.length && list.every(([x, y], i) => x === before[i][0] && y === before[i][1])) continue;
    if (list.length) out[k] = list;
    else delete out[k];
  }
  return QUARTER_KINDS.every((k) => out[k] === def[k]) ? def : out;
}

/**
 * Put a launch pad facing `orientation` (N++'s 0-7, or null to remove them)
 * at points of the 6 px entity grid, counted from the outer edge of the
 * border. A point holds one pad, so placing replaces whatever was there.
 */
export function setLaunchPads(def: LevelDef, points: readonly [number, number][], orientation: number | null): LevelDef {
  const { width, height } = size(def);
  const max = (n: number) => UNITS_PER_TILE * (n + 1);
  const at = new Set(points.filter(([x, y]) => x >= UNITS_PER_TILE && y >= UNITS_PER_TILE && x <= max(width) && y <= max(height)).map(([x, y]) => `${x},${y}`));
  if (!at.size) return def;
  const before = def.launchPads ?? [];
  const list = before.filter(([x, y]) => !at.has(`${x},${y}`));
  if (orientation !== null) {
    for (const key of at) {
      const [x, y] = key.split(',').map(Number);
      list.push([x, y, orientation]);
    }
  }
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (list.length === before.length && list.every((p, i) => p.every((v, j) => v === before[i][j]))) return def;
  const out = { ...def };
  if (list.length) out.launchPads = list;
  else delete out.launchPads;
  return out;
}

/** The centre of a quarter, in entity units, from its half-tile index (the border is one tile). */
function quarterCentre(h: number): number {
  return UNITS_PER_TILE + 2 * h + 1;
}

/** The level without the coordinate-placed gold, mines and launch pads for which `drop` is true. */
function withoutExtras(def: LevelDef, drop: (p: [number, number]) => boolean): LevelDef {
  let out = def;
  for (const k of ['gold', 'mines', 'toggleMines'] as const) {
    const list = def[k];
    if (!list?.some(drop)) continue;
    if (out === def) out = { ...def };
    const kept = list.filter((p) => !drop(p));
    if (kept.length) out[k] = kept;
    else delete out[k];
  }
  const pads = def.launchPads;
  if (pads?.some(([x, y]) => drop([x, y]))) {
    if (out === def) out = { ...def };
    const kept = pads.filter(([x, y]) => !drop([x, y]));
    if (kept.length) out.launchPads = kept;
    else delete out.launchPads;
  }
  return out;
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
  let out: LevelDef = { ...def, rows };
  if (edge === 'top') out = shiftExtras(out, 0, n);
  if (edge === 'left') out = shiftExtras(out, n, 0);
  // Gold, mines and launch pads left outside a smaller level go.
  const w = rows[0].length;
  const h = rows.length;
  const outside = ([x, y]: [number, number]) =>
    x < UNITS_PER_TILE || y < UNITS_PER_TILE || x > UNITS_PER_TILE * (w + 1) || y > UNITS_PER_TILE * (h + 1);
  return n < 0 ? withoutExtras(out, outside) : out;
}

/** Move coordinate-placed entities by whole tiles. */
function shiftExtras(def: LevelDef, dx: number, dy: number): LevelDef {
  const move = ([x, y]: [number, number]): [number, number] => [x + dx * UNITS_PER_TILE, y + dy * UNITS_PER_TILE];
  const out = { ...def };
  if (def.gold) out.gold = def.gold.map(move);
  if (def.mines) out.mines = def.mines.map(move);
  if (def.toggleMines) out.toggleMines = def.toggleMines.map(move);
  if (def.launchPads) out.launchPads = def.launchPads.map(([x, y, o]) => [...move([x, y]), o]);
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
  // Like levels.json: two-space indents, short arrays (coordinates, and launch pads' direction) on one line.
  return JSON.stringify(entry, null, 2).replace(/\[\s+(-?\d+),\s+(-?\d+)(?:,\s+(-?\d+))?\s+\]/g, (_, x, y, o) => `[${x}, ${y}${o === undefined ? '' : `, ${o}`}]`);
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
