import { TILE_SEGMENT_CIRCULAR } from '../physics/tileDefs';

/**
 * Solid area of each tile as a polygon in tile-local coordinates, for drawing.
 * (Physics never uses these; it only sees the collision segments.)
 * All polygons share one winding so a single nonzero fill merges them seamlessly.
 */
type Poly = [number, number][];

const LINEAR: Record<number, Poly> = {
  1: [[0, 0], [24, 0], [24, 24], [0, 24]],
  2: [[0, 0], [24, 0], [24, 12], [0, 12]],
  3: [[12, 0], [24, 0], [24, 24], [12, 24]],
  4: [[0, 12], [24, 12], [24, 24], [0, 24]],
  5: [[0, 0], [12, 0], [12, 24], [0, 24]],
  6: [[0, 0], [24, 0], [0, 24]],
  7: [[0, 0], [24, 0], [24, 24]],
  8: [[24, 0], [24, 24], [0, 24]],
  9: [[0, 0], [24, 24], [0, 24]],
  18: [[0, 0], [24, 0], [0, 12]],
  19: [[0, 0], [24, 0], [24, 12]],
  20: [[24, 12], [24, 24], [0, 24]],
  21: [[0, 12], [24, 24], [0, 24]],
  22: [[0, 0], [24, 0], [24, 12], [0, 24]],
  23: [[0, 0], [24, 0], [24, 24], [0, 12]],
  24: [[24, 0], [24, 24], [0, 24], [0, 12]],
  25: [[0, 0], [24, 12], [24, 24], [0, 24]],
  26: [[0, 0], [12, 0], [0, 24]],
  27: [[12, 0], [24, 0], [24, 24]],
  28: [[24, 0], [24, 24], [12, 24]],
  29: [[0, 0], [12, 24], [0, 24]],
  30: [[0, 0], [24, 0], [12, 24], [0, 24]],
  31: [[0, 0], [24, 0], [24, 24], [12, 24]],
  32: [[12, 0], [24, 0], [24, 24], [0, 24]],
  33: [[0, 0], [12, 0], [24, 24], [0, 24]],
};

const ARC_STEPS = 12;

function circularPoly(id: number): Poly {
  const { center, quadrant, convex } = TILE_SEGMENT_CIRCULAR[id];
  const [cx, cy] = center;
  const [h, v] = quadrant;
  // Sweep from the horizontal end of the arc to the vertical end.
  const a0 = Math.atan2(0, h);
  let a1 = Math.atan2(v, 0);
  if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
  const arc: Poly = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = a0 + ((a1 - a0) * i) / ARC_STEPS;
    arc.push([cx + 24 * Math.cos(a), cy + 24 * Math.sin(a)]);
  }
  // Convex: a pie slice around the centre corner. Concave: the tile minus that slice.
  return convex ? [[cx, cy], ...arc] : [[cx + 24 * h, cy + 24 * v], ...arc];
}

function signedArea(p: Poly): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a;
}

export const TILE_POLYS: Readonly<Record<number, Poly>> = (() => {
  const out: Record<number, Poly> = {};
  for (const [id, poly] of Object.entries(LINEAR)) out[Number(id)] = poly;
  for (const id of Object.keys(TILE_SEGMENT_CIRCULAR)) out[Number(id)] = circularPoly(Number(id));
  for (const id of Object.keys(out)) {
    const p = out[Number(id)];
    if (signedArea(p) < 0) p.reverse();
  }
  return out;
})();
