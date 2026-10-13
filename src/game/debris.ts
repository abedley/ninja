import type { ClosestPoint, Segment } from '../physics/geometry';
import { NINJA, getSingleClosestPoint } from '../physics/ninja';
import type { TileMap } from '../physics/tileMap';
import type { P } from './animator';

/**
 * A cheap stand-in for N's ragdoll: when the ninja dies, its limbs fly apart
 * as loose sticks that bounce off the level. Purely cosmetic.
 */
interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  halfLen: number;
  head: boolean;
}

const PIECE_RADIUS = 1.5;

export class Debris {
  private readonly pieces: Piece[] = [];
  private readonly buf: Segment[] = [];
  private readonly cp: ClosestPoint = { backFacing: false, x: 0, y: 0 };

  constructor(private readonly map: TileMap) {}

  /** Break a pose (already in world space) into pieces moving at roughly (vx, vy). */
  static explode(map: TileMap, bones: [P, P][], head: P, vx: number, vy: number): Debris {
    const d = new Debris(map);
    let seed = (Math.abs(head[0] * 131 + head[1] * 71) | 0) + 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (const [a, b] of bones) {
      d.pieces.push({
        x: (a[0] + b[0]) / 2,
        y: (a[1] + b[1]) / 2,
        vx: vx + rand() * 1.2,
        vy: vy + rand() * 1.2 - 0.6,
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
        spin: rand() * 0.35,
        halfLen: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
        head: false,
      });
    }
    d.pieces.push({ x: head[0], y: head[1], vx: vx + rand(), vy: vy - 1, angle: 0, spin: rand() * 0.2, halfLen: 0, head: true });
    return d;
  }

  step(): void {
    for (const p of this.pieces) {
      p.vx *= NINJA.DRAG_REGULAR;
      p.vy = p.vy * NINJA.DRAG_REGULAR + NINJA.GRAVITY_FALL;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      for (let i = 0; i < 4; i++) {
        const result = getSingleClosestPoint(this.map, p.x, p.y, PIECE_RADIUS, this.buf, this.cp);
        if (result === 0) break;
        const dx = p.x - this.cp.x;
        const dy = p.y - this.cp.y;
        const dist = Math.hypot(dx, dy);
        const depen = PIECE_RADIUS - dist * result;
        if (dist === 0 || depen <= 0) break;
        const nx = (dx / dist) * result;
        const ny = (dy / dist) * result;
        p.x += nx * depen;
        p.y += ny * depen;
        const vn = p.vx * nx + p.vy * ny;
        if (vn < 0) {
          // Bounce a little, with friction along the surface.
          const tx = p.vx - vn * nx;
          const ty = p.vy - vn * ny;
          p.vx = tx * 0.8 - vn * nx * 0.35;
          p.vy = ty * 0.8 - vn * ny * 0.35;
          p.spin *= 0.7;
        }
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const p of this.pieces) {
      if (p.head) continue;
      const cx = Math.cos(p.angle) * p.halfLen;
      const cy = Math.sin(p.angle) * p.halfLen;
      ctx.moveTo(p.x - cx, p.y - cy);
      ctx.lineTo(p.x + cx, p.y + cy);
    }
    ctx.stroke();
    for (const p of this.pieces) {
      if (!p.head) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
