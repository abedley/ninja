/**
 * The backdrop: a midnight city behind the level, in parallax. A night sky
 * with a moon and stars sits behind three skyline layers, far to near. Each
 * layer scrolls with a fraction of the camera's motion, so as the ninja climbs
 * the city sinks away below.
 *
 * Each layer is generated once (from a fixed seed) into an offscreen canvas
 * that tiles horizontally. Below the rooftops the buildings carry on down the
 * screen as a repeating band, so the canvases only hold the tops.
 *
 * The backdrop is soft (like a camera focused on the ninja), so it's drawn at
 * one pixel per CSS px into a buffer, then scaled up to the screen: on a
 * high-density phone that's a fraction of the pixels.
 */

/** Width of one horizontal repeat of a skyline layer (CSS px). */
const TILE_W = 540;

interface LayerSpec {
  /** Fraction of the camera's vertical motion the layer moves by (far layers move least). */
  factor: number;
  /** The same, horizontally. */
  xFactor: number;
  /** Where the layer's base (the bottom of its rooftop canvas) sits at the bottom of a level, as a fraction of screen height. */
  anchor: number;
  /** Building heights above the base, and widths (CSS px). */
  minH: number;
  maxH: number;
  minW: number;
  maxW: number;
  body: string;
  /** Rooftop rim highlight. */
  rim: string;
  window: { w: number; h: number; col: number; row: number; lit: number; alpha: number };
  /** Neon signs per tile, and rooftop neon strips (chance per building). */
  signs: number;
  roofNeon: number;
  /** Blinking red lights on antennas. */
  beacons: boolean;
  /** Haze colour drawn over the bottom of the layer, for depth. */
  haze: string;
}

const LAYERS: LayerSpec[] = [
  {
    factor: 0.06, xFactor: 0.04, anchor: 0.8, minH: 110, maxH: 330, minW: 22, maxW: 62,
    body: '#1b1440', rim: '#3b2c78',
    window: { w: 2, h: 2, col: 5, row: 7, lit: 0.22, alpha: 0.55 },
    signs: 0, roofNeon: 0, beacons: true, haze: 'rgba(120, 40, 150, 0.55)',
  },
  {
    factor: 0.13, xFactor: 0.1, anchor: 0.93, minH: 200, maxH: 520, minW: 34, maxW: 84,
    body: '#130d2e', rim: '#2c2160',
    window: { w: 3, h: 4, col: 7, row: 9, lit: 0.26, alpha: 0.6 },
    signs: 3, roofNeon: 0.15, beacons: true, haze: 'rgba(90, 25, 120, 0.5)',
  },
  {
    factor: 0.26, xFactor: 0.2, anchor: 1.03, minH: 300, maxH: 800, minW: 60, maxW: 130,
    body: '#09061a', rim: '#221846',
    window: { w: 4, h: 6, col: 10, row: 13, lit: 0.3, alpha: 0.38 },
    signs: 5, roofNeon: 0.3, beacons: false, haze: 'rgba(60, 15, 90, 0.45)',
  },
];

const WINDOW_COLORS = ['#ffbf6e', '#ffd9a0', '#8fd8ff', '#b4a8ff', '#ff8fd8'];
const NEON_COLORS = ['#ff2bd6', '#3ef0ff', '#ff3d6e', '#b36bff', '#ffb52e', '#7cff6b'];

interface Beacon {
  x: number;
  y: number;
  phase: number;
}

interface Layer {
  spec: LayerSpec;
  canvas: HTMLCanvasElement;
  /** Height of the rooftop canvas, and of the repeating band at its bottom (CSS px). */
  height: number;
  band: number;
  beacons: Beacon[];
}

interface Star {
  u: number;
  v: number;
  r: number;
  phase: number;
}

/** Pixels per CSS px of the backdrop. */
const RES = 1;

export class Cityscape {
  private layers: Layer[] = [];
  private stars: Star[] = [];
  private readonly buffer = document.createElement('canvas');
  private readonly bctx = this.buffer.getContext('2d', { alpha: false })!;

  constructor() {
    const rng = mulberry32(0x6e696e6a);
    this.layers = LAYERS.map((spec) => renderLayer(spec, rng, RES));
    this.stars = Array.from({ length: 140 }, () => ({ u: rng(), v: rng() * 0.9, r: 0.4 + rng() * rng() * 1.3, phase: rng() * 6.28 }));
  }

  /**
   * Draw over the whole screen. `ctx` is in CSS px; `w` and `h` are the
   * screen size. `climb` is how far (CSS px) the camera is above the bottom
   * of the level; `camX` its horizontal position (CSS px).
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, climb: number, camX: number, now: number): void {
    const bw = Math.ceil(w * RES);
    const bh = Math.ceil(h * RES);
    if (this.buffer.width !== bw || this.buffer.height !== bh) {
      this.buffer.width = bw;
      this.buffer.height = bh;
    }
    this.bctx.setTransform(RES, 0, 0, RES, 0, 0);
    this.paint(this.bctx, w, h, climb, camX, now);
    ctx.drawImage(this.buffer, 0, 0, w, h);
  }

  private paint(ctx: CanvasRenderingContext2D, w: number, h: number, climb: number, camX: number, now: number): void {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#03020b');
    sky.addColorStop(0.5, '#0f0928');
    sky.addColorStop(0.85, '#2a0d45');
    sky.addColorStop(1, '#3d1053');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Stars barely move; they twinkle.
    const starShift = climb * 0.015;
    ctx.fillStyle = '#e9e4ff';
    for (const s of this.stars) {
      const y = mod(s.v * h * 1.1 + starShift, h * 1.1);
      if (y > h) continue;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(now / 900 + s.phase) ** 2;
      ctx.fillRect(mod(s.u * w - camX * 0.01, w), y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // The moon, with a soft halo.
    const mx = w * 0.74 - camX * 0.02;
    const my = h * 0.17 + climb * 0.03;
    const halo = ctx.createRadialGradient(mx, my, 10, mx, my, 120);
    halo.addColorStop(0, 'rgba(210, 190, 255, 0.35)');
    halo.addColorStop(1, 'rgba(210, 190, 255, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - 120, my - 120, 240, 240);
    const face = ctx.createRadialGradient(mx - 6, my - 6, 2, mx, my, 24);
    face.addColorStop(0, '#fbf7ff');
    face.addColorStop(1, '#cfc2f0');
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(mx, my, 22, 0, Math.PI * 2);
    ctx.fill();

    for (const layer of this.layers) this.drawLayer(ctx, layer, w, h, climb, camX, now);
  }

  private drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, w: number, h: number, climb: number, camX: number, now: number): void {
    const { spec, canvas, height, band } = layer;
    const base = h * spec.anchor + climb * spec.factor;
    const top = base - height;
    if (top > h) return;
    const res = RES;
    const x0 = -mod(camX * spec.xFactor, TILE_W);
    for (let x = x0; x < w; x += TILE_W) {
      ctx.drawImage(canvas, x, top, TILE_W, height);
      // The buildings carry on down, as a repeating band.
      for (let y = base; y < h; y += band) {
        ctx.drawImage(canvas, 0, (height - band) * res, TILE_W * res, band * res, x, y, TILE_W, band);
      }
      for (const b of layer.beacons) {
        const on = Math.sin(now / 600 + b.phase) > 0.55;
        if (!on) continue;
        for (const bx of [x + b.x, x + b.x - TILE_W]) {
          const by = top + b.y;
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, 5);
          g.addColorStop(0, 'rgba(255, 70, 90, 0.95)');
          g.addColorStop(1, 'rgba(255, 70, 90, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(bx - 5, by - 5, 10, 10);
        }
      }
    }
    // Haze over the lower part of the layer, so it separates from the next one.
    const hazeTop = base - height * 0.45;
    const haze = ctx.createLinearGradient(0, hazeTop, 0, base + 160);
    haze.addColorStop(0, 'rgba(0, 0, 0, 0)');
    haze.addColorStop(1, spec.haze);
    ctx.fillStyle = haze;
    ctx.fillRect(0, hazeTop, w, h - hazeTop);
  }
}

/** Room above the tallest building for set-backs and antennas (CSS px). */
const HEADROOM = 70;

function renderLayer(spec: LayerSpec, rng: () => number, res: number): Layer {
  const height = spec.maxH + HEADROOM;
  const win = spec.window;
  // The repeating band at the bottom must be inside every building and a whole number of window rows.
  const band = win.row * Math.floor((spec.minH - 30) / win.row);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(TILE_W * res);
  canvas.height = Math.ceil(height * res);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(res, res);

  const buildings: { x: number; w: number; h: number; seed: number }[] = [];
  for (let x = rng() * 10; x < TILE_W; ) {
    const w = spec.minW + rng() * (spec.maxW - spec.minW);
    // Mostly mid-height, with the odd tower.
    const t = rng() < 0.15 ? 0.75 + rng() * 0.25 : rng() * 0.7;
    buildings.push({ x, w, h: spec.minH + t * (spec.maxH - spec.minH), seed: Math.floor(rng() * 2 ** 31) });
    x += w + (rng() < 0.4 ? rng() * 8 : 0);
  }
  // Neon signs on a few buildings, picked at random.
  const signs = new Set<number>();
  for (let i = 0; i < spec.signs; i++) signs.add(Math.floor(rng() * buildings.length));
  const beacons: Beacon[] = [];
  buildings.forEach((b, i) => {
    // Buildings that run past the right edge also draw at the left, so the tile wraps.
    for (const ox of [0, -TILE_W]) {
      if (b.x + ox + b.w < 0) continue;
      // Each copy replays the same random choices.
      drawBuilding(ctx, spec, b.x + ox, b.w, height - b.h, height, band, mulberry32(b.seed), signs.has(i), ox === 0 ? beacons : null);
    }
  });
  return { spec, canvas, height, band, beacons };
}

function drawBuilding(
  ctx: CanvasRenderingContext2D, spec: LayerSpec, x: number, w: number, roof: number, height: number, band: number,
  r: () => number, sign: boolean, beacons: Beacon[] | null,
): void {
  const win = spec.window;
  ctx.fillStyle = spec.body;
  ctx.fillRect(x, roof, w, height - roof);
  // A set-back storey or two on some roofs, and antennas.
  let top = roof;
  if (r() < 0.45) {
    const sw = w * (0.4 + r() * 0.4);
    const sh = 8 + r() * 26;
    ctx.fillRect(x + (w - sw) / 2, roof - sh, sw, sh);
    top = roof - sh;
  }
  if (r() < 0.4) {
    const ax = x + w * (0.3 + r() * 0.4);
    const ah = 10 + r() * 30;
    ctx.fillRect(ax - 0.75, top - ah, 1.5, ah);
    beacons?.push({ x: ax, y: top - ah, phase: r() * 6.28 });
  }
  ctx.fillStyle = spec.rim;
  ctx.fillRect(x, roof, w, 1);

  // Windows, in rows counted up from the bottom so the band at the bottom repeats.
  const cols = Math.max(1, Math.floor((w - 4) / win.col));
  const margin = (w - cols * win.col) / 2 + (win.col - win.w) / 2;
  const litFloor = r() * 0.6;
  const color = WINDOW_COLORS[Math.floor(r() * WINDOW_COLORS.length)];
  for (let y = height - win.row; y > roof + 5; y -= win.row) {
    // Some floors are mostly lit, most mostly dark.
    const floorLit = r() < litFloor ? 0.7 : win.lit * 0.6;
    for (let c = 0; c < cols; c++) {
      const lit = r() < floorLit;
      ctx.fillStyle = lit ? (r() < 0.85 ? color : WINDOW_COLORS[Math.floor(r() * WINDOW_COLORS.length)]) : '#ffffff';
      ctx.globalAlpha = lit ? win.alpha * (0.5 + r() * 0.5) : 0.035;
      ctx.fillRect(x + margin + c * win.col, y, win.w, win.h);
    }
  }
  ctx.globalAlpha = 1;

  // Neon: a glowing strip along the roof, or a vertical sign on the face (kept above the repeating band).
  const neon = NEON_COLORS[Math.floor(r() * NEON_COLORS.length)];
  ctx.shadowColor = neon;
  if (r() < spec.roofNeon) {
    ctx.shadowBlur = 8;
    ctx.fillStyle = neon;
    ctx.fillRect(x + 1, roof + 1, w - 2, 1.5);
  }
  if (sign) {
    const sw = 5 + r() * 5;
    const sh = 26 + r() * 50;
    const sx = x + (r() < 0.5 ? 4 : w - sw - 4);
    const sy = roof + 10 + r() * Math.max(0, height - band - roof - sh - 20);
    if (sy + sh < height - band) {
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#05030c';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = neon;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(sx, sy, sw, sh);
      // Glyph-like bars inside.
      ctx.fillStyle = neon;
      for (let gy = sy + 4; gy < sy + sh - 4; gy += 6 + r() * 4) ctx.fillRect(sx + 1.8, gy, sw - 3.6, 1.6 + r() * 1.5);
    }
  }
  ctx.shadowBlur = 0;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** A small seeded random number generator, so the city is the same every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
