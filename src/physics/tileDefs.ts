/**
 * Tile geometry, matching the N / N++ tile set.
 *
 * Tiles are 24x24 px. Every tile is described by the collision segments it
 * contributes; there is no notion of "solid area" in the physics, only
 * oriented segments the ninja's circle is pushed out of.
 *
 * Tile ids:
 *   0       empty
 *   1       full
 *   2-5     half tiles (solid top, right, bottom, left half)
 *   6-9     45 degree slopes
 *   10-13   convex quarter circles ("quarter moons")
 *   14-17   concave quarter circles ("quarter pipes")
 *   18-21   short mild slopes      (rise 12 over 24, lower half of a tile)
 *   22-25   raised mild slopes     (rise 12 over 24, upper half of a tile)
 *   26-29   short steep slopes     (rise 24 over 12, half a tile wide)
 *   30-33   raised steep slopes    (rise 24 over 12, with a solid half beside)
 *   34      greased full tile: shaped like 1, but its walls have no grip (not in N)
 */

export const TILE_SIZE = 24;
export const HALF_TILE = 12;
export const TILE_COUNT = 35;
/** A full tile whose walls are greased: the ninja slides down them without friction, speeding up. */
export const GREASED_TILE = 34;

/**
 * Orthogonal half-tile edges contributed by each tile.
 * First 6 values: horizontal half-edges, row by row (top, middle, bottom), left half then right half.
 * Last 6 values: vertical half-edges, column by column (left, middle, right), top half then bottom half.
 * 0 = no edge, -1 = normal faces left/up, 1 = normal faces right/down.
 * Edges of neighbouring tiles that face each other cancel out (they sum to 0).
 */
export const TILE_SEGMENT_ORTHO: readonly (readonly number[])[] = [
  /* 0 */ [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 1 */ [-1, -1, 0, 0, 1, 1, -1, -1, 0, 0, 1, 1],
  /* 2 */ [-1, -1, 1, 1, 0, 0, -1, 0, 0, 0, 1, 0],
  /* 3 */ [0, -1, 0, 0, 0, 1, 0, 0, -1, -1, 1, 1],
  /* 4 */ [0, 0, -1, -1, 1, 1, 0, -1, 0, 0, 0, 1],
  /* 5 */ [-1, 0, 0, 0, 1, 0, -1, -1, 1, 1, 0, 0],
  /* 6 */ [-1, -1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0],
  /* 7 */ [-1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  /* 8 */ [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1],
  /* 9 */ [0, 0, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0],
  /* 10 */ [-1, -1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0],
  /* 11 */ [-1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  /* 12 */ [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1],
  /* 13 */ [0, 0, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0],
  /* 14 */ [-1, -1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0],
  /* 15 */ [-1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  /* 16 */ [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1],
  /* 17 */ [0, 0, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0],
  /* 18 */ [-1, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0],
  /* 19 */ [-1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  /* 20 */ [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1],
  /* 21 */ [0, 0, 0, 0, 1, 1, 0, -1, 0, 0, 0, 0],
  /* 22 */ [-1, -1, 0, 0, 0, 0, -1, -1, 0, 0, 1, 0],
  /* 23 */ [-1, -1, 0, 0, 0, 0, -1, 0, 0, 0, 1, 1],
  /* 24 */ [0, 0, 0, 0, 1, 1, 0, -1, 0, 0, 1, 1],
  /* 25 */ [0, 0, 0, 0, 1, 1, -1, -1, 0, 0, 0, 1],
  /* 26 */ [-1, 0, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0],
  /* 27 */ [0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  /* 28 */ [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1],
  /* 29 */ [0, 0, 0, 0, 1, 0, -1, -1, 0, 0, 0, 0],
  /* 30 */ [-1, -1, 0, 0, 1, 0, -1, -1, 0, 0, 0, 0],
  /* 31 */ [-1, -1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1],
  /* 32 */ [0, -1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1],
  /* 33 */ [-1, 0, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0],
  /* 34 */ [-1, -1, 0, 0, 1, 1, -1, -1, 0, 0, 1, 1],
];

type Point = readonly [number, number];

/**
 * The single non-orthogonal segment of each sloped tile, in tile-local coords.
 * The segment is oriented: its outward normal is (-dy, dx) of p1->p2.
 */
export const TILE_SEGMENT_DIAG: Readonly<Record<number, readonly [Point, Point]>> = {
  6: [[0, 24], [24, 0]],
  7: [[0, 0], [24, 24]],
  8: [[24, 0], [0, 24]],
  9: [[24, 24], [0, 0]],
  18: [[0, 12], [24, 0]],
  19: [[0, 0], [24, 12]],
  20: [[24, 12], [0, 24]],
  21: [[24, 24], [0, 12]],
  22: [[0, 24], [24, 12]],
  23: [[0, 12], [24, 24]],
  24: [[24, 0], [0, 12]],
  25: [[24, 12], [0, 0]],
  26: [[0, 24], [12, 0]],
  27: [[12, 0], [24, 24]],
  28: [[24, 0], [12, 24]],
  29: [[12, 24], [0, 0]],
  30: [[12, 24], [24, 0]],
  31: [[0, 0], [12, 24]],
  32: [[12, 0], [0, 24]],
  33: [[24, 24], [12, 0]],
};

/** Quarter-circle segments: center (tile-local), quadrant the arc lies in, and convexity. */
export const TILE_SEGMENT_CIRCULAR: Readonly<
  Record<number, { center: Point; quadrant: Point; convex: boolean }>
> = {
  10: { center: [0, 0], quadrant: [1, 1], convex: true },
  11: { center: [24, 0], quadrant: [-1, 1], convex: true },
  12: { center: [24, 24], quadrant: [-1, -1], convex: true },
  13: { center: [0, 24], quadrant: [1, -1], convex: true },
  14: { center: [24, 24], quadrant: [-1, -1], convex: false },
  15: { center: [0, 24], quadrant: [1, -1], convex: false },
  16: { center: [0, 0], quadrant: [1, 1], convex: false },
  17: { center: [24, 0], quadrant: [-1, 1], convex: false },
};
