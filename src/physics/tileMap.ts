import { CircularSegment, LinearSegment, type Segment } from './geometry';
import {
  HALF_TILE,
  TILE_COUNT,
  TILE_SEGMENT_CIRCULAR,
  TILE_SEGMENT_DIAG,
  TILE_SEGMENT_ORTHO,
  TILE_SIZE,
} from './tileDefs';

/**
 * The static level geometry: a grid of tiles turned into collision segments,
 * bucketed per cell for fast neighbourhood queries.
 *
 * Segment creation and bucketing order mirror N++ (via nclone) so that ties in
 * closest-point queries resolve the same way as in the original.
 */
export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint8Array;
  /** Segments per cell, indexed [x * (height + 1) + y]. */
  private readonly cells: Segment[][];
  private readonly cellStride: number;

  /**
   * @param width  grid width in tiles, including the solid border
   * @param height grid height in tiles, including the solid border
   * @param tiles  tile ids, row-major (tiles[y * width + x])
   */
  constructor(width: number, height: number, tiles: ArrayLike<number>) {
    if (tiles.length !== width * height) {
      throw new Error(`Expected ${width * height} tiles, got ${tiles.length}`);
    }
    this.width = width;
    this.height = height;
    this.tiles = Uint8Array.from(tiles);
    this.cellStride = height + 1;
    this.cells = Array.from({ length: (width + 1) * (height + 1) }, () => []);
    this.buildSegments();
  }

  tileAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 1;
    return this.tiles[y * this.width + x];
  }

  private cell(x: number, y: number): Segment[] {
    return this.cells[x * this.cellStride + y];
  }

  private buildSegments(): void {
    const W = this.width;
    const H = this.height;
    // Half-tile edge accumulators. The outermost edges start "solid from outside",
    // so they cancel against the border tiles and no segment faces out of the map.
    const horW = 2 * W;
    const horH = 2 * H + 1;
    const hor = new Int8Array(horW * horH); // [x * horH + y]
    for (let x = 0; x < horW; x++) {
      hor[x * horH] = 1;
      hor[x * horH + 2 * H] = -1;
    }
    const verW = 2 * W + 1;
    const verH = 2 * H;
    const ver = new Int8Array(verW * verH); // [x * verH + y]
    for (let y = 0; y < verH; y++) {
      ver[y] = 1;
      ver[2 * W * verH + y] = -1;
    }

    for (let tx = 0; tx < W; tx++) {
      for (let ty = 0; ty < H; ty++) {
        const id = this.tiles[ty * W + tx];
        if (id >= TILE_COUNT) throw new Error(`Unknown tile id ${id} at ${tx},${ty}`);
        const ortho = TILE_SEGMENT_ORTHO[id];
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 2; x++) {
            hor[(2 * tx + x) * horH + 2 * ty + y] += ortho[2 * y + x];
          }
        }
        for (let x = 0; x < 3; x++) {
          for (let y = 0; y < 2; y++) {
            ver[(2 * tx + x) * verH + 2 * ty + y] += ortho[2 * x + y + 6];
          }
        }

        const xtl = tx * TILE_SIZE;
        const ytl = ty * TILE_SIZE;
        const diag = TILE_SEGMENT_DIAG[id];
        if (diag) {
          const [[x1, y1], [x2, y2]] = diag;
          this.cell(tx, ty).push(new LinearSegment(xtl + x1, ytl + y1, xtl + x2, ytl + y2));
        }
        const circ = TILE_SEGMENT_CIRCULAR[id];
        if (circ) {
          this.cell(tx, ty).push(
            new CircularSegment(xtl + circ.center[0], ytl + circ.center[1], circ.quadrant[0], circ.quadrant[1], circ.convex),
          );
        }
      }
    }

    // Surviving half-edges become segments, owned by the cell on their solid side.
    for (let x = 0; x < horW; x++) {
      for (let y = 0; y < horH; y++) {
        const state = hor[x * horH + y];
        if (!state) continue;
        const cell = this.cell(Math.floor(x / 2), Math.floor((y - 0.1 * state) / 2));
        const px = HALF_TILE * x;
        const py = HALF_TILE * y;
        cell.push(
          state === 1
            ? new LinearSegment(px, py, px + HALF_TILE, py)
            : new LinearSegment(px + HALF_TILE, py, px, py),
        );
      }
    }
    for (let x = 0; x < verW; x++) {
      for (let y = 0; y < verH; y++) {
        const state = ver[x * verH + y];
        if (!state) continue;
        const cell = this.cell(Math.floor((x - 0.1 * state) / 2), Math.floor(y / 2));
        const px = HALF_TILE * x;
        const py = HALF_TILE * y;
        cell.push(
          state === 1
            ? new LinearSegment(px, py + HALF_TILE, px, py)
            : new LinearSegment(px, py, px, py + HALF_TILE),
        );
      }
    }
  }

  /** Every collision segment in the map (each appears once). */
  allSegments(): Segment[] {
    return this.cells.flat();
  }

  /**
   * Collect the segments of every cell overlapping the given rectangle into `out`
   * (which is cleared first). Returns `out`.
   */
  gatherSegments(x1: number, y1: number, x2: number, y2: number, out: Segment[]): Segment[] {
    out.length = 0;
    const maxX = this.width - 1;
    const maxY = this.height - 1;
    const cx1 = clamp(Math.floor(x1 / TILE_SIZE), 0, maxX);
    const cy1 = clamp(Math.floor(y1 / TILE_SIZE), 0, maxY);
    const cx2 = clamp(Math.floor(x2 / TILE_SIZE), 0, maxX);
    const cy2 = clamp(Math.floor(y2 / TILE_SIZE), 0, maxY);
    for (let cx = cx1; cx <= cx2; cx++) {
      for (let cy = cy1; cy <= cy2; cy++) {
        const segs = this.cell(cx, cy);
        for (let i = 0; i < segs.length; i++) out.push(segs[i]);
      }
    }
    return out;
  }
}

function clamp(n: number, a: number, b: number): number {
  return n < a ? a : n > b ? b : n;
}
