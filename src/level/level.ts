import { TILE_SIZE } from '../physics/tileDefs';
import type { Point } from '../physics/simulator';
import { TileMap } from '../physics/tileMap';

/**
 * Levels are written as ASCII grids, one character per tile. The grid is the
 * playable interior; a solid border is added around it automatically (as in N,
 * where levels are 42x23 tiles inside a frame).
 *
 * Legend (tile id in brackets):
 *   .  empty [0]                 #  full [1]
 *   N  ninja spawn, facing right (empty tile);  <  ninja spawn, facing left
 *   $  gold, centred in an empty tile
 *   *  mine, centred in an empty tile
 *   %  toggle mine (safe until touched, armed once the ninja moves off it), centred in an empty tile
 *   D  exit door, and K  its key (N++'s exit switch), each centred in an empty tile (at most one of each)
 *   T R B L   half tile, solid on the Top/Right/Bottom/Left [2-5]
 *   y z       45 degree ceiling, solid top-left / top-right [6, 7]
 *   / \       45 degree floor, rising / falling to the right [8, 9]
 *   u v w x   convex quarter circle, solid in top-left/top-right/bottom-right/bottom-left corner [10-13]
 *   U V W X   concave quarter pipe, curved surface facing bottom-right/bottom-left/top-left/top-right [14-17]
 *   a b c d   short mild slopes [18-21]: a,b ceilings; c floor rising right; d floor falling right
 *   e f g h   raised mild slopes [22-25]: e,f ceilings; g floor rising right; h floor falling right
 *   i j k l   short steep slopes [26-29]: i,j ceilings; k floor rising right; l floor falling right
 *   m n o p   raised steep slopes [30-33]: m,n ceilings; o floor rising right; p floor falling right
 *
 * A mild ramp rising to the right is "cg" (short then raised); falling, "hd".
 * A steep ramp spans two rows in one column: "k" above "o" rising, "l" above "p" falling.
 */
export const TILE_LEGEND = '.#TRBLyz/\\uvwxUVWXabcdefghijklmnop';
const SPAWN_CHAR = 'N';
const SPAWN_LEFT_CHAR = '<';
const GOLD_CHAR = '$';
const MINE_CHAR = '*';
const TOGGLE_MINE_CHAR = '%';
const DOOR_CHAR = 'D';
const KEY_CHAR = 'K';
/** N++ positions entities on a quarter-tile grid. */
export const ENTITY_GRID = TILE_SIZE / 4;

export interface LevelDef {
  name: string;
  description?: string;
  rows: string[];
  /**
   * Extra gold at arbitrary positions, as [x, y] in N++ entity units (6 px,
   * counted from the outer edge of the border, so a tile centre is 4n + 2).
   */
  gold?: [number, number][];
  /** Extra mines, in the same units as `gold`. */
  mines?: [number, number][];
  /** Extra toggle mines, in the same units as `gold`. */
  toggleMines?: [number, number][];
  /** The exit door and its key, in the same units (instead of D and K in the rows). */
  exit?: { door: [number, number]; key: [number, number] };
  /** Seconds on the clock at the start (each gold adds two). Untimed if absent. */
  time?: number;
}

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
  exit?: { door: Point; key: Point };
  /** Seconds on the clock at the start, if the level is timed. */
  time?: number;
}

export function parseLevel(def: LevelDef): Level {
  const innerH = def.rows.length;
  const innerW = def.rows[0]?.length ?? 0;
  if (!innerW) throw new Error(`Level "${def.name}" is empty`);
  const width = innerW + 2;
  const height = innerH + 2;
  const tiles = new Uint8Array(width * height).fill(1);
  let spawn: [number, number] | null = null;
  let facing: 1 | -1 = 1;
  const gold: Point[] = [];
  const mines: Point[] = [];
  const toggleMines: Point[] = [];
  const door: Point[] = [];
  const key: Point[] = [];
  const entityLists: Record<string, Point[]> = {
    [GOLD_CHAR]: gold,
    [MINE_CHAR]: mines,
    [TOGGLE_MINE_CHAR]: toggleMines,
    [DOOR_CHAR]: door,
    [KEY_CHAR]: key,
  };

  for (let y = 0; y < innerH; y++) {
    const row = def.rows[y];
    if (row.length !== innerW) {
      throw new Error(`Level "${def.name}" row ${y} has ${row.length} tiles, expected ${innerW}`);
    }
    for (let x = 0; x < innerW; x++) {
      const ch = row[x];
      let id: number;
      if (ch === SPAWN_CHAR || ch === SPAWN_LEFT_CHAR) {
        if (spawn) throw new Error(`Level "${def.name}" has more than one spawn`);
        spawn = [x + 1, y + 1];
        facing = ch === SPAWN_LEFT_CHAR ? -1 : 1;
        id = 0;
      } else if (ch in entityLists) {
        entityLists[ch].push({ x: (x + 1) * TILE_SIZE + TILE_SIZE / 2, y: (y + 1) * TILE_SIZE + TILE_SIZE / 2 });
        id = 0;
      } else {
        id = TILE_LEGEND.indexOf(ch);
        if (id < 0) throw new Error(`Level "${def.name}" has unknown tile "${ch}" at ${x},${y}`);
      }
      tiles[(y + 1) * width + (x + 1)] = id;
    }
  }
  if (!spawn) throw new Error(`Level "${def.name}" has no spawn ("${SPAWN_CHAR}", or "${SPAWN_LEFT_CHAR}" to face left)`);
  const [sx, sy] = spawn;
  const extra = (list: Point[], coords: [number, number][] = []) => {
    for (const [ex, ey] of coords) list.push({ x: ex * ENTITY_GRID, y: ey * ENTITY_GRID });
  };
  extra(gold, def.gold);
  extra(mines, def.mines);
  extra(toggleMines, def.toggleMines);
  if (def.exit) {
    extra(door, [def.exit.door]);
    extra(key, [def.exit.key]);
  }
  if (door.length > 1 || key.length > 1) throw new Error(`Level "${def.name}" has more than one exit door or key`);
  if (door.length !== key.length) throw new Error(`Level "${def.name}" needs both an exit door ("${DOOR_CHAR}") and a key ("${KEY_CHAR}")`);

  return {
    name: def.name,
    map: new TileMap(width, height, tiles),
    // Spawn in the centre of the marked tile; the ninja then settles onto the floor.
    spawnX: sx * TILE_SIZE + TILE_SIZE / 2,
    spawnY: sy * TILE_SIZE + TILE_SIZE / 2,
    facing,
    gold,
    mines,
    toggleMines,
    exit: door.length ? { door: door[0], key: key[0] } : undefined,
    time: def.time,
  };
}
