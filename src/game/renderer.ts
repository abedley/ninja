import { CircularSegment, LinearSegment } from '../physics/geometry';
import { GOLD_RADIUS, type Gold } from '../physics/gold';
import { MineState, type Mine } from '../physics/mine';
import { TILE_SIZE } from '../physics/tileDefs';
import type { TileMap } from '../physics/tileMap';
import type { Pose, P } from './animator';
import type { Debris } from './debris';
import { SPARKLE_FRAMES, type Sparkle } from './sparkles';
import { TILE_POLYS } from './tileShapes';

export const COLORS = {
  letterbox: '#a9aab3',
  background: '#cbcbd2',
  tile: '#7c7d8c',
  tileEdge: '#5f606e',
  ninja: '#111114',
  scarf: '#b3262f',
  gold: '#dcaa2e',
  goldLight: '#f6dc86',
  goldDark: '#a3761a',
  mine: '#1b1b20',
  mineCore: '#e0283c',
  mineArming: '#f0a020',
  blast: '#e0283c',
  debug: '#d0204a',
};

/**
 * Zoom: the view shows at least this much of the world (px) across its
 * narrower side, and at least VIEW_MIN_H vertically.
 */
const VIEW_MIN_W = 10 * TILE_SIZE;
const VIEW_MIN_H = 20 * TILE_SIZE;
/** How much of the solid border frame to show at the edges of the level, in px. */
const BORDER_VISIBLE = 8;

export interface NinjaView {
  x: number;
  y: number;
  tilt: number;
  facing: number;
  pose: Pose;
  scarf: readonly P[];
}

export interface Camera {
  x: number;
  y: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private map: TileMap | null = null;
  private solid: Path2D | null = null;
  private outline: Path2D | null = null;
  private dpr = 1;
  /** World-to-screen scale (CSS px per world px). */
  scale = 1;
  /** World position at the top-left of the screen for the current frame. */
  private viewX = 0;
  private viewY = 0;
  private cssW = 0;
  private cssH = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
  }

  setMap(map: TileMap): void {
    this.map = map;
    this.buildPaths(map);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.scale = Math.min(cssW / VIEW_MIN_W, cssH / VIEW_MIN_H);
  }

  /** Size of the view in world px. */
  get viewW(): number {
    return this.cssW / this.scale;
  }

  get viewH(): number {
    return this.cssH / this.scale;
  }

  /**
   * Keep a camera centre inside the level. On an axis where the level is
   * smaller than the screen, the level is centred instead.
   */
  clampCamera(cam: Camera): void {
    const map = this.map;
    if (!map || !this.cssW) return;
    cam.x = clampAxis(cam.x, this.viewW, map.width * TILE_SIZE);
    cam.y = clampAxis(cam.y, this.viewH, map.height * TILE_SIZE);
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [this.viewX + sx / this.scale, this.viewY + sy / this.scale];
  }

  /** Tile shapes and collision outlines, as world-space paths drawn every frame. */
  private buildPaths(map: TileMap): void {
    // All tiles in one path: a single nonzero fill merges them without seams.
    const solid = new Path2D();
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const poly = TILE_POLYS[map.tileAt(tx, ty)];
        if (!poly) continue;
        const ox = tx * TILE_SIZE;
        const oy = ty * TILE_SIZE;
        solid.moveTo(ox + poly[0][0], oy + poly[0][1]);
        for (let i = 1; i < poly.length; i++) solid.lineTo(ox + poly[i][0], oy + poly[i][1]);
        solid.closePath();
      }
    }
    // Outline exactly what the ninja collides with.
    const outline = new Path2D();
    for (const seg of map.allSegments()) {
      if (seg instanceof LinearSegment) {
        outline.moveTo(seg.x1, seg.y1);
        outline.lineTo(seg.x2, seg.y2);
      } else if (seg instanceof CircularSegment) {
        const a0 = Math.atan2(0, seg.hor);
        const a1 = Math.atan2(seg.ver, 0);
        outline.moveTo(seg.pHorX, seg.pHorY);
        outline.arc(seg.cx, seg.cy, seg.radius, a0, a1, Math.sign(seg.hor * seg.ver) < 0);
      }
    }
    this.solid = solid;
    this.outline = outline;
  }

  draw(
    cam: Camera,
    gold: readonly Gold[],
    mines: readonly Mine[],
    sparkles: readonly Sparkle[],
    ninja: NinjaView | null,
    debris: Debris | null,
    debugLines: string[] | null,
    debugCircle: { x: number; y: number; r: number } | null,
  ): void {
    const ctx = this.ctx;
    const map = this.map;
    if (!map || !this.solid || !this.outline) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.letterbox;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Snap the view to whole device pixels so tile edges don't shimmer while scrolling.
    const s = this.scale * this.dpr;
    const ox = Math.round((this.cssW / 2 - cam.x * this.scale) * this.dpr);
    const oy = Math.round((this.cssH / 2 - cam.y * this.scale) * this.dpr);
    this.viewX = -ox / s;
    this.viewY = -oy / s;
    ctx.setTransform(s, 0, 0, s, ox, oy);

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, map.width * TILE_SIZE, map.height * TILE_SIZE);
    ctx.fillStyle = COLORS.tile;
    ctx.fill(this.solid);
    ctx.strokeStyle = COLORS.tileEdge;
    ctx.lineWidth = 1 / this.scale;
    ctx.lineCap = 'round';
    ctx.stroke(this.outline);

    this.drawGold(ctx, gold, debugCircle !== null);
    this.drawMines(ctx, mines, debugCircle !== null);
    this.drawSparkles(ctx, sparkles);
    if (debris) debris.draw(ctx, COLORS.ninja);
    if (ninja) this.drawNinja(ctx, ninja);

    if (debugCircle) {
      ctx.strokeStyle = COLORS.debug;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(debugCircle.x, debugCircle.y, debugCircle.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (debugLines) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.font = '12px ui-monospace, Menlo, monospace';
      ctx.textBaseline = 'top';
      const x = 12;
      let y = 64;
      ctx.fillStyle = 'rgba(20, 20, 24, 0.72)';
      ctx.fillRect(x - 6, y - 6, 220, debugLines.length * 16 + 10);
      ctx.fillStyle = '#f2f2f5';
      for (const line of debugLines) {
        ctx.fillText(line, x, y);
        y += 16;
      }
    }
  }

  /** Gold pieces: small bevelled squares, as in N. */
  private drawGold(ctx: CanvasRenderingContext2D, gold: readonly Gold[], debug: boolean): void {
    const h = 5;
    const b = 1.5;
    for (const g of gold) {
      if (!g.active) continue;
      const x = g.x - h;
      const y = g.y - h;
      ctx.fillStyle = COLORS.goldDark;
      ctx.fillRect(x, y, h * 2, h * 2);
      // Lit top-left bevel, then the face.
      ctx.fillStyle = COLORS.goldLight;
      ctx.beginPath();
      ctx.moveTo(x, y + h * 2);
      ctx.lineTo(x, y);
      ctx.lineTo(x + h * 2, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(x + b, y + b, h * 2 - 2 * b, h * 2 - 2 * b);
    }
    if (debug) {
      ctx.strokeStyle = COLORS.debug;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const g of gold) {
        if (!g.active) continue;
        ctx.moveTo(g.x + GOLD_RADIUS, g.y);
        ctx.arc(g.x, g.y, GOLD_RADIUS, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
  }

  /**
   * Mines: armed ones are spiky and dark with a red core; safe toggle mines
   * are a hollow ring; arming ones glow amber.
   */
  private drawMines(ctx: CanvasRenderingContext2D, mines: readonly Mine[], debug: boolean): void {
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 180);
    for (const m of mines) {
      if (m.state === MineState.Safe) {
        ctx.strokeStyle = COLORS.mine;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 3.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = COLORS.mine;
      ctx.beginPath();
      const spikes = 8;
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i * Math.PI) / spikes;
        const r = i % 2 ? 3.2 : 5.6;
        if (i) ctx.lineTo(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r);
        else ctx.moveTo(m.x + r, m.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = m.state === MineState.Armed ? COLORS.mineCore : COLORS.mineArming;
      ctx.globalAlpha = m.state === MineState.Armed ? pulse : 1;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (debug) {
      ctx.strokeStyle = COLORS.debug;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const m of mines) {
        ctx.moveTo(m.x + m.radius, m.y);
        ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
  }

  /** Bursts: gold pickups (a ring and four glints) and mine blasts (a bigger red ring). */
  private drawSparkles(ctx: CanvasRenderingContext2D, sparkles: readonly Sparkle[]): void {
    for (const s of sparkles) {
      const t = s.age / SPARKLE_FRAMES;
      if (s.kind === 'blast') {
        const ease = 1 - (1 - t) * (1 - t);
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = COLORS.blast;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3 + ease * 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLORS.mineArming;
        ctx.lineWidth = 1.5 * (1 - t) + 0.3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5 + ease * 22, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }
      const ease = 1 - (1 - t) * (1 - t);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = COLORS.gold;
      ctx.lineWidth = 1.2 * (1 - t) + 0.3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4 + ease * 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = COLORS.goldLight;
      const d = 3 + ease * 13;
      const r = 1.6 * (1 - t) + 0.4;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        const gx = s.x + Math.cos(a) * d;
        const gy = s.y + Math.sin(a) * d;
        ctx.beginPath();
        ctx.moveTo(gx, gy - r * 1.6);
        ctx.lineTo(gx + r, gy);
        ctx.lineTo(gx, gy + r * 1.6);
        ctx.lineTo(gx - r, gy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawNinja(ctx: CanvasRenderingContext2D, n: NinjaView): void {
    // Scarf is simulated in world space.
    const scarf = n.scarf;
    if (scarf.length > 1) {
      ctx.strokeStyle = COLORS.scarf;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(scarf[0][0], scarf[0][1]);
      for (let i = 1; i < scarf.length; i++) ctx.lineTo(scarf[i][0], scarf[i][1]);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(n.tilt);
    ctx.scale(n.facing, 1);
    const p = n.pose;
    ctx.strokeStyle = COLORS.ninja;
    ctx.fillStyle = COLORS.ninja;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    polyline(ctx, [p.footA, p.kneeA, p.hip, p.kneeB, p.footB]);
    polyline(ctx, [p.hip, p.neck]);
    polyline(ctx, [p.handA, p.elbowA, p.neck, p.elbowB, p.handB]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.head[0], p.head[1], 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function polyline(ctx: CanvasRenderingContext2D, pts: P[]): void {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

/** Transform a pose-local point into world space. */
export function poseToWorld(p: P, x: number, y: number, tilt: number, facing: number): P {
  const lx = p[0] * facing;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return [x + lx * c - p[1] * s, y + lx * s + p[1] * c];
}

function clampAxis(c: number, view: number, size: number): number {
  const inset = TILE_SIZE - BORDER_VISIBLE;
  if (view >= size - 2 * inset) return size / 2;
  return Math.min(Math.max(c, inset + view / 2), size - inset - view / 2);
}
