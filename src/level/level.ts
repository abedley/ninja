import { TILE_SIZE } from '../physics/tileDefs';
import type { LaunchPadPlacement, Point } from '../physics/simulator';
import { TileMap } from '../physics/tileMap';

/**
 * A level's terrain is an ASCII grid, one character per tile. The grid is the
 * playable interior; a solid border is added around it automatically (as in N,
 * where levels are 42x23 tiles inside a frame).
 *
 * Legend (tile id in brackets):
 *   .  empty [0]                 #  full [1]
 *   T R B L   half tile, solid on the Top/Right/Bottom/Left [2-5]
 *   y z       45 degree ceiling, solid top-left / top-right [6, 7]
 *   / \       45 degree floor, rising / falling to the right [8, 9]
 *   u v w x   convex quarter circle, solid in top-left/top-right/bottom-right/bottom-left corner [10-13]
 *   U V W X   concave quarter pipe, curved surface facing bottom-right/bottom-left/top-left/top-right [14-17]
 *   a b c d   short mild slopes [18-21]: a,b ceilings; c floor rising right; d floor falling right
 *   e f g h   raised mild slopes [22-25]: e,f ceilings; g floor rising right; h floor falling right
 *   i j k l   short steep slopes [26-29]: i,j ceilings; k floor rising right; l floor falling right
 *   m n o p   raised steep slopes [30-33]: m,n ceilings; o floor rising right; p floor falling right
 *   G         greased full tile [34]: its walls are slippery (the ninja slides down them, speeding up)
 *
 * A mild ramp rising to the right is "cg" (short then raised); falling, "hd".
 * A steep ramp spans two rows in one column: "k" above "o" rising, "l" above "p" falling.
 *
 * Everything else (the ninja's start, gold, toggle gold, mines, the key and
 * door, launch pads) is placed by coordinates, in N++'s 6 px entity units: 4 per tile,
 * counted from the outer edge of the border, so a tile's centre is at 4n + 2
 * and its edges at multiples of 4.
 */
export const TILE_LEGEND = '.#TRBLyz/\\uvwxUVWXabcdefghijklmnopG';
/** N++ positions entities on a quarter-tile grid. */
export const ENTITY_GRID = TILE_SIZE / 4;

/** A point in entity units (see above). */
export type Coord = [number, number];

export interface LevelDef {
  name: string;
  description?: string;
  /** Seconds on the clock at the start (each gold adds two). Untimed if absent. */
  time?: number;
  /** The terrain, one string per row of tiles. */
  rows: string[];
  /** Where the ninja starts. (Every level needs one; it's optional here only so the editor can be without one.) */
  spawn?: Coord;
  /** The way the ninja faces, and sets off, at the start: right if absent. */
  facing?: 'left' | 'right';
  gold?: Coord[];
  mines?: Coord[];
  /** Toggle mines: safe until touched, armed once the ninja moves off them. */
  toggleMines?: Coord[];
  /** Toggle gold: can't be collected until the ninja has touched it once and moved off it. */
  toggleGold?: Coord[];
  /** The key (N++'s exit switch) and the exit door it opens: a level has both or neither. */
  key?: Coord;
  door?: Coord;
  /**
   * Launch pads, as [x, y, direction]. The direction is one of N++'s 8: 0
   * right, 1 down-right, 2 down, 3 down-left, 4 left, 5 up-left, 6 up, 7 up-right.
   */
  launchPads?: [number, number, number][];
}

/** Seconds on the clock for a new level, and what a level's score counts down from. */
export const DEFAULT_LEVEL_TIME = 30;

export interface Level {
  name: string;
  map: TileMap;
  spawnX: number;
  spawnY: number;
  /** The way the ninja faces, and starts running, at the spawn: 1 right, -1 left. */
  facing: 1 | -1;
  /** Entity positions in world px. */
  gold: Point[];
  mines: Point[];
  toggleMines: Point[];
  toggleGold: Point[];
  launchPads: LaunchPadPlacement[];
  exit?: { door: Point; key: Point };
  /** Seconds on the clock at the start, if the level is timed. */
  time?: number;
}

/** The characters older levels used to mark objects in their rows. */
const LEGACY_OBJECTS = 'N<$*%DK';

export function parseLevel(def: LevelDef): Level {
  const innerH = def.rows.length;
  const innerW = def.rows[0]?.length ?? 0;
  if (!innerW) throw new Error(`Level "${def.name}" is empty`);
  const width = innerW + 2;
  const height = innerH + 2;
  const tiles = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < innerH; y++) {
    const row = def.rows[y];
    if (row.length !== innerW) {
      throw new Error(`Level "${def.name}" row ${y} has ${row.length} tiles, expected ${innerW}`);
    }
    for (let x = 0; x < innerW; x++) {
      const ch = row[x];
      const id = TILE_LEGEND.indexOf(ch);
      if (id < 0) {
        if (LEGACY_OBJECTS.includes(ch)) {
          throw new Error(`Level "${def.name}" has "${ch}" in its rows at ${x},${y}: rows are only terrain now, and objects are placed by coordinates`);
        }
        throw new Error(`Level "${def.name}" has unknown tile "${ch}" at ${x},${y}`);
      }
      tiles[(y + 1) * width + (x + 1)] = id;
    }
  }
  if (!def.spawn) throw new Error(`Level "${def.name}" has no spawn (the ninja's start, "spawn": [x, y])`);
  if (def.facing !== undefined && def.facing !== 'left' && def.facing !== 'right') {
    throw new Error(`Level "${def.name}" has facing "${def.facing}" (it must be "left" or "right")`);
  }
  if (!def.key !== !def.door) throw new Error(`Level "${def.name}" needs both an exit door and a key, or neither`);
  const point = ([x, y]: Coord): Point => ({ x: x * ENTITY_GRID, y: y * ENTITY_GRID });
  const launchPads: LaunchPadPlacement[] = [];
  for (const [px, py, orientation] of def.launchPads ?? []) {
    if (!(Number.isInteger(orientation) && orientation >= 0 && orientation < 8)) {
      throw new Error(`Level "${def.name}" has a launch pad with direction ${orientation} (it must be 0-7)`);
    }
    launchPads.push({ ...point([px, py]), orientation });
  }
  const spawn = point(def.spawn);
  return {
    name: def.name,
    map: new TileMap(width, height, tiles),
    // (A spawn in the centre of a tile is 2 px above a floor; the ninja drops once play starts.)
    spawnX: spawn.x,
    spawnY: spawn.y,
    facing: def.facing === 'left' ? -1 : 1,
    gold: (def.gold ?? []).map(point),
    mines: (def.mines ?? []).map(point),
    toggleMines: (def.toggleMines ?? []).map(point),
    toggleGold: (def.toggleGold ?? []).map(point),
    launchPads,
    exit: def.key && def.door ? { door: point(def.door), key: point(def.key) } : undefined,
    time: def.time,
  };
}

/** A level in an older format: objects marked in the rows, and the exit as one entry. */
export interface LegacyLevelDef extends LevelDef {
  exit?: { door: Coord; key: Coord };
}

/**
 * Bring a level written in an older format up to date: objects marked in its
 * rows (N and < the spawn facing right or left, $ gold, * mine, % toggle mine,
 * D door, K key) move to the coordinate lists, in the middle of their tile,
 * and "exit" becomes "key" and "door". Objects from the rows come before those
 * already listed, the order the game used to load them in (which can matter:
 * N++ checks touching objects in the order they were loaded). A level that's
 * already up to date comes back as it was.
 */
export function upgradeLevel(def: LegacyLevelDef): LevelDef {
  const hasLegacy = def.exit !== undefined || def.rows.some((r) => [...r].some((ch) => LEGACY_OBJECTS.includes(ch)));
  if (!hasLegacy) return def;
  const { exit, ...out } = def;
  const found: Record<string, Coord[]> = {};
  const rows = def.rows.map((row, y) =>
    [...row]
      .map((ch, x) => {
        if (!LEGACY_OBJECTS.includes(ch)) return ch;
        (found[ch] ??= []).push([4 * (x + 1) + 2, 4 * (y + 1) + 2]);
        return '.';
      })
      .join(''),
  );
  const merged: LevelDef = { ...out, rows };
  const list = (chars: string, existing: Coord[] = []) => [...chars].flatMap((ch) => found[ch] ?? []).concat(existing);
  // The first spawn in reading order, whichever way it faces.
  const spawns = [...(found.N ?? []), ...(found['<'] ?? [])].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (spawns.length) {
    merged.spawn = spawns[0];
    if (found['<']?.includes(spawns[0])) merged.facing = 'left';
    else delete merged.facing;
  }
  for (const [ch, key] of [['$', 'gold'], ['*', 'mines'], ['%', 'toggleMines']] as const) {
    const all = list(ch, def[key]);
    if (all.length) merged[key] = all;
  }
  const key = found.K?.[0] ?? exit?.key;
  const door = found.D?.[0] ?? exit?.door;
  if (key) merged.key = key;
  if (door) merged.door = door;
  return merged;
}
