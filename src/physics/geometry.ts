/**
 * Collision primitives: oriented line segments and quarter-circle arcs, plus the
 * swept-circle intersection tests used to stop the ninja tunnelling through walls.
 *
 * These follow N++'s collision model as reverse-engineered by the nclone project
 * (https://github.com/SimonV42/nclone). Arithmetic is kept in the same order as
 * the reference so that results are bit-identical, frame for frame.
 */

/** Result of a closest-point query. Reused to avoid allocations in the hot loop. */
export interface ClosestPoint {
  /** True if the query position lies behind the segment (inside the solid). */
  backFacing: boolean;
  x: number;
  y: number;
}

export interface Segment {
  getClosestPoint(xpos: number, ypos: number, out: ClosestPoint): void;
  /** Fraction of the move [0, 1] at which a circle of `radius` first touches this segment. */
  intersectWithRay(xpos: number, ypos: number, dx: number, dy: number, radius: number): number;
}

export class LinearSegment implements Segment {
  constructor(
    readonly x1: number,
    readonly y1: number,
    readonly x2: number,
    readonly y2: number,
    /** Oriented segments have a solid side. Unoriented ones (doors) collide from both sides. */
    readonly oriented = true,
  ) {}

  getClosestPoint(xpos: number, ypos: number, out: ClosestPoint): void {
    const px = this.x2 - this.x1;
    const py = this.y2 - this.y1;
    const dx = xpos - this.x1;
    const dy = ypos - this.y1;
    const segLenSq = px * px + py * py;
    let u = (dx * px + dy * py) / segLenSq;
    u = Math.max(u, 0);
    u = Math.min(u, 1);
    out.x = this.x1 + u * px;
    out.y = this.y1 + u * py;
    out.backFacing = dy * px - dx * py < 0 && this.oriented;
  }

  intersectWithRay(xpos: number, ypos: number, dx: number, dy: number, radius: number): number {
    const t1 = timeCircleVsCircle(xpos, ypos, dx, dy, this.x1, this.y1, radius);
    const t2 = timeCircleVsCircle(xpos, ypos, dx, dy, this.x2, this.y2, radius);
    const t3 = timeCircleVsLineSeg(xpos, ypos, dx, dy, this.x1, this.y1, this.x2, this.y2, radius);
    return Math.min(t1, t2, t3);
  }
}

export class CircularSegment implements Segment {
  /** Ends of the arc: on the horizontal and vertical radius respectively. */
  readonly pHorX: number;
  readonly pHorY: number;
  readonly pVerX: number;
  readonly pVerY: number;

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly hor: number,
    readonly ver: number,
    /** Convex: solid inside the circle. Concave: solid outside (a quarter pipe). */
    readonly convex: boolean,
    readonly radius = 24,
  ) {
    this.pHorX = cx + radius * hor;
    this.pHorY = cy;
    this.pVerX = cx;
    this.pVerY = cy + radius * ver;
  }

  getClosestPoint(xpos: number, ypos: number, out: ClosestPoint): void {
    const dx = xpos - this.cx;
    const dy = ypos - this.cy;
    out.backFacing = false;
    if (dx * this.hor > 0 && dy * this.ver > 0) {
      // Within the arc's quadrant: closest point is on the arc itself.
      const dist = Math.sqrt(dx * dx + dy * dy);
      out.x = this.cx + (this.radius * dx) / dist;
      out.y = this.cy + (this.radius * dy) / dist;
      out.backFacing = this.convex ? dist < this.radius : dist > this.radius;
    } else if (dx * this.hor > dy * this.ver) {
      out.x = this.pHorX;
      out.y = this.pHorY;
    } else {
      out.x = this.pVerX;
      out.y = this.pVerY;
    }
  }

  intersectWithRay(xpos: number, ypos: number, dx: number, dy: number, radius: number): number {
    const t1 = timeCircleVsCircle(xpos, ypos, dx, dy, this.pHorX, this.pHorY, radius);
    const t2 = timeCircleVsCircle(xpos, ypos, dx, dy, this.pVerX, this.pVerY, radius);
    const t3 = timeCircleVsArc(xpos, ypos, dx, dy, this.cx, this.cy, this.hor, this.ver, this.radius, radius);
    return Math.min(t1, t2, t3);
  }
}

/** Sweep a circle against a point (i.e. another circle with the combined radius). */
export function timeCircleVsCircle(
  xpos: number, ypos: number, vx: number, vy: number, a: number, b: number, radius: number,
): number {
  const dx = xpos - a;
  const dy = ypos - b;
  const distSq = dx * dx + dy * dy;
  const velSq = vx * vx + vy * vy;
  const dot = dx * vx + dy * vy;
  if (distSq - radius * radius > 0) {
    const radicand = dot * dot - velSq * (distSq - radius * radius);
    if (velSq > 0.0001 && dot < 0 && radicand >= 0) {
      return (-dot - Math.sqrt(radicand)) / velSq;
    }
    return 1;
  }
  return 0;
}

/** Sweep a circle against the interior of a line segment (endpoints are handled separately). */
export function timeCircleVsLineSeg(
  xpos: number, ypos: number, dx: number, dy: number,
  a1: number, b1: number, a2: number, b2: number, radius: number,
): number {
  const wx = a2 - a1;
  const wy = b2 - b1;
  const segLen = Math.sqrt(wx * wx + wy * wy);
  const nx = wx / segLen;
  const ny = wy / segLen;
  const normalProj = (xpos - a1) * ny - (ypos - b1) * nx;
  const horProj = (xpos - a1) * nx + (ypos - b1) * ny;
  if (Math.abs(normalProj) >= radius) {
    const dir = dx * ny - dy * nx;
    if (dir * normalProj < 0) {
      const t = Math.min((Math.abs(normalProj) - radius) / Math.abs(dir), 1);
      const horProj2 = horProj + t * (dx * nx + dy * ny);
      if (horProj2 >= 0 && horProj2 <= segLen) return t;
    }
  } else if (horProj >= 0 && horProj <= segLen) {
    return 0;
  }
  return 1;
}

/** Sweep a circle against a quarter-circle arc. Assumes the circle is smaller than the arc. */
export function timeCircleVsArc(
  xpos: number, ypos: number, vx: number, vy: number,
  a: number, b: number, hor: number, ver: number,
  radiusArc: number, radiusCircle: number,
): number {
  const dx = xpos - a;
  const dy = ypos - b;
  const distSq = dx * dx + dy * dy;
  const velSq = vx * vx + vy * vy;
  const dot = dx * vx + dy * vy;
  const radius1 = radiusArc + radiusCircle;
  const radius2 = radiusArc - radiusCircle;
  let t = 1;
  if (distSq > radius1 * radius1) {
    const radicand = dot * dot - velSq * (distSq - radius1 * radius1);
    if (velSq > 0.0001 && dot < 0 && radicand >= 0) {
      t = (-dot - Math.sqrt(radicand)) / velSq;
    }
  } else if (distSq < radius2 * radius2) {
    const radicand = dot * dot - velSq * (distSq - radius2 * radius2);
    if (velSq > 0.0001) {
      t = Math.min((-dot + Math.sqrt(radicand)) / velSq, 1);
    }
  } else {
    t = 0;
  }
  if ((dx + t * vx) * hor > 0 && (dy + t * vy) * ver > 0) return t;
  return 1;
}
