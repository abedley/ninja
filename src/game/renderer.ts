import { CircularSegment, LinearSegment } from '../physics/geometry';
import { TILE_SIZE } from '../physics/tileDefs';
import type { TileMap } from '../physics/tileMap';
import type { Pose, P } from './animator';
import type { Debris } from './debris';
import { TILE_POLYS } from './tileShapes';

export const COLORS = {
  letterbox: '#a9aab3',
  background: '#cbcbd2',
  tile: '#7c7d8c',
  tileEdge: '#5f606e',
  ninja: '#111114',
  scarf: '#b3262f',
  debug: '#d0204a',
};

/** How much of the solid border frame to show around the level, in px. */
const BORDER_VISIBLE = 8;

export interface NinjaView {
  x: number;
  y: number;
  tilt: number;
  facing: number;
  pose: Pose;
  scarf: readonly P[];
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly staticLayer = document.createElement('canvas');
  private map: TileMap | null = null;
  private dpr = 1;
  /** World-to-screen transform (CSS px). */
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  private cssW = 0;
  private cssH = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
  }

  setMap(map: TileMap): void {
    this.map = map;
    this.layout();
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.layout();
  }

  /** Fit the level to the screen, then pre-render the static tiles. */
  private layout(): void {
    const map = this.map;
    if (!map || !this.cssW) return;
    const inset = TILE_SIZE - BORDER_VISIBLE;
    const viewW = map.width * TILE_SIZE - 2 * inset;
    const viewH = map.height * TILE_SIZE - 2 * inset;
    this.scale = Math.min(this.cssW / viewW, this.cssH / viewH);
    this.offsetX = (this.cssW - viewW * this.scale) / 2 - inset * this.scale;
    this.offsetY = (this.cssH - viewH * this.scale) / 2 - inset * this.scale;
    this.renderStatic(map, inset, viewW, viewH);
  }

  private renderStatic(map: TileMap, inset: number, viewW: number, viewH: number): void {
    const layer = this.staticLayer;
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext('2d')!;
    ctx.fillStyle = COLORS.letterbox;
    ctx.fillRect(0, 0, layer.width, layer.height);
    this.applyWorldTransform(ctx);

    // Clip to the visible part of the map.
    ctx.beginPath();
    ctx.rect(inset, inset, viewW, viewH);
    ctx.clip();
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(inset, inset, viewW, viewH);

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
    ctx.fillStyle = COLORS.tile;
    ctx.fill(solid);

    // Outline exactly what the ninja collides with.
    ctx.strokeStyle = COLORS.tileEdge;
    ctx.lineWidth = Math.max(1, this.dpr) / (this.scale * this.dpr);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const seg of map.allSegments()) {
      if (seg instanceof LinearSegment) {
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
      } else if (seg instanceof CircularSegment) {
        const a0 = Math.atan2(0, seg.hor);
        const a1 = Math.atan2(seg.ver, 0);
        ctx.moveTo(seg.pHorX, seg.pHorY);
        ctx.arc(seg.cx, seg.cy, seg.radius, a0, a1, Math.sign(seg.hor * seg.ver) < 0);
      }
    }
    ctx.stroke();
  }

  private applyWorldTransform(ctx: CanvasRenderingContext2D): void {
    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.offsetX * this.dpr, this.offsetY * this.dpr);
  }

  draw(ninja: NinjaView | null, debris: Debris | null, debugLines: string[] | null, debugCircle: { x: number; y: number; r: number } | null): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.staticLayer, 0, 0);
    this.applyWorldTransform(ctx);

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
      let y = 56;
      ctx.fillStyle = 'rgba(20, 20, 24, 0.72)';
      ctx.fillRect(x - 6, y - 6, 220, debugLines.length * 16 + 10);
      ctx.fillStyle = '#f2f2f5';
      for (const line of debugLines) {
        ctx.fillText(line, x, y);
        y += 16;
      }
    }
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
