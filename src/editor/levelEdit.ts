import { GREASED_TILE, TILE_SIZE } from '../physics/tileDefs';
import { DEFAULT_LEVEL_TIME, parseLevel, TILE_LEGEND, upgradeLevel, type Coord, type LevelDef } from '../level/level';

/**
 * Pure editing operations on level definitions (no DOM), used by the level
 * editor. Levels are ASCII grids (see level.ts for the legend); every
 * operation returns a new definition and leaves the old one untouched, which
 * keeps undo simple.
 */

const EMPTY = '.';
/** N++'s 6 px entity units per tile. */
const UNITS_PER_TILE = 4;

export const TILE_CHARS = TILE_LEGEND.split('');

export function blankLevel(width = 12, height = 30): LevelDef {
  const rows = Array.from({ length: height }, () => EMPTY.repeat(width));
  // The ninja starts in the bottom-left tile.
  return { name: 'New level', description: '', time: DEFAULT_LEVEL_TIME, rows, spawn: [UNITS_PER_TILE + 2, UNITS_PER_TILE * height + 2] };
}

export function size(def: LevelDef): { width: number; height: number } {
  return { width: def.rows[0]?.length ?? 0, height: def.rows.length };
}

/** Set one terrain cell. */
export function setCell(def: LevelDef, x: number, y: number, ch: string): LevelDef {
  return setCells(def, [[x, y]], ch);
}

/** Set many terrain cells to one tile. (Objects are separate: see placeObject.) */
export function setCells(def: LevelDef, cells: readonly [number, number][], ch: string): LevelDef {
  const { width, height } = size(def);
  const grid = def.rows.map((r) => r.split(''));
  let changed = false;
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= width || y >= height || grid[y][x] === ch) continue;
    grid[y][x] = ch;
    changed = true;
  }
  return changed ? { ...def, rows: grid.map((r) => r.join('')) } : def;
}

/**
 * A block of terrain: rows of tile characters, placed by its top-left
 * corner. A single tile is a 1x1 stamp; copied rectangles and the two-tile
 * ramps are bigger ones.
 */
export type Stamp = readonly string[];

/** The terrain in a rectangle between two corners (inclusive), clipped to the level. */
export function copyRect(def: LevelDef, x0: number, y0: number, x1: number, y1: number): Stamp {
  const { width, height } = size(def);
  const left = Math.max(0, Math.min(x0, x1));
  const right = Math.min(width - 1, Math.max(x0, x1));
  const top = Math.max(0, Math.min(y0, y1));
  const bottom = Math.min(height - 1, Math.max(y0, y1));
  if (left > right || top > bottom) return [];
  return def.rows.slice(top, bottom + 1).map((r) => r.slice(left, right + 1));
}

/** Put a stamp's top-left corner at (x, y); `erase` clears its cells instead. Parts off the level are left out. */
export function placeStamp(def: LevelDef, x: number, y: number, stamp: Stamp, erase = false): LevelDef {
  return fillStamp(def, rectCells(x, y, x + stampWidth(stamp) - 1, y + stamp.length - 1), [x, y], stamp, erase);
}

/**
 * Fill cells with a stamp repeated edge to edge from `origin` (so a
 * rectangle of a two-tile ramp alternates its halves); `erase` clears them.
 */
export function fillStamp(def: LevelDef, cells: readonly [number, number][], origin: [number, number], stamp: Stamp, erase = false): LevelDef {
  const w = stampWidth(stamp);
  const h = stamp.length;
  if (!w || !h) return def;
  const { width, height } = size(def);
  const grid = def.rows.map((r) => r.split(''));
  let changed = false;
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const ch = erase ? EMPTY : stamp[mod(y - origin[1], h)][mod(x - origin[0], w)] ?? EMPTY;
    if (grid[y][x] === ch) continue;
    grid[y][x] = ch;
    changed = true;
  }
  return changed ? { ...def, rows: grid.map((r) => r.join('')) } : def;
}

/** Where the copies of a stamp start, from `origin`, for the block holding (x, y). */
export function stampCorner(stamp: Stamp, origin: [number, number], [x, y]: [number, number]): [number, number] {
  const w = stampWidth(stamp) || 1;
  const h = stamp.length || 1;
  return [origin[0] + Math.floor((x - origin[0]) / w) * w, origin[1] + Math.floor((y - origin[1]) / h) * h];
}

export const stampWidth = (stamp: Stamp) => stamp[0]?.length ?? 0;
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Each tile mirrored left to right, and top to bottom (the rest look the same either way). */
const MIRROR = {
  horizontal: pairs('RL yz /\\ uv wx UV WX ab cd ef gh ij kl mn op'),
  vertical: pairs('TB y\\ z/ ux vw UX VW ad bc eh fg il jk mp no'),
};
function pairs(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [a, b] of spec.split(' ')) [out[a], out[b]] = [b, a];
  return out;
}

/** A stamp flipped left to right or top to bottom, its tiles mirrored too (so ramps still join up). */
export function flipStamp(stamp: Stamp, axis: 'horizontal' | 'vertical'): Stamp {
  const flip = (ch: string) => MIRROR[axis][ch] ?? ch;
  if (axis === 'vertical') return [...stamp].reverse().map((r) => [...r].map(flip).join(''));
  return stamp.map((r) => [...r].reverse().map(flip).join(''));
}

/** The kinds of object a level can hold, by their lists (or single entries) in LevelDef. */
export type ObjectKind = 'spawn' | 'key' | 'door' | 'gold' | 'mines' | 'toggleMines' | 'launchPads';
/** Objects a level has at most one of. */
const SINGLE: ObjectKind[] = ['spawn', 'key', 'door'];
const LISTS = ['gold', 'mines', 'toggleMines', 'launchPads'] as const;

/** What to place: a kind of object, which way a spawn faces, and which way a launch pad points. */
export interface Placement {
  kind: ObjectKind;
  facing?: 'left' | 'right';
  /** A launch pad's direction (N++'s 0-7). */
  orientation?: number;
}

/** Whether a point (in entity units) is inside the playable area, its edges included. */
export function insideLevel(def: LevelDef, [x, y]: Coord): boolean {
  const { width, height } = size(def);
  return x >= UNITS_PER_TILE && y >= UNITS_PER_TILE && x <= UNITS_PER_TILE * (width + 1) && y <= UNITS_PER_TILE * (height + 1);
}

/**
 * Place an object at a point of the 6 px entity grid. A point holds one
 * object, so whatever was there goes; the spawn, key and door move if they
 * were elsewhere.
 */
export function placeObject(def: LevelDef, at: Coord, what: Placement): LevelDef {
  if (!insideLevel(def, at)) return def;
  const [x, y] = at;
  const out = withoutObjects(def, (p) => p[0] === x && p[1] === y);
  if (what.kind === 'spawn') {
    out.spawn = [x, y];
    if (what.facing === 'left') out.facing = 'left';
    else delete out.facing;
  } else if (what.kind === 'key' || what.kind === 'door') {
    out[what.kind] = [x, y];
  } else if (what.kind === 'launchPads') {
    out.launchPads = [...(out.launchPads ?? []), [x, y, what.orientation ?? 6]];
  } else {
    out[what.kind] = [...(out[what.kind] ?? []), [x, y]];
  }
  return sameObjects(def, out) ? def : out;
}

/** Remove every object within `reach` entity units of any of the points. */
export function removeObjects(def: LevelDef, points: readonly Coord[], reach = 1.5): LevelDef {
  const near = (p: Coord) => points.some(([x, y]) => Math.hypot(p[0] - x, p[1] - y) <= reach);
  const out = withoutObjects(def, near);
  return sameObjects(def, out) ? def : out;
}

/** A copy of the level without the objects at points where `drop` is true. */
function withoutObjects(def: LevelDef, drop: (p: Coord) => boolean): LevelDef {
  const out: LevelDef = { ...def };
  for (const k of SINGLE) {
    const p = out[k as 'spawn' | 'key' | 'door'];
    if (p && drop(p)) delete out[k as 'spawn' | 'key' | 'door'];
  }
  if (!out.spawn) delete out.facing;
  for (const k of LISTS) {
    const list = def[k] as Coord[] | undefined;
    if (!list) continue;
    const kept = list.filter((p) => !drop([p[0], p[1]]));
    if (kept.length) (out[k] as Coord[]) = kept;
    else delete out[k];
  }
  return out;
}

/** Whether two levels have the same objects in the same places. */
function sameObjects(a: LevelDef, b: LevelDef): boolean {
  return (['facing', ...SINGLE, ...LISTS] as const).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
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

/** Add (count > 0) or remove (count < 0) rows or columns at one edge. Objects move with the grid. */
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
  if (edge === 'top') out = shiftObjects(out, 0, n);
  if (edge === 'left') out = shiftObjects(out, n, 0);
  // Objects left outside a smaller level go.
  return n < 0 ? withoutObjects(out, (p) => !insideLevel(out, p)) : out;
}

/** Move all the objects by whole tiles. */
function shiftObjects(def: LevelDef, dx: number, dy: number): LevelDef {
  const move = ([x, y]: Coord): Coord => [x + dx * UNITS_PER_TILE, y + dy * UNITS_PER_TILE];
  const out = { ...def };
  if (def.spawn) out.spawn = move(def.spawn);
  if (def.key) out.key = move(def.key);
  if (def.door) out.door = move(def.door);
  if (def.gold) out.gold = def.gold.map(move);
  if (def.mines) out.mines = def.mines.map(move);
  if (def.toggleMines) out.toggleMines = def.toggleMines.map(move);
  if (def.launchPads) out.launchPads = def.launchPads.map(([x, y, o]) => [...move([x, y]), o]);
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
    const tile = level.map.tileAt(Math.floor(level.spawnX / TILE_SIZE), Math.floor(level.spawnY / TILE_SIZE));
    if (tile === 1 || tile === GREASED_TILE) warnings.push('The ninja starts inside a solid block.');
    if (!level.exit) warnings.push('There is no exit door and key, so the level can’t be completed.');
    if (level.time === undefined) warnings.push('There is no time limit.');
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (def.time !== undefined && !(def.time > 0)) errors.push('The time limit must be more than 0 seconds.');
  return { errors, warnings };
}

/** The order of a level's fields in levels.json. */
const FIELD_ORDER = ['name', 'description', 'time', 'rows', 'spawn', 'facing', 'key', 'door', 'gold', 'mines', 'toggleMines', 'launchPads'];

/**
 * The level as an entry for src/level/levels.json: name, description and
 * time first, then the terrain rows one per line, then the objects.
 */
export function exportText(def: LevelDef): string {
  const entry: Record<string, unknown> = { name: def.name, description: def.description ?? '' };
  const fields = def as unknown as Record<string, unknown>;
  for (const k of [...FIELD_ORDER, ...Object.keys(def)]) {
    if (!(k in entry) && fields[k] !== undefined) entry[k] = fields[k];
  }
  // Like levels.json: two-space indents, short arrays (coordinates, and launch pads' direction) on one line.
  return JSON.stringify(entry, null, 2).replace(/\[\s+(-?\d+),\s+(-?\d+)(?:,\s+(-?\d+))?\s+\]/g, (_, x, y, o) => `[${x}, ${y}${o === undefined ? '' : `, ${o}`}]`);
}

/** A list of levels as the text of levels.json. */
export function exportLevels(defs: readonly LevelDef[]): string {
  return `[\n${defs.map((d) => exportText(d).replace(/^/gm, '  ')).join(',\n')}\n]\n`;
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
  // Levels in the old format (objects marked in the rows) are brought up to date.
  return upgradeLevel({ ...def, name: typeof def.name === 'string' ? def.name : 'Imported level' });
}
