/**
 * Sound effects, synthesised with the Web Audio API (there are no sound
 * files, and no music). Browsers only let a page start audio from a tap or a
 * key press, so the first one calls unlock().
 *
 * Each effect is a few short oscillator or noise notes with quick envelopes;
 * the slides (down a wall, or skidding along the floor) are one looping noise
 * whose loudness follows the ninja.
 */

const STORAGE_KEY = 'ninja.sound';

export type SlideKind = 'wall' | 'floor';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private slide: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  /** Gold picked up in a row (each within GOLD_STREAK_FRAMES of the last): 0 for the first. */
  private goldStreak = 0;
  private lastGoldFrame = -Infinity;
  /** Which foot stepped last. */
  private foot = 0;
  private _enabled: boolean;

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: sound stays on */
    }
    this._enabled = stored !== 'off';
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(on: boolean) {
    this._enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* not kept */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.02);
    if (on) this.unlock();
  }

  /** Create or wake the audio context. Call from a tap or key press (iOS insists). */
  unlock(): void {
    if (!this._enabled && !this.ctx) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 6;
      compressor.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this._enabled ? 0.7 : 0;
      this.master.connect(compressor);
      // A second of white noise, for hits, whooshes and slides.
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  /** Whether sounds can play now. */
  private get live(): boolean {
    return this._enabled && this.ctx !== null && this.ctx.state === 'running';
  }

  // ------------------------------------------------------------ the ninja

  jump(): void {
    this.tone({ type: 'square', from: 300, to: 620, dur: 0.1, gain: 0.07, jitter: 0.04 });
    this.noise({ freq: 1800, q: 0.8, dur: 0.05, gain: 0.05 });
  }

  wallJump(): void {
    this.noise({ freq: 1200, q: 1.5, dur: 0.04, gain: 0.12 });
    this.tone({ type: 'square', from: 420, to: 860, dur: 0.1, gain: 0.07, jitter: 0.04, delay: 0.01 });
  }

  /** Landing on a floor; `strength` 0-1 (1 is a fall that very nearly kills). */
  land(strength: number): void {
    const s = clamp01(strength);
    this.tone({ type: 'sine', from: 150, to: 50, dur: 0.12, gain: 0.12 + 0.3 * s });
    this.noise({ freq: 500 + 500 * s, q: 0.7, dur: 0.06 + 0.06 * s, gain: 0.06 + 0.14 * s, type: 'lowpass' });
  }

  /** Running into a wall; `strength` 0-1. */
  wallHit(strength: number): void {
    const s = clamp01(strength);
    this.tone({ type: 'sine', from: 190, to: 70, dur: 0.08, gain: 0.08 + 0.2 * s });
    this.noise({ freq: 900, q: 1, dur: 0.05, gain: 0.05 + 0.1 * s });
  }

  footstep(): void {
    // Alternate feet, a little apart in pitch.
    this.foot ^= 1;
    this.noise({ freq: this.foot ? 1500 : 1150, q: 2, dur: 0.035, gain: 0.07 });
  }

  /** The slide's loudness, every frame: 0-1 down a wall or skidding on a floor (0 for neither). */
  setSlide(level: number, kind: SlideKind = 'wall'): void {
    if (!this.ctx || !this.noiseBuffer || !this.master) return;
    if (!this.slide) {
      if (level <= 0) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.slide = { gain, filter };
    }
    const t = this.ctx.currentTime;
    this.slide.gain.gain.setTargetAtTime(this.live ? 0.09 * clamp01(level) : 0, t, 0.03);
    this.slide.filter.frequency.setTargetAtTime(kind === 'wall' ? 2400 + 1200 * clamp01(level) : 1100, t, 0.05);
  }

  // ------------------------------------------------------------ objects

  /**
   * A piece of gold, picked up on game frame `frame`. On its own it's a
   * two-note chime. Gold in a row (each piece within GOLD_STREAK_FRAMES of the
   * last, about a full jump) climbs a pentatonic scale, with a sparkle on top
   * that grows brighter, and every fifth in a row adds a little flourish.
   */
  gold(frame: number): void {
    const gap = frame - this.lastGoldFrame;
    // (Frames count from 0 again after a respawn, so a negative gap is a fresh start.)
    this.goldStreak = gap >= 0 && gap <= GOLD_STREAK_FRAMES ? this.goldStreak + 1 : 0;
    this.lastGoldFrame = frame;
    const n = this.goldStreak;
    const k = 2 ** (GOLD_SCALE[Math.min(n, GOLD_SCALE.length - 1)] / 12);
    this.tone({ type: 'square', from: 1319 * k, dur: 0.05, gain: 0.05 });
    this.tone({ type: 'square', from: 1760 * k, dur: n ? 0.16 : 0.12, gain: 0.05, delay: 0.05 });
    if (n === 0) return;
    // In a row: a fifth above, ringing on, louder the longer the run.
    this.tone({ type: 'triangle', from: 2637 * k, dur: 0.22, gain: 0.03 + 0.005 * Math.min(n, 6), delay: 0.09 });
    if (n % 5 === 4) {
      [2093, 2637, 3136, 4186].forEach((f, i) => this.tone({ type: 'triangle', from: f, dur: 0.1, gain: 0.05, delay: 0.16 + i * 0.045 }));
    }
  }

  /** Forget a run of gold (a new life or level starts one afresh). */
  resetGoldStreak(): void {
    this.goldStreak = 0;
    this.lastGoldFrame = -Infinity;
  }

  /** Toggle gold waking as the ninja touches it, and ready once it's gone by. */
  goldWake(ready: boolean): void {
    if (ready) this.tone({ type: 'triangle', from: 1175, to: 1760, dur: 0.12, gain: 0.07 });
    else this.tone({ type: 'triangle', from: 880, dur: 0.1, gain: 0.06 });
  }

  key(): void {
    [1047, 1319, 1568, 2093].forEach((f, i) => this.tone({ type: 'triangle', from: f, dur: 0.14, gain: 0.1, delay: i * 0.055 }));
  }

  launch(): void {
    this.noise({ freq: 500, to: 3200, q: 1.4, dur: 0.28, gain: 0.16 });
    this.tone({ type: 'sine', from: 180, to: 760, dur: 0.18, gain: 0.14 });
  }

  /** A toggle mine being touched (armed: the ninja has moved off, and it's live). */
  mine(armed: boolean): void {
    if (armed) this.tone({ type: 'square', from: 330, to: 300, dur: 0.09, gain: 0.06 });
    else this.tone({ type: 'square', from: 180, dur: 0.04, gain: 0.06 });
  }

  // ------------------------------------------------------------ the end of a life

  explosion(): void {
    this.noise({ freq: 2600, to: 160, q: 0.6, dur: 0.7, gain: 0.45, type: 'lowpass' });
    this.tone({ type: 'sine', from: 110, to: 32, dur: 0.45, gain: 0.35 });
  }

  /** Killed by a hard landing or a wall. */
  splat(): void {
    this.noise({ freq: 1400, to: 300, q: 0.8, dur: 0.3, gain: 0.3, type: 'lowpass' });
    this.tone({ type: 'sine', from: 160, to: 40, dur: 0.22, gain: 0.3 });
  }

  timeUp(): void {
    this.tone({ type: 'sawtooth', from: 440, to: 110, dur: 0.6, gain: 0.08 });
  }

  win(): void {
    [784, 1047, 1319, 1568].forEach((f, i) => this.tone({ type: 'triangle', from: f, dur: i === 3 ? 0.4 : 0.12, gain: 0.11, delay: i * 0.08 }));
    this.tone({ type: 'square', from: 2093, dur: 0.35, gain: 0.03, delay: 0.24 });
  }

  // ------------------------------------------------------------ building blocks

  /** An oscillator note, gliding from one pitch to another, with a quick attack and an exponential fade. */
  private tone(o: { type: OscillatorType; from: number; to?: number; dur: number; gain: number; delay?: number; jitter?: number }): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const k = 1 + (Math.random() * 2 - 1) * (o.jitter ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from * k, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to * k, t + o.dur);
    const env = this.envelope(t, o.dur, o.gain);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  /** A burst of filtered noise (the filter can sweep). */
  private noise(o: { freq: number; to?: number; q: number; dur: number; gain: number; delay?: number; type?: BiquadFilterType }): void {
    if (!this.live || !this.noiseBuffer) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? 'bandpass';
    filter.Q.value = o.q;
    filter.frequency.setValueAtTime(o.freq, t);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    src.connect(filter).connect(this.envelope(t, o.dur, o.gain));
    // Start somewhere random in the noise, so repeats don't sound identical.
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.02);
  }

  private envelope(t: number, dur: number, gain: number): GainNode {
    const env = this.ctx!.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(this.master!);
    return env;
  }
}

/** How long after one piece of gold the next still counts as in a row: 2 s, a little more than a full jump (about 112 frames). */
export const GOLD_STREAK_FRAMES = 120;
/** Semitones up the major pentatonic scale for each piece in a row (staying at the top after an octave). */
const GOLD_SCALE = [0, 2, 4, 7, 9, 12];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
