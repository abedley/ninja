import { NinjaState, type Ninja } from '../physics/ninja';

/**
 * Visual-only animation state for the ninja: facing, slope tilt, and a pose.
 * The state transitions follow N++'s update_graphics; the poses themselves
 * are procedural until we have real animation data.
 */
export const enum AnimState {
  Idle = 0,
  Run = 1,
  Skid = 2,
  Air = 3,
  WallSlide = 4,
  /** Reached the exit: arms up. */
  Celebrate = 5,
}

const RUN_CYCLE_LENGTH = 432;

export class NinjaAnimator {
  state = AnimState.Idle;
  facing = 1;
  tilt = 0;
  /** Position in the run cycle, 0..432. */
  runCycle = 0;
  private frameResidual = 0;
  /** Frames spent in the current state (drives idle settling, landing squash...). */
  stateFrames = 0;
  /** Vertical speed, used for the in-air pose. */
  airRate = 0;

  reset(): void {
    this.state = AnimState.Idle;
    this.facing = 1;
    this.tilt = 0;
    this.runCycle = 0;
    this.frameResidual = 0;
    this.stateFrames = 0;
  }

  /** Call once per simulation tick. */
  update(n: Ninja): void {
    const old = this.state;
    if (n.state === NinjaState.WallSliding) {
      this.state = AnimState.WallSlide;
      this.tilt = 0;
      this.facing = -n.wallNormal;
    } else if (!n.airborn && n.state !== NinjaState.Jumping) {
      this.tilt = Math.atan2(n.floorNormalizedY, n.floorNormalizedX) + Math.PI / 2;
      if (n.state === NinjaState.Immobile) this.state = AnimState.Idle;
      if (n.state === NinjaState.Running) {
        this.state = AnimState.Run;
        if (n.horInput) this.facing = n.horInput;
      }
      if (n.state === NinjaState.GroundSliding) this.state = AnimState.Skid;
      if (n.state === NinjaState.Celebrating) this.state = AnimState.Celebrate;
    } else {
      this.state = AnimState.Air;
      if (n.state === NinjaState.Jumping) this.tilt = 0;
      else this.tilt *= 0.9;
    }
    this.airRate = n.yspeed;
    if (n.state !== NinjaState.WallSliding && Math.abs(n.xspeed) > 0.01) {
      this.facing = n.xspeed > 0 ? 1 : -1;
    }

    if (this.state !== old) {
      this.stateFrames = 0;
      if (this.state === AnimState.Run) {
        // Start mid-stride when coming out of a skid or a landing.
        this.runCycle = old === AnimState.Skid ? 162 : old === AnimState.Air ? 36 : 0;
        this.frameResidual = 0;
      }
    } else {
      this.stateFrames++;
    }

    if (this.state === AnimState.Run) {
      const speed = Math.abs(n.yspeed * n.floorNormalizedX - n.xspeed * n.floorNormalizedY);
      const step = speed / 0.15 + this.frameResidual;
      this.frameResidual = step - Math.floor(step);
      this.runCycle = (this.runCycle + Math.floor(step)) % RUN_CYCLE_LENGTH;
    }
  }

  /** Joint positions relative to the ninja's centre, before facing/tilt are applied. */
  pose(skid: number): Pose {
    switch (this.state) {
      case AnimState.Run:
        return runPose((this.runCycle / RUN_CYCLE_LENGTH) * Math.PI * 2);
      case AnimState.Skid:
        return skidPose(skid);
      case AnimState.Air:
        return airPose(this.airRate);
      case AnimState.WallSlide:
        return wallPose(this.stateFrames);
      case AnimState.Celebrate:
        return celebratePose(this.stateFrames);
      default:
        return idlePose(this.stateFrames);
    }
  }
}

export type P = [number, number];
export interface Pose {
  head: P;
  neck: P;
  hip: P;
  handA: P;
  elbowA: P;
  handB: P;
  elbowB: P;
  kneeA: P;
  footA: P;
  kneeB: P;
  footB: P;
}

// Local space: +x is the facing direction, +y is down. The collision circle has
// radius 10, so the feet sit at y = 10 when standing on flat ground.
function limb(from: P, angle: number, len: number): P {
  return [from[0] + Math.sin(angle) * len, from[1] + Math.cos(angle) * len];
}

function leg(hip: P, thigh: number, shin: number): [P, P] {
  const knee = limb(hip, thigh, 5.2);
  return [knee, limb(knee, shin, 5.2)];
}

/** Angles are measured from straight down, positive towards the facing direction. */
function arm(neck: P, upper: number, lower: number): [P, P] {
  const elbow = limb(neck, upper, 3.8);
  return [elbow, limb(elbow, lower, 3.6)];
}

function idlePose(frames: number): Pose {
  const breathe = Math.sin(frames * 0.05) * 0.3;
  const hip: P = [0, 0];
  const neck: P = [0.3, -6.8 + breathe];
  const [kneeA, footA] = leg(hip, 0.25, 0.2);
  const [kneeB, footB] = leg(hip, -0.2, -0.25);
  return {
    head: [0.6, -10 + breathe], neck, hip,
    elbowA: [1.6, -3 + breathe], handA: [1.5, 0.4 + breathe],
    elbowB: [-1.4, -3 + breathe], handB: [-1.2, 0.4 + breathe],
    kneeA, footA, kneeB, footB,
  };
}

function celebratePose(frames: number): Pose {
  // Both arms thrown up in a V, waving a little.
  const wave = Math.sin(frames * 0.25) * 0.25;
  const hip: P = [0, 0];
  const neck: P = [0, -6.9];
  const [kneeA, footA] = leg(hip, 0.3, 0.25);
  const [kneeB, footB] = leg(hip, -0.3, -0.25);
  const [elbowA, handA] = arm(neck, Math.PI - 0.6 + wave, Math.PI - 0.3 + wave);
  const [elbowB, handB] = arm(neck, -(Math.PI - 0.6) + wave, -(Math.PI - 0.3) + wave);
  return { head: [0, -10.2], neck, hip, elbowA, handA, elbowB, handB, kneeA, footA, kneeB, footB };
}

function runPose(phase: number): Pose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const bob = -Math.abs(Math.cos(phase)) * 1.1;
  const hip: P = [0, -0.4 + bob];
  // Forward lean.
  const neck: P = [2.6, -6.6 + bob];
  const swing = 0.95;
  const thighA = s * swing;
  const thighB = -s * swing;
  // Knees bend most while the leg swings forward.
  const shinA = thighA - 0.9 - Math.max(0, c) * 0.9;
  const shinB = thighB - 0.9 - Math.max(0, -c) * 0.9;
  const [kneeA, footA] = leg(hip, thighA, shinA);
  const [kneeB, footB] = leg(hip, thighB, shinB);
  // Each arm swings with the opposite leg.
  const [elbowA, handA] = arm(neck, thighB * 1.1, thighB * 1.1 + 1.4);
  const [elbowB, handB] = arm(neck, thighA * 1.1, thighA * 1.1 + 1.4);
  return { head: [3.6, -9.6 + bob], neck, hip, elbowA, handA, elbowB, handB, kneeA, footA, kneeB, footB };
}

function skidPose(amount: number): Pose {
  const lean = Math.min(1, amount);
  const hip: P = [-0.5, 0.6];
  const neck: P = [-2.4 * lean, -6.2];
  const [kneeA, footA] = leg(hip, 0.75 * lean + 0.1, 0.25);
  const [kneeB, footB] = leg(hip, 0.2, -0.2);
  return {
    head: [-2.6 * lean, -9.6], neck, hip,
    elbowA: [neck[0] + 3, neck[1] + 1.6], handA: [neck[0] + 5.2, neck[1] + 0.6],
    elbowB: [neck[0] - 2.6, neck[1] + 2.2], handB: [neck[0] - 4.2, neck[1] + 0.2],
    kneeA, footA, kneeB, footB,
  };
}

function airPose(yspeed: number): Pose {
  // -1 (rising fast) .. 1 (falling fast).
  const t = yspeed >= 0 ? Math.sqrt(Math.min(yspeed * 0.6, 1)) : Math.max(yspeed * 1.5, -1);
  const tuck = 1 - Math.abs(t);
  const hip: P = [0, -0.5];
  const neck: P = [0.8, -6.8];
  const [kneeA, footA] = leg(hip, 1.1 * tuck + 0.2, -0.4 * tuck + 0.1);
  const [kneeB, footB] = leg(hip, 0.5 * tuck - 0.35 * t, -0.9 * tuck - 0.1);
  // Arms reach up while rising and flail outwards while falling.
  const armUp = t < 0 ? -t : t * 0.8;
  const [elbowA, handA] = arm(neck, 0.7 + armUp * 1.6, 1.2 + armUp * 1.5);
  const [elbowB, handB] = arm(neck, -0.6 - armUp * 1.5, -0.2 - armUp * 1.6);
  return { head: [1.4, -10.2], neck, hip, elbowA, handA, elbowB, handB, kneeA, footA, kneeB, footB };
}

function wallPose(frames: number): Pose {
  // Facing the wall (which is at local x = +10): one hand and one foot on it.
  const jitter = Math.sin(frames * 0.6) * 0.3;
  const hip: P = [1.5, 0];
  const neck: P = [2.6, -6.6];
  return {
    head: [2.8, -10], neck, hip,
    elbowA: [6.2, -9 + jitter], handA: [9.6, -11 + jitter],
    elbowB: [5, -3], handB: [9.4, -4],
    kneeA: [6.2, 2.6], footA: [9.8, 6 - jitter],
    kneeB: [-0.4, 4.6], footB: [3.6, 9.4],
  };
}
