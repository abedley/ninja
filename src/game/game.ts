import { parseLevel, type Level, type LevelDef } from '../level/level';
import { NINJA, NinjaState } from '../physics/ninja';
import { Simulator, TICK_RATE } from '../physics/simulator';
import { AnimState, NinjaAnimator, type P, type Pose } from './animator';
import { Debris } from './debris';
import type { Input } from './input';
import { poseToWorld, type Renderer } from './renderer';
import { SPARKLE_FRAMES, type Sparkle } from './sparkles';

const STEP_MS = 1000 / TICK_RATE;
/** Don't try to catch up more than this many frames after a stall. */
const MAX_STEPS_PER_FRAME = 5;
/** Frames after death before a jump press restarts. */
const RESTART_DELAY = 20;
const SCARF_LINKS = 5;
const SCARF_LINK_LEN = 2.6;

const STATE_NAMES = ['Immobile', 'Running', 'Sliding', 'Jumping', 'Falling', 'WallSliding', 'Dead', 'Dying', 'Celebrating', 'Disabled'];

export class Game {
  private level!: Level;
  private sim!: Simulator;
  private readonly animator = new NinjaAnimator();
  private debris: Debris | null = null;
  private deadFrames = 0;
  private jumpWasHeld = false;
  private scarf: P[] = [];
  private scarfOld: P[] = [];
  private sparkles: Sparkle[] = [];
  // Previous-frame position for render interpolation.
  private prevX = 0;
  private prevY = 0;

  private accumulator = 0;
  private lastTime = -1;
  private running = false;
  debug = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly levelDef: LevelDef,
  ) {
    this.loadLevel(levelDef);
  }

  loadLevel(def: LevelDef): void {
    this.level = parseLevel(def);
    this.renderer.setMap(this.level.map);
    this.restart();
  }

  restart(): void {
    this.respawnAt(this.level.spawnX, this.level.spawnY);
  }

  /** Debug helper: drop a fresh ninja at a screen position (CSS px). */
  teleportToScreen(sx: number, sy: number): void {
    const r = this.renderer;
    this.respawnAt((sx - r.offsetX) / r.scale, (sy - r.offsetY) / r.scale);
  }

  private respawnAt(x: number, y: number): void {
    this.sim = new Simulator(this.level.map, x, y, this.level.gold);
    this.sparkles = [];
    this.animator.reset();
    this.debris = null;
    this.deadFrames = 0;
    this.prevX = x;
    this.prevY = y;
    const knot = this.scarfAnchor();
    this.scarf = Array.from({ length: SCARF_LINKS }, (_, i): P => [knot[0] - i * SCARF_LINK_LEN, knot[1]]);
    this.scarfOld = this.scarf.map((p): P => [p[0], p[1]]);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    if (this.lastTime < 0) this.lastTime = now;
    this.accumulator += Math.min(now - this.lastTime, STEP_MS * MAX_STEPS_PER_FRAME);
    this.lastTime = now;
    while (this.accumulator >= STEP_MS) {
      this.step();
      this.accumulator -= STEP_MS;
    }
    this.render(this.accumulator / STEP_MS);
    requestAnimationFrame(this.frame);
  };

  /** One fixed 60 Hz tick. */
  private step(): void {
    const ninja = this.sim.ninja;
    const hor = this.input.hor;
    const jump = this.input.takeJump();
    this.stepSparkles();

    if (ninja.state === NinjaState.Dead) {
      this.deadFrames++;
      this.debris?.step();
      if (jump && !this.jumpWasHeld && this.deadFrames > RESTART_DELAY) this.restart();
      this.jumpWasHeld = jump;
      return;
    }
    this.jumpWasHeld = jump;

    this.prevX = ninja.xpos;
    this.prevY = ninja.ypos;
    this.sim.tick(hor, jump);
    this.animator.update(ninja);
    this.stepScarf();
    for (const g of this.sim.goldThisTick) this.sparkles.push({ x: g.x, y: g.y, age: 0 });

    // (Re-read the state: tick() may have changed it.)
    if (this.isDead) this.explode();
  }

  private scarfAnchor(): P {
    const a = this.animator;
    const n = this.sim.ninja;
    const pose = a.pose(this.skidAmount());
    // The knot sits at the back of the head.
    return poseToWorld([pose.head[0] - 2.4, pose.head[1] - 0.6], n.xpos, n.ypos, a.tilt, a.facing);
  }

  private skidAmount(): number {
    const n = this.sim.ninja;
    return Math.min(1, Math.abs(n.xspeed) / 1.5);
  }

  /** A little verlet rope trailing from the head, so motion reads clearly at small sizes. */
  private stepScarf(): void {
    const anchor = this.scarfAnchor();
    const s = this.scarf;
    const old = this.scarfOld;
    for (let i = 1; i < s.length; i++) {
      const vx = (s[i][0] - old[i][0]) * 0.9;
      const vy = (s[i][1] - old[i][1]) * 0.9;
      old[i][0] = s[i][0];
      old[i][1] = s[i][1];
      s[i][0] += vx - this.animator.facing * 0.02;
      s[i][1] += vy + 0.04;
    }
    s[0][0] = old[0][0] = anchor[0];
    s[0][1] = old[0][1] = anchor[1];
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 1; i < s.length; i++) {
        const dx = s[i][0] - s[i - 1][0];
        const dy = s[i][1] - s[i - 1][1];
        const d = Math.hypot(dx, dy) || 1;
        const k = (d - SCARF_LINK_LEN) / d;
        s[i][0] -= dx * k;
        s[i][1] -= dy * k;
      }
    }
  }

  private stepSparkles(): void {
    if (!this.sparkles.length) return;
    for (const s of this.sparkles) s.age++;
    this.sparkles = this.sparkles.filter((s) => s.age < SPARKLE_FRAMES);
  }

  private explode(): void {
    const n = this.sim.ninja;
    const a = this.animator;
    const w = (p: P) => poseToWorld(p, n.xpos, n.ypos, a.tilt, a.facing);
    const p = a.pose(this.skidAmount());
    const bones: [P, P][] = [
      [p.hip, p.neck], [p.hip, p.kneeA], [p.kneeA, p.footA], [p.hip, p.kneeB], [p.kneeB, p.footB],
      [p.neck, p.elbowA], [p.elbowA, p.handA], [p.neck, p.elbowB], [p.elbowB, p.handB],
    ].map(([from, to]): [P, P] => [w(from), w(to)]);
    const d = n.death ?? { xspeed: n.xspeed * 0.5, yspeed: n.yspeed * 0.5 };
    this.debris = Debris.explode(this.level.map, bones, w(p.head), d.xspeed, d.yspeed);
  }

  private render(alpha: number): void {
    const n = this.sim.ninja;
    const alive = n.state !== NinjaState.Dead;
    const x = this.prevX + (n.xpos - this.prevX) * alpha;
    const y = this.prevY + (n.ypos - this.prevY) * alpha;
    const pose: Pose = this.animator.pose(this.skidAmount());
    this.renderer.draw(
      this.sim.gold,
      this.sparkles,
      alive ? { x, y, tilt: this.animator.tilt, facing: this.animator.facing, pose, scarf: this.scarf } : null,
      this.debris,
      this.debug ? this.debugLines() : null,
      this.debug && alive ? { x, y, r: NINJA.RADIUS } : null,
    );
  }

  private debugLines(): string[] {
    const n = this.sim.ninja;
    const lines = [
      `frame   ${this.sim.frame}`,
      `state   ${STATE_NAMES[n.state]} (${n.state})`,
      `pos     ${n.xpos.toFixed(2)}, ${n.ypos.toFixed(2)}`,
      `speed   ${n.xspeed.toFixed(3)}, ${n.yspeed.toFixed(3)}`,
      `ground  ${n.airborn ? 'no' : `yes  n=(${n.floorNormalizedX.toFixed(2)}, ${n.floorNormalizedY.toFixed(2)})`}`,
      `wall    ${n.walled ? `yes  n=${n.wallNormal.toFixed(0)}` : 'no'}`,
      `input   ${this.input.hor} ${n.jumpInput ? 'jump' : ''}`,
      `gold    ${this.goldCollected}/${this.goldTotal}`,
    ];
    if (this.animator.state === AnimState.Run) lines.push(`run     ${this.animator.runCycle}`);
    return lines;
  }

  get isDead(): boolean {
    return this.sim.ninja.state === NinjaState.Dead;
  }

  get goldCollected(): number {
    return this.sim.goldCollected;
  }

  get goldTotal(): number {
    return this.sim.gold.length;
  }

  get levelName(): string {
    return this.levelDef.name;
  }
}
