import type { ClosestPoint, Segment } from './geometry';
import type { TileMap } from './tileMap';

/**
 * Ninja physics constants, in pixels and frames (60 frames per second).
 *
 * The original N ran at 40 fps; N++ converted its per-frame multipliers to
 * 60 fps by raising them to the power 2/3 (e.g. drag 0.99 -> 0.99^(2/3)).
 */
export const NINJA = {
  GRAVITY_FALL: 0.06666666666666665,
  GRAVITY_JUMP: 0.01111111111111111,
  GROUND_ACCEL: 0.06666666666666665,
  AIR_ACCEL: 0.04444444444444444,
  DRAG_REGULAR: 0.9933221725495059, // 0.99^(2/3)
  DRAG_SLOW: 0.8617738760127536, // 0.80^(2/3)
  FRICTION_GROUND: 0.945929024885772, // 0.92^(2/3)
  FRICTION_GROUND_SLOW: 0.8617738760127536, // 0.80^(2/3)
  FRICTION_WALL: 0.9113380468927672, // 0.87^(2/3)
  MAX_HOR_SPEED: 3.333333333333333,
  MAX_JUMP_DURATION: 45,
  MAX_SURVIVABLE_IMPACT: 6,
  RADIUS: 10,
} as const;

export const enum NinjaState {
  Immobile = 0,
  Running = 1,
  GroundSliding = 2,
  Jumping = 3,
  Falling = 4,
  WallSliding = 5,
  Dead = 6,
  AwaitingDeath = 7,
  Celebrating = 8,
  Disabled = 9,
}

/** Horizontal input: -1 left, 0 none, 1 right. */
export type HorInput = -1 | 0 | 1;

export interface DeathInfo {
  x: number;
  y: number;
  xspeed: number;
  yspeed: number;
}

/**
 * The player character. A circle of radius 10 driven by a small state machine.
 *
 * This is a port of N++'s ninja logic as reverse-engineered by nclone. Order
 * of operations matters for frame-exact behaviour, so the structure (integrate,
 * collide, post-collision, think) is kept identical to the reference.
 */
export class Ninja {
  xpos: number;
  ypos: number;
  xspeed = 0;
  yspeed = 0;
  xposOld: number;
  yposOld: number;
  xspeedOld = 0;
  yspeedOld = 0;

  appliedGravity: number = NINJA.GRAVITY_FALL;
  appliedDrag: number = NINJA.DRAG_REGULAR;

  state: NinjaState = NinjaState.Immobile;
  airborn = false;
  airbornOld = false;
  walled = false;
  wallNormal = 0;
  /** Number of wall jumps so far. */
  wallJumps = 0;

  horInput: HorInput = 0;
  jumpInput = false;
  jumpInputOld = false;
  jumpDuration = 0;

  // Input buffers: frames since an event, or -1 when not buffering.
  jumpBuffer = -1;
  floorBuffer = -1;
  wallBuffer = -1;

  floorCount = 0;
  ceilingCount = 0;
  floorNormalX = 0;
  floorNormalY = 0;
  ceilingNormalX = 0;
  ceilingNormalY = 0;
  floorNormalizedX = 0;
  floorNormalizedY = -1;
  ceilingNormalizedX = 0;
  ceilingNormalizedY = 1;

  death: DeathInfo | null = null;

  private readonly map: TileMap;
  private readonly segBuf: Segment[] = [];
  private readonly cp: ClosestPoint = { backFacing: false, x: 0, y: 0 };

  constructor(map: TileMap, x: number, y: number) {
    this.map = map;
    this.xpos = this.xposOld = x;
    this.ypos = this.yposOld = y;
  }

  get alive(): boolean {
    return this.state < NinjaState.Dead;
  }

  /** Apply drag and gravity, then move. */
  integrate(): void {
    this.xspeed *= this.appliedDrag;
    this.yspeed *= this.appliedDrag;
    this.yspeed += this.appliedGravity;
    this.xposOld = this.xpos;
    this.yposOld = this.ypos;
    this.xpos += this.xspeed;
    this.ypos += this.yspeed;
  }

  preCollision(): void {
    this.xspeedOld = this.xspeed;
    this.yspeedOld = this.yspeed;
    this.floorCount = 0;
    this.ceilingCount = 0;
    this.floorNormalX = 0;
    this.floorNormalY = 0;
    this.ceilingNormalX = 0;
    this.ceilingNormalY = 0;
  }

  /** Sweep against tiles to avoid tunnelling, then iteratively push out of overlapping segments. */
  collideVsTiles(): void {
    const R = NINJA.RADIUS;
    let dx = this.xpos - this.xposOld;
    let dy = this.ypos - this.yposOld;
    const time = sweepCircleVsTiles(this.map, this.xposOld, this.yposOld, dx, dy, R * 0.5, this.segBuf);
    this.xpos = this.xposOld + time * dx;
    this.ypos = this.yposOld + time * dy;

    for (let i = 0; i < 32; i++) {
      const result = getSingleClosestPoint(this.map, this.xpos, this.ypos, R, this.segBuf, this.cp);
      if (result === 0) break;
      dx = this.xpos - this.cp.x;
      dy = this.ypos - this.cp.y;
      if (Math.abs(dx) <= 0.0000001) dx = 0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const depenLen = R - dist * result;
      if (dist === 0 || depenLen < 0.0000001) return;
      this.xpos += (dx / dist) * depenLen;
      this.ypos += (dy / dist) * depenLen;
      // Project velocity onto the surface, but only when moving into it.
      if (this.xspeed * dx + this.yspeed * dy < 0) {
        const distSq = dist * dist;
        const cross = this.xspeed * dy - this.yspeed * dx;
        this.xspeed = (cross / distSq) * dy;
        // (0 - dx) rather than -dx: gives +0 when dx is 0, matching the reference bit for bit.
        this.yspeed = (cross / distSq) * (0 - dx);
      }
      if (dy >= -0.0001) {
        // Ceiling (walls count as ceilings here).
        this.ceilingCount++;
        this.ceilingNormalX += dx / dist;
        this.ceilingNormalY += dy / dist;
      } else {
        this.floorCount++;
        this.floorNormalX += dx / dist;
        this.floorNormalY += dy / dist;
      }
    }
  }

  /** Determine airborne / walled state, floor and ceiling normals, and impact deaths. */
  postCollision(): void {
    let wallNormal = 0;
    const rad = NINJA.RADIUS + 0.1;
    const segs = this.map.gatherSegments(this.xpos - rad, this.ypos - rad, this.xpos + rad, this.ypos + rad, this.segBuf);
    const cp = this.cp;
    for (let i = 0; i < segs.length; i++) {
      segs[i].getClosestPoint(this.xpos, this.ypos, cp);
      const dx = this.xpos - cp.x;
      const dy = this.ypos - cp.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(dy) < 0.00001 && dist > 0 && dist <= rad && !wallNormal) {
        wallNormal = dx / dist;
      }
    }

    this.airbornOld = this.airborn;
    this.airborn = true;
    this.walled = false;
    if (wallNormal) {
      this.walled = true;
      this.wallNormal = wallNormal;
    }

    if (this.floorCount > 0) {
      this.airborn = false;
      const floorScalar = Math.sqrt(this.floorNormalX * this.floorNormalX + this.floorNormalY * this.floorNormalY);
      if (floorScalar === 0) {
        this.floorNormalizedX = 0;
        this.floorNormalizedY = -1;
      } else {
        this.floorNormalizedX = this.floorNormalX / floorScalar;
        this.floorNormalizedY = this.floorNormalY / floorScalar;
      }
      if (this.state !== NinjaState.Celebrating && this.airbornOld) {
        const impactVel = -(this.floorNormalizedX * this.xspeedOld + this.floorNormalizedY * this.yspeedOld);
        if (impactVel > NINJA.MAX_SURVIVABLE_IMPACT - (4 / 3) * Math.abs(this.floorNormalizedY)) {
          this.xspeed = this.xspeedOld;
          this.yspeed = this.yspeedOld;
          this.kill(this.xpos, this.ypos, this.xspeed * 0.5, this.yspeed * 0.5);
        }
      }
    }

    if (this.ceilingCount > 0) {
      const ceilScalar = Math.sqrt(this.ceilingNormalX * this.ceilingNormalX + this.ceilingNormalY * this.ceilingNormalY);
      if (ceilScalar === 0) {
        this.ceilingNormalizedX = 0;
        this.ceilingNormalizedY = 1;
      } else {
        this.ceilingNormalizedX = this.ceilingNormalX / ceilScalar;
        this.ceilingNormalizedY = this.ceilingNormalY / ceilScalar;
      }
      if (this.state !== NinjaState.Celebrating) {
        const impactVel = -(this.ceilingNormalizedX * this.xspeedOld + this.ceilingNormalizedY * this.yspeedOld);
        if (impactVel > NINJA.MAX_SURVIVABLE_IMPACT - (4 / 3) * Math.abs(this.ceilingNormalizedY)) {
          this.xspeed = this.xspeedOld;
          this.yspeed = this.yspeedOld;
          this.kill(this.xpos, this.ypos, this.xspeed * 0.5, this.yspeed * 0.5);
        }
      }
    }
  }

  /** Jump off the floor. The direction depends on the slope and on which way the ninja moves and pushes. */
  floorJump(): void {
    this.jumpBuffer = -1;
    this.floorBuffer = -1;
    this.state = NinjaState.Jumping;
    this.appliedGravity = NINJA.GRAVITY_JUMP;
    let jx: number;
    let jy: number;
    if (this.floorNormalizedX === 0) {
      jx = 0;
      jy = -2;
    } else {
      const nx = this.floorNormalizedX;
      const ny = this.floorNormalizedY;
      if (this.xspeed * nx >= 0) {
        // Moving downhill (or still).
        if (this.xspeed * this.horInput >= 0) {
          jx = (2 / 3) * nx;
          jy = 2 * ny;
        } else {
          jx = 0;
          jy = -1.4;
        }
      } else if (this.xspeed * this.horInput > 0) {
        // Moving uphill, pushing forward.
        jx = 0;
        jy = -1.4;
      } else {
        // Moving uphill, not pushing forward: jump perpendicular to the slope.
        this.xspeed = 0;
        jx = (2 / 3) * nx;
        jy = 2 * ny;
      }
    }
    if (this.yspeed > 0) this.yspeed = 0;
    this.xspeed += jx;
    this.yspeed += jy;
    this.xpos += jx;
    this.ypos += jy;
    this.jumpDuration = 0;
  }

  wallJump(): void {
    // Bookkeeping only (lets the game react to wall jumps); no effect on the physics.
    this.wallJumps++;
    let jx: number;
    let jy: number;
    if (this.horInput * this.wallNormal < 0 && this.state === NinjaState.WallSliding) {
      // Holding into the wall while sliding: a short hop up the wall.
      jx = 2 / 3;
      jy = -1;
    } else {
      jx = 1;
      jy = -1.4;
    }
    this.state = NinjaState.Jumping;
    this.appliedGravity = NINJA.GRAVITY_JUMP;
    if (this.xspeed * this.wallNormal < 0) this.xspeed = 0;
    if (this.yspeed > 0) this.yspeed = 0;
    this.xspeed += jx * this.wallNormal;
    this.yspeed += jy;
    this.xpos += jx * this.wallNormal;
    this.ypos += jy;
    this.jumpBuffer = -1;
    this.wallBuffer = -1;
    this.jumpDuration = 0;
  }

  /** Per-frame decision making from inputs and contact state. */
  think(): void {
    const newJumpCheck = this.jumpInput && !this.jumpInputOld;
    this.jumpInputOld = this.jumpInput;

    // Advance input buffers (each lasts 5 frames).
    if (this.jumpBuffer > -1 && this.jumpBuffer < 5) this.jumpBuffer++;
    else this.jumpBuffer = -1;
    const inJumpBuffer = this.jumpBuffer > -1 && this.jumpBuffer < 5;
    if (this.wallBuffer > -1 && this.wallBuffer < 5) this.wallBuffer++;
    else this.wallBuffer = -1;
    const inWallBuffer = this.wallBuffer > -1 && this.wallBuffer < 5;
    if (this.floorBuffer > -1 && this.floorBuffer < 5) this.floorBuffer++;
    else this.floorBuffer = -1;
    const inFloorBuffer = this.floorBuffer > -1 && this.floorBuffer < 5;

    if (newJumpCheck && this.airborn) this.jumpBuffer = 0;
    if (this.walled) this.wallBuffer = 0;
    if (!this.airborn) this.floorBuffer = 0;

    switch (this.state) {
      case NinjaState.Dead:
      case NinjaState.Disabled:
        return;
      case NinjaState.AwaitingDeath:
        this.state = NinjaState.Dead;
        return;
      case NinjaState.Celebrating:
        this.appliedDrag = this.airborn ? NINJA.DRAG_REGULAR : NINJA.DRAG_SLOW;
        return;
    }

    if (!this.airborn) {
      this.thinkGrounded(newJumpCheck, inJumpBuffer);
    } else {
      this.thinkAirborne(newJumpCheck, inJumpBuffer, inWallBuffer, inFloorBuffer);
    }
  }

  private thinkGrounded(newJumpCheck: boolean, inJumpBuffer: boolean): void {
    const xspeedNew = this.xspeed + NINJA.GROUND_ACCEL * this.horInput;
    if (Math.abs(xspeedNew) < NINJA.MAX_HOR_SPEED) this.xspeed = xspeedNew;

    if (this.state > NinjaState.GroundSliding) {
      // Just landed.
      if (this.state === NinjaState.Jumping) this.appliedGravity = NINJA.GRAVITY_FALL;
      this.state = this.xspeed * this.horInput <= 0 ? NinjaState.GroundSliding : NinjaState.Running;
    }

    if (inJumpBuffer || newJumpCheck) {
      this.floorJump();
      return;
    }

    const nx = this.floorNormalizedX;
    const ny = this.floorNormalizedY;
    if (this.state === NinjaState.GroundSliding) {
      const projection = Math.abs(this.yspeed * nx - this.xspeed * ny);
      if (this.horInput * projection * this.xspeed > 0) {
        this.state = NinjaState.Running;
        return;
      }
      if (projection < 0.1 && nx === 0) {
        this.state = NinjaState.Immobile;
        return;
      }
      if (this.yspeed < 0 && nx !== 0) {
        // Sliding up a slope. This friction formula is odd, but it's what the original does.
        const speedScalar = Math.sqrt(this.xspeed * this.xspeed + this.yspeed * this.yspeed);
        const fricForce = Math.abs(this.xspeed * (1 - NINJA.FRICTION_GROUND) * ny);
        const fricForce2 = speedScalar - fricForce * (ny * ny);
        this.xspeed = (this.xspeed / speedScalar) * fricForce2;
        this.yspeed = (this.yspeed / speedScalar) * fricForce2;
        return;
      }
      this.xspeed *= NINJA.FRICTION_GROUND;
      return;
    }

    if (this.state === NinjaState.Running) {
      const projection = Math.abs(this.yspeed * nx - this.xspeed * ny);
      if (this.horInput * projection * this.xspeed > 0) {
        // Running uphill gets a small boost along the slope.
        if (this.horInput * nx >= 0) return;
        if (Math.abs(xspeedNew) < NINJA.MAX_HOR_SPEED) {
          const boost = (NINJA.GROUND_ACCEL / 2) * this.horInput;
          this.xspeed += boost * ny * ny;
          this.yspeed += boost * ny * -nx;
        }
        return;
      }
      this.state = NinjaState.GroundSliding;
      return;
    }

    // Immobile.
    if (this.horInput) {
      this.state = NinjaState.Running;
      return;
    }
    const projection = Math.abs(this.yspeed * nx - this.xspeed * ny);
    if (projection < 0.1) {
      this.xspeed *= NINJA.FRICTION_GROUND_SLOW;
      return;
    }
    this.state = NinjaState.GroundSliding;
  }

  private thinkAirborne(newJumpCheck: boolean, inJumpBuffer: boolean, inWallBuffer: boolean, inFloorBuffer: boolean): void {
    const xspeedNew = this.xspeed + NINJA.AIR_ACCEL * this.horInput;
    if (Math.abs(xspeedNew) < NINJA.MAX_HOR_SPEED) this.xspeed = xspeedNew;

    if (this.state < NinjaState.Jumping) {
      this.state = NinjaState.Falling;
      return;
    }
    if (this.state === NinjaState.Jumping) {
      // Holding jump keeps the low "jump gravity" for up to 45 frames.
      this.jumpDuration++;
      if (!this.jumpInput || this.jumpDuration > NINJA.MAX_JUMP_DURATION) {
        this.appliedGravity = NINJA.GRAVITY_FALL;
        this.state = NinjaState.Falling;
        return;
      }
    }
    if (inJumpBuffer || newJumpCheck) {
      if (this.walled || inWallBuffer) {
        this.wallJump();
        return;
      }
      if (inFloorBuffer) {
        this.floorJump();
        return;
      }
    }
    if (!this.walled) {
      if (this.state === NinjaState.WallSliding) this.state = NinjaState.Falling;
    } else if (this.state === NinjaState.WallSliding) {
      if (this.horInput * this.wallNormal <= 0) this.yspeed *= NINJA.FRICTION_WALL;
      else this.state = NinjaState.Falling;
    } else if (this.yspeed > 0 && this.horInput * this.wallNormal < 0) {
      if (this.state === NinjaState.Jumping) this.appliedGravity = NINJA.GRAVITY_FALL;
      this.state = NinjaState.WallSliding;
    }
  }

  /** Touched the open exit door: celebrate (the ninja stops responding to input). */
  win(): void {
    if (this.state >= NinjaState.Dead) return;
    if (this.state === NinjaState.Jumping) this.appliedGravity = NINJA.GRAVITY_FALL;
    this.state = NinjaState.Celebrating;
  }

  kill(x: number, y: number, xspeed: number, yspeed: number): void {
    if (this.state >= NinjaState.Dead) return;
    this.death = { x, y, xspeed, yspeed };
    if (this.state === NinjaState.Jumping) this.appliedGravity = NINJA.GRAVITY_FALL;
    this.state = NinjaState.AwaitingDeath;
  }
}

/** Earliest fraction of the move [0, 1] at which a circle touches any nearby tile segment. */
export function sweepCircleVsTiles(
  map: TileMap, xposOld: number, yposOld: number, dx: number, dy: number, radius: number, buf: Segment[],
): number {
  const xposNew = xposOld + dx;
  const yposNew = yposOld + dy;
  const width = radius + 1;
  const segs = map.gatherSegments(
    Math.min(xposOld, xposNew) - width,
    Math.min(yposOld, yposNew) - width,
    Math.max(xposOld, xposNew) + width,
    Math.max(yposOld, yposNew) + width,
    buf,
  );
  let shortest = 1;
  for (let i = 0; i < segs.length; i++) {
    shortest = Math.min(segs[i].intersectWithRay(xposOld, yposOld, dx, dy, radius), shortest);
  }
  return shortest;
}

/**
 * Find the closest point on any nearby segment. Writes it to `out` and returns
 * 1 if it is on a segment's outer side, -1 if on its inner side, 0 if none found.
 */
export function getSingleClosestPoint(
  map: TileMap, xpos: number, ypos: number, radius: number, buf: Segment[], out: ClosestPoint,
): -1 | 0 | 1 {
  const segs = map.gatherSegments(xpos - radius, ypos - radius, xpos + radius, ypos + radius, buf);
  let shortest = 9999999;
  let result: -1 | 0 | 1 = 0;
  let bestX = 0;
  let bestY = 0;
  for (let i = 0; i < segs.length; i++) {
    segs[i].getClosestPoint(xpos, ypos, out);
    let distSq = (xpos - out.x) * (xpos - out.x) + (ypos - out.y) * (ypos - out.y);
    // Prefer front faces when several segments are about equally close.
    if (!out.backFacing) distSq -= 0.1;
    if (distSq < shortest) {
      shortest = distSq;
      bestX = out.x;
      bestY = out.y;
      result = out.backFacing ? -1 : 1;
    }
  }
  out.x = bestX;
  out.y = bestY;
  return result;
}
