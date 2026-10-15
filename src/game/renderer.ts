import { EXIT_DOOR_RADIUS, EXIT_KEY_RADIUS, type ExitDoor, type ExitKey } from '../physics/exit';
import { CircularSegment, LinearSegment } from '../physics/geometry';
import { GOLD_RADIUS, type Gold } from '../physics/gold';
import { MineState, type Mine } from '../physics/mine';
import { GREASED_TILE, TILE_SIZE } from '../physics/tileDefs';
import type { TileMap } from '../physics/tileMap';
import type { Pose, P } from './animator';
import type { Debris } from './debris';
import { SPARKLE_FRAMES, sparkleLife, type Sparkle } from './sparkles';
import { Cityscape } from './cityscape';
import { TILE_POLYS } from './tileShapes';

/** Midnight-city neon palette. */
export const COLORS = {
  tile: '#15112f',
  /** Platform edges: a neon tube (wide faint glow, then a bright core). */
  edge: '#25d4ff',
  edgeCore: '#c9f6ff',
  /** Greased walls: an oily orange tube instead, with drips down the block. */
  grease: '#ff8a2a',
  greaseCore: '#ffd9b8',
  greaseDrip: 'rgba(255, 138, 42, 0.22)',
  ninja: '#06040e',
  /** The rim light around the ninja's dark silhouette. */
  ninjaGlow: '#5fe6ff',
  scarf: '#ff2bd6',
  scarfCore: '#ffc6f2',
  gold: '#ffd23f',
  goldLight: '#fff2b8',
  goldDark: '#c88a12',
  mine: '#1a0610',
  mineGlow: '#ff2d55',
  mineCore: '#ff6a86',
  mineArming: '#ffb020',
  blast: '#ff2d55',
  key: '#9dff4a',
  keyLight: '#e2ffc6',
  doorFrame: '#8a5cff',
  doorShut: '#0d0a22',
  doorOpen: '#f2ffe2',
  doorGlow: '#9dff4a',
  doorLeaf: '#1c1544',
  debug: '#ff4a7a',
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

export interface ExitView {
  door: ExitDoor | null;
  key: ExitKey | null;
}

export interface Camera {
  x: number;
  y: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly city = new Cityscape();
  private map: TileMap | null = null;
  private chunks: Chunk[] = [];
  private dpr = 1;
  /** World-to-screen scale (CSS px per world px). */
  scale = 1;
  /** World position at the top-left of the screen for the current frame. */
  private viewX = 0;
  private viewY = 0;
  private cssW = 0;
  private cssH = 0;
  /** Height (CSS px) of the HUD over the top of the screen: the top of a level can scroll down below it. */
  topInset = 0;
  /** Gold and mines, drawn once at the current resolution (see EntitySprites). */
  private sprites: EntitySprites | null = null;

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
    cam.y = clampAxis(cam.y, this.viewH, map.height * TILE_SIZE, this.topInset / this.scale);
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [this.viewX + sx / this.scale, this.viewY + sy / this.scale];
  }

  /**
   * Tile shapes, collision outlines and the platform texture, as world-space
   * paths drawn every frame. They're split into bands of rows so only the
   * bands on screen are drawn.
   */
  private buildPaths(map: TileMap): void {
    const chunks: Chunk[] = [];
    for (let y = 0; y < map.height; y += CHUNK_ROWS) {
      chunks.push({
        y0: y * TILE_SIZE,
        y1: Math.min(map.height, y + CHUNK_ROWS) * TILE_SIZE,
        solid: new Path2D(),
        outline: new Path2D(),
        seams: new Path2D(),
        windows: WINDOW_LIGHTS.map(() => new Path2D()),
        drips: new Path2D(),
        greaseOutline: new Path2D(),
      });
    }
    const chunkAt = (y: number) => chunks[Math.min(chunks.length - 1, Math.max(0, Math.floor(y / TILE_SIZE / CHUNK_ROWS)))];
    for (let ty = 0; ty < map.height; ty++) {
      const chunk = chunkAt(ty * TILE_SIZE);
      for (let tx = 0; tx < map.width; tx++) {
        const id = map.tileAt(tx, ty);
        const poly = TILE_POLYS[id];
        if (!poly) continue;
        const ox = tx * TILE_SIZE;
        const oy = ty * TILE_SIZE;
        // All tiles of a band in one path: a single nonzero fill merges them without seams.
        chunk.solid.moveTo(ox + poly[0][0], oy + poly[0][1]);
        for (let i = 1; i < poly.length; i++) chunk.solid.lineTo(ox + poly[i][0], oy + poly[i][1]);
        chunk.solid.closePath();
        if (id === GREASED_TILE) {
          // A few drips down the block (the same ones every time), each ending in a drop.
          let h = (Math.imul(tx, 2654435761) ^ Math.imul(ty, 40503)) >>> 0;
          for (let d = 0; d < 3; d++) {
            h = (Math.imul(h, 1103515245) + 12345) >>> 0;
            const x = ox + 3 + d * 7 + (h % 5);
            const top = (h >>> 4) % 6;
            const len = 6 + ((h >>> 8) % (15 - top));
            chunk.drips.rect(x, oy + top, 1.6, len);
            chunk.drips.moveTo(x + 2.1, oy + top + len);
            chunk.drips.arc(x + 0.8, oy + top + len, 1.3, 0, Math.PI * 2);
          }
          continue;
        }
        if (id !== 1) continue;
        // Full tiles get panel seams and a few dimly lit windows (the same ones every time).
        chunk.seams.rect(ox, oy, TILE_SIZE, 0.6);
        chunk.seams.rect(ox, oy, 0.6, TILE_SIZE);
        let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663)) >>> 0;
        for (let w = 0; w < 4; w++) {
          h = (Math.imul(h, 1103515245) + 12345) >>> 0;
          if (h % 100 >= 12) continue;
          chunk.windows[(h >>> 8) % WINDOW_LIGHTS.length].rect(ox + 5 + (w % 2) * 10, oy + 4 + (w >> 1) * 10, 4, 5.5);
        }
      }
    }
    // Outline exactly what the ninja collides with.
    for (const seg of map.allSegments()) {
      if (seg instanceof LinearSegment) {
        const chunk = chunkAt((seg.y1 + seg.y2) / 2);
        // A wall with a greased block on either side of it is greased.
        const midY = (seg.y1 + seg.y2) / 2;
        const greased = seg.x1 === seg.x2 && (map.isGreasedAt(seg.x1 - 1, midY) || map.isGreasedAt(seg.x1 + 1, midY));
        const path = greased ? chunk.greaseOutline : chunk.outline;
        path.moveTo(seg.x1, seg.y1);
        path.lineTo(seg.x2, seg.y2);
      } else if (seg instanceof CircularSegment) {
        const path = chunkAt(seg.cy).outline;
        const a0 = Math.atan2(0, seg.hor);
        const a1 = Math.atan2(seg.ver, 0);
        path.moveTo(seg.pHorX, seg.pHorY);
        path.arc(seg.cx, seg.cy, seg.radius, a0, a1, Math.sign(seg.hor * seg.ver) < 0);
      }
    }
    this.chunks = chunks;
  }

  draw(
    cam: Camera,
    gold: readonly Gold[],
    mines: readonly Mine[],
    exit: ExitView,
    sparkles: readonly Sparkle[],
    ninja: NinjaView | null,
    debris: Debris | null,
    debugLines: string[] | null,
    debugCircle: { x: number; y: number; r: number } | null,
  ): void {
    const ctx = this.ctx;
    const map = this.map;
    if (!map) return;
    const now = performance.now();

    // The city, in parallax: how far the camera has climbed from the bottom of the level drives it.
    const bottom = { x: cam.x, y: Infinity };
    this.clampCamera(bottom);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.city.draw(ctx, this.cssW, this.cssH, (bottom.y - cam.y) * this.scale, cam.x * this.scale, now);

    // Snap the view to whole device pixels so tile edges don't shimmer while scrolling.
    const s = this.scale * this.dpr;
    const ox = Math.round((this.cssW / 2 - cam.x * this.scale) * this.dpr);
    const oy = Math.round((this.cssH / 2 - cam.y * this.scale) * this.dpr);
    this.viewX = -ox / s;
    this.viewY = -oy / s;
    ctx.setTransform(s, 0, 0, s, ox, oy);
    if (this.sprites?.pxPerUnit !== s) this.sprites = new EntitySprites(s);

    // Platforms: dark building blocks, with a few lit windows, edged with neon tubes.
    // (Glow reaches a few px beyond a band, so bands just off screen are drawn too.)
    const visible = this.chunks.filter((c) => c.y1 + 8 > this.viewY && c.y0 - 8 < this.viewY + this.viewH);
    ctx.fillStyle = COLORS.tile;
    for (const c of visible) ctx.fill(c.solid);
    ctx.fillStyle = 'rgba(140, 150, 255, 0.07)';
    for (const c of visible) ctx.fill(c.seams);
    WINDOW_LIGHTS.forEach((color, i) => {
      ctx.fillStyle = color;
      for (const c of visible) ctx.fill(c.windows[i]);
    });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = COLORS.edge;
    for (const [width, alpha] of [[8, 0.05], [3.2, 0.12], [1.4, 0.4]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      for (const c of visible) ctx.stroke(c.outline);
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = COLORS.edgeCore;
    ctx.lineWidth = 0.55;
    for (const c of visible) ctx.stroke(c.outline);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.greaseDrip;
    for (const c of visible) ctx.fill(c.drips);
    ctx.strokeStyle = COLORS.grease;
    for (const [width, alpha] of [[8, 0.07], [3.2, 0.16], [1.4, 0.5]]) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      for (const c of visible) ctx.stroke(c.greaseOutline);
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = COLORS.greaseCore;
    ctx.lineWidth = 0.55;
    for (const c of visible) ctx.stroke(c.greaseOutline);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.drawExit(ctx, exit, debugCircle !== null, now);
    this.drawGold(ctx, gold, debugCircle !== null, now);
    this.drawMines(ctx, mines, debugCircle !== null, now);
    this.drawSparkles(ctx, sparkles);
    if (debris) {
      this.glow(COLORS.ninjaGlow, 2.5);
      debris.draw(ctx, COLORS.ninja);
      this.noGlow();
    }
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

  /** Glow for what's drawn next (blur in world px, so it scales with the zoom). */
  private glow(color: string, blur: number): void {
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = blur * this.scale * this.dpr;
  }

  private noGlow(): void {
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = 'transparent';
  }

  /** Whether a circle (world px) is on screen. */
  private onScreen(x: number, y: number, r: number): boolean {
    return x + r > this.viewX && x - r < this.viewX + this.viewW && y + r > this.viewY && y - r < this.viewY + this.viewH;
  }

  /**
   * The exit door fills its tile: shut, a dark panel in a dim violet frame
   * with a glowing keyhole; open, it blazes. The key floats and bobs in a halo.
   */
  private drawExit(ctx: CanvasRenderingContext2D, exit: ExitView, debug: boolean, now: number): void {
    const { door, key } = exit;
    if (door && this.onScreen(door.x, door.y, 40)) {
      const w = 9;
      const h = 12;
      const x = door.x;
      const y = door.y;
      if (door.open) {
        const pulse = 0.75 + 0.25 * Math.sin(now / 220);
        radialGlow(ctx, x, y, 34, COLORS.doorGlow, 0.45 * pulse);
        const light = ctx.createLinearGradient(0, y - h, 0, y + h);
        light.addColorStop(0, COLORS.doorOpen);
        light.addColorStop(1, COLORS.doorGlow);
        ctx.fillStyle = light;
        this.glow(COLORS.doorGlow, 8);
        ctx.fillRect(x - w, y - h, w * 2, h * 2);
        this.noGlow();
        // The door leaf, swung inwards.
        ctx.fillStyle = COLORS.doorLeaf;
        ctx.beginPath();
        ctx.moveTo(x - w, y - h);
        ctx.lineTo(x - w + 5, y - h + 3);
        ctx.lineTo(x - w + 5, y + h - 1.5);
        ctx.lineTo(x - w, y + h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = COLORS.doorOpen;
      } else {
        ctx.fillStyle = COLORS.doorShut;
        ctx.fillRect(x - w, y - h, w * 2, h * 2);
        // Keyhole, glowing in the key's colour.
        this.glow(COLORS.key, 3);
        ctx.fillStyle = COLORS.key;
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now / 400);
        ctx.beginPath();
        ctx.arc(x, y - 1.5, 2, 0, Math.PI * 2);
        ctx.moveTo(x - 1, y - 1);
        ctx.lineTo(x + 1, y - 1);
        ctx.lineTo(x + 1.6, y + 3.5);
        ctx.lineTo(x - 1.6, y + 3.5);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = COLORS.doorFrame;
      }
      this.glow(door.open ? COLORS.doorGlow : COLORS.doorFrame, door.open ? 6 : 3);
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x - w - 0.7, y - h - 0.7, w * 2 + 1.4, h * 2 + 0.7);
      this.noGlow();
    }
    if (key?.active && this.onScreen(key.x, key.y, 20)) {
      const x = key.x;
      const y = key.y + Math.sin(now / 300) * 1.2;
      radialGlow(ctx, x, y, 14, COLORS.key, 0.3 + 0.12 * Math.sin(now / 300));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 4);
      ctx.scale(1.25, 1.25);
      // Bow (the ring), shaft and two teeth, as a neon outline.
      ctx.beginPath();
      ctx.arc(-3, 0, 2.6, 0, Math.PI * 2);
      ctx.moveTo(-0.6, -0.9);
      ctx.lineTo(5.4, -0.9);
      ctx.lineTo(5.4, 2.6);
      ctx.lineTo(4, 2.6);
      ctx.lineTo(4, 0.9);
      ctx.lineTo(2.8, 0.9);
      ctx.lineTo(2.8, 2.2);
      ctx.lineTo(1.6, 2.2);
      ctx.lineTo(1.6, 0.9);
      ctx.lineTo(-0.6, 0.9);
      ctx.closePath();
      ctx.fillStyle = 'rgba(157, 255, 74, 0.25)';
      ctx.fill('evenodd');
      this.glow(COLORS.key, 4);
      ctx.strokeStyle = COLORS.key;
      ctx.lineWidth = 0.9;
      ctx.lineJoin = 'round';
      ctx.stroke();
      this.noGlow();
      ctx.strokeStyle = COLORS.keyLight;
      ctx.lineWidth = 0.35;
      ctx.stroke();
      ctx.restore();
    }
    if (debug) {
      ctx.strokeStyle = COLORS.debug;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      if (door) {
        ctx.moveTo(door.x + EXIT_DOOR_RADIUS, door.y);
        ctx.arc(door.x, door.y, EXIT_DOOR_RADIUS, 0, Math.PI * 2);
      }
      if (key?.active) {
        ctx.moveTo(key.x + EXIT_KEY_RADIUS, key.y);
        ctx.arc(key.x, key.y, EXIT_KEY_RADIUS, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
  }

  /** Gold: glowing neon squares that shimmer, each a little out of step. */
  private drawGold(ctx: CanvasRenderingContext2D, gold: readonly Gold[], debug: boolean, now: number): void {
    const sprite = this.sprites!.gold;
    for (const g of gold) {
      if (!g.active || !this.onScreen(g.x, g.y, sprite.r)) continue;
      ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now / 350 + g.x * 0.13 + g.y * 0.07);
      sprite.stamp(ctx, g.x, g.y);
    }
    ctx.globalAlpha = 1;
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
   * Mines: armed ones are spiky, with a red neon edge and a pulsing core;
   * safe toggle mines are a faint ring; arming ones glow amber.
   */
  private drawMines(ctx: CanvasRenderingContext2D, mines: readonly Mine[], debug: boolean, now: number): void {
    const pulse = 0.7 + 0.3 * Math.sin(now / 160);
    const sprites = this.sprites!;
    // The spikes turn slowly; the shape repeats every 1/8 turn.
    const turn = ((now / 2000) % MINE_SYMMETRY) / MINE_SYMMETRY;
    const frame = Math.floor(turn * MINE_TURN_FRAMES) % MINE_TURN_FRAMES;
    // Safe toggle mines, all in one path.
    ctx.beginPath();
    for (const m of mines) {
      if (m.state !== MineState.Safe || !this.onScreen(m.x, m.y, 4)) continue;
      ctx.moveTo(m.x + 3.4, m.y);
      ctx.arc(m.x, m.y, 3.4, 0, Math.PI * 2);
    }
    ctx.strokeStyle = COLORS.mineGlow;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    for (const m of mines) {
      if (m.state === MineState.Safe || !this.onScreen(m.x, m.y, MINE_SPRITE_R)) continue;
      const armed = m.state === MineState.Armed;
      const look = armed ? sprites.armed : sprites.arming;
      ctx.globalAlpha = armed ? 0.3 * pulse : 0.4;
      look.glow.stamp(ctx, m.x, m.y);
      ctx.globalAlpha = 1;
      look.body[frame].stamp(ctx, m.x, m.y);
      ctx.globalAlpha = armed ? pulse : 1;
      look.core.stamp(ctx, m.x, m.y);
    }
    ctx.globalAlpha = 1;
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

  /**
   * Bursts of light: gold pickups (a ring and four glints, plus the time
   * they added), the key, the exit (big rings) and mine blasts.
   */
  private drawSparkles(ctx: CanvasRenderingContext2D, sparkles: readonly Sparkle[]): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const s of sparkles) {
      const t = Math.min(1, s.age / SPARKLE_FRAMES);
      const ease = 1 - (1 - t) * (1 - t);
      if (s.kind === 'blast') {
        radialGlow(ctx, s.x, s.y, 8 + ease * 26, COLORS.blast, 0.9 * (1 - t));
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = COLORS.mineArming;
        ctx.lineWidth = 1.5 * (1 - t) + 0.3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5 + ease * 22, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.kind === 'exit') {
        const te = s.age / sparkleLife(s);
        const e = 1 - (1 - te) * (1 - te);
        radialGlow(ctx, s.x, s.y, 20 + e * 50, COLORS.doorGlow, 0.6 * (1 - te));
        ctx.globalAlpha = 1 - te;
        ctx.strokeStyle = COLORS.doorGlow;
        for (let i = 0; i < 2; i++) {
          ctx.lineWidth = 2.5 * (1 - te) + 0.4;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 10 + e * (40 + i * 25), 0, Math.PI * 2);
          ctx.stroke();
        }
        glints(ctx, s.x, s.y, 8, 12 + e * 40, 2.2 * (1 - te) + 0.5, COLORS.doorOpen);
      } else {
        // Gold or key.
        const key = s.kind === 'key';
        const color = key ? COLORS.key : COLORS.gold;
        radialGlow(ctx, s.x, s.y, 6 + ease * (key ? 22 : 14), color, 0.5 * (1 - t));
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2 * (1 - t) + 0.3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4 + ease * (key ? 18 : 9), 0, Math.PI * 2);
        ctx.stroke();
        if (t < 1) glints(ctx, s.x, s.y, 4, 3 + ease * (key ? 20 : 13), 1.6 * (1 - t) + 0.4, key ? COLORS.keyLight : COLORS.goldLight);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const s of sparkles) {
      if (!s.label) continue;
      const tl = s.age / sparkleLife(s);
      ctx.globalAlpha = Math.min(1, 3 * (1 - tl));
      const ly = s.y - 9 - (1 - (1 - tl) * (1 - tl)) * 14;
      this.sprites!.label(s.label).stamp(ctx, s.x, ly);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The ninja: a dark silhouette with a cool rim light, and a hot-pink neon
   * headband whose tails stream behind.
   */
  private drawNinja(ctx: CanvasRenderingContext2D, n: NinjaView): void {
    // The tails are simulated in world space.
    const scarf = n.scarf;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (scarf.length > 1) {
      ctx.beginPath();
      ctx.moveTo(scarf[0][0], scarf[0][1]);
      for (let i = 1; i < scarf.length; i++) ctx.lineTo(scarf[i][0], scarf[i][1]);
      this.glow(COLORS.scarf, 5);
      ctx.strokeStyle = COLORS.scarf;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this.noGlow();
      ctx.strokeStyle = COLORS.scarfCore;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(n.tilt);
    ctx.scale(n.facing, 1);
    const p = n.pose;
    this.glow(COLORS.ninjaGlow, 3);
    ctx.strokeStyle = COLORS.ninja;
    ctx.fillStyle = COLORS.ninja;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    polyline(ctx, [p.footA, p.kneeA, p.hip, p.kneeB, p.footB]);
    polyline(ctx, [p.hip, p.neck]);
    polyline(ctx, [p.handA, p.elbowA, p.neck, p.elbowB, p.handB]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.head[0], p.head[1], 3.1, 0, Math.PI * 2);
    ctx.fill();
    // The headband, round the forehead.
    const [hx, hy] = p.head;
    ctx.beginPath();
    ctx.moveTo(hx - 3.2, hy - 0.5);
    ctx.lineTo(hx + 3.2, hy - 1.3);
    this.glow(COLORS.scarf, 4);
    ctx.strokeStyle = COLORS.scarf;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    this.noGlow();
    ctx.strokeStyle = COLORS.scarfCore;
    ctx.lineWidth = 0.45;
    ctx.stroke();
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

/** Rows of tiles per band of platform paths. */
const CHUNK_ROWS = 6;
/** Window lights inside platforms (dim, translucent). */
const WINDOW_LIGHTS = ['rgba(255, 191, 110, 0.26)', 'rgba(143, 216, 255, 0.24)', 'rgba(255, 143, 216, 0.24)', 'rgba(180, 168, 255, 0.26)'];

/** Platform paths for a band of rows (world px y0 to y1). */
interface Chunk {
  y0: number;
  y1: number;
  solid: Path2D;
  outline: Path2D;
  seams: Path2D;
  /** One path per colour in WINDOW_LIGHTS. */
  windows: Path2D[];
  /** Drips running down greased blocks. */
  drips: Path2D;
  /** The greased walls (drawn in their own colour instead of in `outline`). */
  greaseOutline: Path2D;
}

/** A soft round glow (drawn with a radial gradient: cheaper than a shadow blur). */
function radialGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  if (alpha <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'transparent');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

/** Little diamond glints in a ring. */
function glints(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, dist: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = Math.PI / 4 + (i * Math.PI * 2) / count;
    const gx = x + Math.cos(a) * dist;
    const gy = y + Math.sin(a) * dist;
    ctx.beginPath();
    ctx.moveTo(gx, gy - r * 1.6);
    ctx.lineTo(gx + r, gy);
    ctx.lineTo(gx, gy + r * 1.6);
    ctx.lineTo(gx - r, gy);
    ctx.closePath();
    ctx.fill();
  }
}

/** Clamp a camera centre on one axis; `before` is extra world space allowed beyond the start (under the HUD). */
function clampAxis(c: number, view: number, size: number, before = 0): number {
  const inset = TILE_SIZE - BORDER_VISIBLE;
  if (view >= size - 2 * inset + before) return size / 2 - before / 2;
  return Math.min(Math.max(c, inset - before + view / 2), size - inset - view / 2);
}

/** Mines have eight spikes, so they look the same every 1/8 turn. */
const MINE_SYMMETRY = Math.PI / 4;
/** Pictures of a mine turning through that 1/8 turn. */
const MINE_TURN_FRAMES = 24;
/** Reach of a mine's glow (world px). */
const MINE_SPRITE_R = 12;

/** A small picture, drawn once at a given resolution, then stamped wherever it's needed. */
class Sprite {
  private readonly canvas: HTMLCanvasElement;

  /**
   * `r`: how far the picture reaches from its centre, in world px.
   * `paint` draws it in world px around (0, 0).
   */
  constructor(readonly r: number, pxPerUnit: number, paint: (g: CanvasRenderingContext2D, pxPerUnit: number) => void) {
    const size = Math.ceil(2 * r * pxPerUnit);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    const g = this.canvas.getContext('2d')!;
    g.setTransform(pxPerUnit, 0, 0, pxPerUnit, size / 2, size / 2);
    paint(g, pxPerUnit);
  }

  /** Draw centred at (x, y) in world px (under the world transform). */
  stamp(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.drawImage(this.canvas, x - this.r, y - this.r, 2 * this.r, 2 * this.r);
  }
}

/**
 * Gold and mines, pre-drawn. Drawing them directly costs a gradient and a
 * shadow blur (which is slow) each, every frame; with these, each is one or
 * a few image copies, whatever the number on screen. They are redrawn when
 * the resolution (zoom times device pixels) changes.
 */
class EntitySprites {
  readonly gold: Sprite;
  readonly armed: MineLook;
  readonly arming: MineLook;
  private readonly labels = new Map<string, Sprite>();

  constructor(readonly pxPerUnit: number) {
    // Gold: a glow, a tinted square with a neon edge, and a bright centre (the
    // whole picture shimmers, by its opacity).
    this.gold = new Sprite(12, pxPerUnit, (g, k) => {
      const h = 4.5;
      radialGlow(g, 0, 0, 11, COLORS.gold, 0.22);
      g.fillStyle = 'rgba(255, 210, 63, 0.2)';
      g.fillRect(-h, -h, h * 2, h * 2);
      g.shadowColor = COLORS.gold;
      g.shadowBlur = 3.5 * k;
      g.strokeStyle = COLORS.gold;
      g.lineWidth = 1.2;
      g.strokeRect(-h, -h, h * 2, h * 2);
      g.shadowBlur = 0;
      g.fillStyle = COLORS.goldLight;
      g.fillRect(-1.4, -1.4, 2.8, 2.8);
    });
    this.armed = mineLook(pxPerUnit, COLORS.mineGlow, COLORS.mineCore);
    this.arming = mineLook(pxPerUnit, COLORS.mineArming, COLORS.mineArming);
  }

  /** A glowing text label, like the time a piece of gold adds. */
  label(text: string): Sprite {
    let sprite = this.labels.get(text);
    if (!sprite) {
      const font = '700 8px system-ui, -apple-system, sans-serif';
      const measure = document.createElement('canvas').getContext('2d')!;
      measure.font = font;
      sprite = new Sprite(measure.measureText(text).width / 2 + 5, this.pxPerUnit, (g, k) => {
        g.font = font;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = COLORS.gold;
        g.shadowBlur = 3 * k;
        g.fillStyle = COLORS.goldLight;
        g.fillText(text, 0, 0);
      });
      this.labels.set(text, sprite);
    }
    return sprite;
  }
}

/** An armed (or arming) mine: its glow, its spiky body at each angle, and its core, drawn with separate opacities. */
interface MineLook {
  glow: Sprite;
  body: Sprite[];
  core: Sprite;
}

function mineLook(pxPerUnit: number, color: string, coreColor: string): MineLook {
  const glow = new Sprite(MINE_SPRITE_R, pxPerUnit, (g) => radialGlow(g, 0, 0, MINE_SPRITE_R, color, 1));
  const body = Array.from({ length: MINE_TURN_FRAMES }, (_, f) =>
    new Sprite(MINE_SPRITE_R, pxPerUnit, (g, k) => {
      const turn = (f / MINE_TURN_FRAMES) * MINE_SYMMETRY;
      const spikes = 8;
      g.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i * Math.PI) / spikes + turn;
        const r = i % 2 ? 3 : 5.6;
        if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fillStyle = COLORS.mine;
      g.fill();
      g.shadowColor = color;
      g.shadowBlur = 3 * k;
      g.strokeStyle = color;
      g.lineWidth = 0.8;
      g.stroke();
    }),
  );
  const core = new Sprite(6, pxPerUnit, (g, k) => {
    g.shadowColor = color;
    g.shadowBlur = 3 * k;
    g.fillStyle = coreColor;
    g.beginPath();
    g.arc(0, 0, 1.7, 0, Math.PI * 2);
    g.fill();
  });
  return { glow, body, core };
}
