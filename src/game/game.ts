import { parseLevel, type Level, type LevelDef } from '../level/level';
import { NINJA, NinjaState } from '../physics/ninja';
import { GOLD_TIME_BONUS, Simulator, TICK_RATE } from '../physics/simulator';
import { AnimState, NinjaAnimator, type P, type Pose } from './animator';
import { AutoRunner } from './autoRunner';
import { Debris } from './debris';
import type { Input } from './input';
import { poseToWorld, type Camera, type Renderer } from './renderer';
import { sparkleLife, type Sparkle } from './sparkles';

const STEP_MS = 1000 / TICK_RATE;
/** Don't try to catch up more than this many frames after a stall. */
const MAX_STEPS_PER_FRAME = 5;
/** Frames after death (or reaching the exit) before a jump press restarts. */
const RESTART_DELAY = 20;
/** After reaching the exit, the restart waits a little longer so the moment isn't skipped by accident. */
const WIN_RESTART_DELAY = 45;
const SCARF_LINKS = 5;
const SCARF_LINK_LEN = 2.6;
/** The camera leads the ninja by this much (px) in the running direction... */
const CAMERA_LEAD_X = 28;
/** ...and looks a little upwards, since levels are climbed. */
const CAMERA_LEAD_Y = -40;
/** Fraction of the remaining distance the camera covers each frame. */
const CAMERA_FOLLOW_X = 0.08;
const CAMERA_FOLLOW_Y = 0.12;

/** Where the player is in the start / play / retry cycle. */
export const enum Phase {
  /** At the spawn point, waiting for the first tap. */
  Ready,
  Playing,
  Dead,
  /** Reached the open exit door. */
  Won,
}

const STATE_NAMES = ['Immobile', 'Running', 'Sliding', 'Jumping', 'Falling', 'WallSliding', 'Dead', 'Dying', 'Celebrating', 'Disabled'];

export class Game {
  private def!: LevelDef;
  private level!: Level;
  /** Frames on the clock when the level starts (Infinity if it isn't timed). A death goes back to it. */
  private clock = Infinity;
  /** The simulator frame play started on (the first tap). */
  private startFrame = 0;
  /** Frames from the first tap to the door, once the exit is reached. */
  private clearedIn = 0;
  private sim!: Simulator;
  private readonly animator = new NinjaAnimator();
  private runner!: AutoRunner;
  private debris: Debris | null = null;
  /** Frames since dying or winning. */
  private endFrames = 0;
  private jumpWasHeld = false;
  /** Ignore jump until it is released (after the tap that started or restarted play). */
  private jumpNeedsRelease = false;
  phase = Phase.Ready;
  private scarf: P[] = [];
  private scarfOld: P[] = [];
  private sparkles: Sparkle[] = [];
  // Previous-frame position for render interpolation.
  private prevX = 0;
  private prevY = 0;
  private readonly cam: Camera = { x: 0, y: 0 };
  private readonly prevCam: Camera = { x: 0, y: 0 };

  private accumulator = 0;
  private lastTime = -1;
  private running = false;
  debug = false;
  /**
   * Called by a tap once the exit has been reached (instead of playing the
   * level again), e.g. to move on to the next level.
   */
  onContinue: (() => void) | null = null;

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    def: LevelDef,
    clock?: number,
  ) {
    this.loadLevel(def, clock);
  }

  /**
   * Load a level, waiting at the spawn point for a tap. `clock` is the time it
   * starts with, in frames (by default, the level's own time limit).
   */
  loadLevel(def: LevelDef, clock?: number): void {
    this.def = def;
    this.level = parseLevel(def);
    this.clock = clock ?? (this.level.time === undefined ? Infinity : this.level.time * TICK_RATE);
    this.renderer.setMap(this.level.map);
    this.restart();
  }

  /** Back to the spawn point, waiting for a tap to start. */
  restart(): void {
    this.respawnAt(this.level.spawnX, this.level.spawnY);
  }

  /** Debug helper: drop a fresh ninja at a screen position (CSS px), already running. */
  teleportToScreen(sx: number, sy: number): void {
    const [x, y] = this.renderer.screenToWorld(sx, sy);
    this.respawnAt(x, y);
    this.phase = Phase.Playing;
  }

  private respawnAt(x: number, y: number): void {
    this.sim = new Simulator(this.level.map, x, y, this.level);
    this.runner = new AutoRunner(this.sim.ninja, this.level.facing);
    this.phase = Phase.Ready;
    this.sparkles = [];
    this.animator.reset(this.level.facing);
    this.debris = null;
    this.endFrames = 0;
    this.prevX = x;
    this.prevY = y;
    this.snapCamera();
    const knot = this.scarfAnchor();
    this.scarf = Array.from({ length: SCARF_LINKS }, (_, i): P => [knot[0] - i * SCARF_LINK_LEN * this.level.facing, knot[1]]);
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
    const held = this.input.takeJump();
    const pressed = held && !this.jumpWasHeld;
    this.jumpWasHeld = held;
    this.stepSparkles();
    this.prevCam.x = this.cam.x;
    this.prevCam.y = this.cam.y;

    if (this.phase === Phase.Dead) {
      this.endFrames++;
      this.debris?.step();
      // A tap after death respawns and starts running straight away.
      if (pressed && this.endFrames > RESTART_DELAY) this.begin();
      return;
    }
    if (this.phase === Phase.Won) {
      this.endFrames++;
      if (pressed && this.endFrames > WIN_RESTART_DELAY) {
        if (this.onContinue) this.onContinue();
        else this.begin();
        return;
      }
    }
    if (this.phase === Phase.Ready && pressed) this.begin();

    // The tap that starts play isn't also a jump.
    if (this.jumpNeedsRelease && !held) this.jumpNeedsRelease = false;
    const jump = held && !this.jumpNeedsRelease;

    const ninja = this.sim.ninja;
    this.prevX = ninja.xpos;
    this.prevY = ninja.ypos;
    const key = this.sim.key;
    const keyWasThere = key?.active;
    if (this.phase === Phase.Playing) {
      this.sim.tick(...this.runner.control(ninja, jump));
      this.runner.update(ninja);
    } else if (this.phase !== Phase.Ready) {
      // Celebrating: the ninja carries on moving, without input.
      // (While waiting for the first tap, nothing moves: the ninja hangs at the spawn point.)
      this.sim.tick(0, false);
    }
    this.animator.update(ninja);
    this.followCamera();
    this.stepScarf();
    const label = this.timed ? `+${GOLD_TIME_BONUS / TICK_RATE}` : undefined;
    for (const g of this.sim.goldThisTick) this.sparkles.push({ x: g.x, y: g.y, age: 0, kind: 'gold', label });
    if (key && keyWasThere && !key.active) this.sparkles.push({ x: key.x, y: key.y, age: 0, kind: 'key' });
    for (const pad of this.sim.launchesThisTick) {
      // (A pad can fire on a few frames in a row: one burst is enough.)
      if (this.sparkles.some((s) => s.kind === 'launch' && s.x === pad.x && s.y === pad.y && s.age < 8)) continue;
      this.sparkles.push({ x: pad.x, y: pad.y, age: 0, kind: 'launch', dir: [pad.normalX, pad.normalY] });
    }

    if (this.phase === Phase.Playing && this.sim.won) {
      this.phase = Phase.Won;
      this.clearedIn = this.sim.frame - this.startFrame;
      const door = this.sim.door!;
      this.sparkles.push({ x: door.x, y: door.y, age: 0, kind: 'exit' });
    }
    // (Re-read the state: tick() may have changed it.)
    if (this.isDead) {
      this.phase = Phase.Dead;
      const mine = this.sim.killedBy;
      if (mine) this.sparkles.push({ x: mine.x, y: mine.y, age: 0, kind: 'blast' });
      this.explode();
    }
  }

  /** Start running (from the spawn point, respawning first after a death). */
  private begin(): void {
    if (this.phase === Phase.Dead || this.phase === Phase.Won) this.restart();
    this.phase = Phase.Playing;
    this.jumpNeedsRelease = true;
    // The clock starts with the first tap.
    if (this.timed) this.sim.timeLeft = this.clock;
    this.startFrame = this.sim.frame;
  }

  private cameraTarget(): Camera {
    const n = this.sim.ninja;
    const lead = this.phase === Phase.Playing ? this.runner.dir * CAMERA_LEAD_X : 0;
    const target = { x: n.xpos + lead, y: n.ypos + CAMERA_LEAD_Y };
    this.renderer.clampCamera(target);
    return target;
  }

  private followCamera(): void {
    const t = this.cameraTarget();
    this.cam.x += (t.x - this.cam.x) * CAMERA_FOLLOW_X;
    this.cam.y += (t.y - this.cam.y) * CAMERA_FOLLOW_Y;
  }

  /** Jump the camera straight to the ninja (on respawn or when the screen changes size). */
  snapCamera(): void {
    const t = this.cameraTarget();
    this.cam.x = this.prevCam.x = t.x;
    this.cam.y = this.prevCam.y = t.y;
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
    this.sparkles = this.sparkles.filter((s) => s.age < sparkleLife(s));
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
    const cam = {
      x: this.prevCam.x + (this.cam.x - this.prevCam.x) * alpha,
      y: this.prevCam.y + (this.cam.y - this.prevCam.y) * alpha,
    };
    this.renderer.draw(
      cam,
      this.sim.gold,
      this.sim.mines,
      this.sim.launchPads,
      { door: this.sim.door, key: this.sim.key },
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
      `input   ${n.horInput} ${n.jumpInput ? 'jump' : ''}`,
      `gold    ${this.goldCollected}/${this.goldTotal}`,
    ];
    if (this.sim.key) lines.push(`exit    ${this.sim.won ? 'reached' : this.sim.door!.open ? 'open' : 'shut'}`);
    if (this.timed) lines.push(`time    ${this.timeLeft.toFixed(2)} s`);
    if (this.animator.state === AnimState.Run) lines.push(`run     ${this.animator.runCycle}`);
    return lines;
  }

  get isDead(): boolean {
    return this.sim.ninja.state === NinjaState.Dead;
  }

  /** Whether the level has a clock. */
  get timed(): boolean {
    return this.clock !== Infinity;
  }

  /** Frames left on the clock (the starting time until the first tap). */
  get framesLeft(): number {
    const t = this.sim.timeLeft;
    return t === Infinity ? this.clock : t;
  }

  /** Seconds left on the clock (the starting time until the first tap). */
  get timeLeft(): number {
    return this.framesLeft / TICK_RATE;
  }

  /** The time the level starts with, in seconds. */
  get timeLimit(): number {
    return this.clock / TICK_RATE;
  }

  /** Frames from the first tap to the door, once the exit has been reached. */
  get clearFrames(): number {
    return this.clearedIn;
  }

  /** Whether the level has an exit door (and key). */
  get hasExit(): boolean {
    return this.sim.door !== null;
  }

  /** Whether the key has been collected (so the door is open). */
  get hasKey(): boolean {
    return this.sim.door?.open ?? false;
  }

  get timedOut(): boolean {
    return this.sim.timedOut;
  }

  get goldCollected(): number {
    return this.sim.goldCollected;
  }

  get goldTotal(): number {
    return this.sim.gold.length;
  }

  get levelDef(): LevelDef {
    return this.def;
  }
}
