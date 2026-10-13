import { TILE_SIZE } from '../physics/tileDefs';
import type { Point } from '../physics/simulator';
import { TileMap } from '../physics/tileMap';

/**
 * Levels are written as ASCII grids, one character per tile. The grid is the
 * playable interior; a solid border is added around it automatically (as in N,
 * where levels are 42x23 tiles inside a frame).
 *
 * Legend (tile id in brackets):
 *   .  empty [0]                 #  full [1]                N  ninja spawn (empty tile)
 *   $  gold, centred in an empty tile
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
const GOLD_CHAR = '$';
/** N++ positions entities on a quarter-tile grid. */
export const ENTITY_GRID = TILE_SIZE / 4;

export interface LevelDef {
  name: string;
  rows: string[];
  /**
   * Extra gold at arbitrary positions, as [x, y] in N++ entity units (6 px,
   * counted from the outer edge of the border, so a tile centre is 4n + 2).
   */
  gold?: [number, number][];
}

export interface Level {
  name: string;
  map: TileMap;
  spawnX: number;
  spawnY: number;
  /** Gold positions in world px. */
  gold: Point[];
}

export function parseLevel(def: LevelDef): Level {
  const innerH = def.rows.length;
  const innerW = def.rows[0]?.length ?? 0;
  if (!innerW) throw new Error(`Level "${def.name}" is empty`);
  const width = innerW + 2;
  const height = innerH + 2;
  const tiles = new Uint8Array(width * height).fill(1);
  let spawn: [number, number] | null = null;
  const gold: Point[] = [];

  for (let y = 0; y < innerH; y++) {
    const row = def.rows[y];
    if (row.length !== innerW) {
      throw new Error(`Level "${def.name}" row ${y} has ${row.length} tiles, expected ${innerW}`);
    }
    for (let x = 0; x < innerW; x++) {
      const ch = row[x];
      let id: number;
      if (ch === SPAWN_CHAR) {
        if (spawn) throw new Error(`Level "${def.name}" has more than one spawn`);
        spawn = [x + 1, y + 1];
        id = 0;
      } else if (ch === GOLD_CHAR) {
        gold.push({ x: (x + 1) * TILE_SIZE + TILE_SIZE / 2, y: (y + 1) * TILE_SIZE + TILE_SIZE / 2 });
        id = 0;
      } else {
        id = TILE_LEGEND.indexOf(ch);
        if (id < 0) throw new Error(`Level "${def.name}" has unknown tile "${ch}" at ${x},${y}`);
      }
      tiles[(y + 1) * width + (x + 1)] = id;
    }
  }
  if (!spawn) throw new Error(`Level "${def.name}" has no spawn ("${SPAWN_CHAR}")`);
  const [sx, sy] = spawn;
  for (const [gx, gy] of def.gold ?? []) gold.push({ x: gx * ENTITY_GRID, y: gy * ENTITY_GRID });

  return {
    name: def.name,
    map: new TileMap(width, height, tiles),
    // Spawn in the centre of the marked tile; the ninja then settles onto the floor.
    spawnX: sx * TILE_SIZE + TILE_SIZE / 2,
    spawnY: sy * TILE_SIZE + TILE_SIZE / 2,
    gold,
  };
}
