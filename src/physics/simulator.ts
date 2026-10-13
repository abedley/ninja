import { GOLD_RADIUS, Gold, overlapCircleVsCircle } from './gold';
import { NINJA, Ninja, NinjaState, type HorInput } from './ninja';
import { TileMap } from './tileMap';

/** Simulation runs at a fixed 60 ticks per second, like N++. */
export const TICK_RATE = 60;

export interface Point {
  x: number;
  y: number;
}

export class Simulator {
  readonly map: TileMap;
  ninja: Ninja;
  frame = 0;
  readonly gold: Gold[];
  goldCollected = 0;
  /** Gold picked up during the most recent tick. */
  readonly goldThisTick: Gold[] = [];

  constructor(map: TileMap, spawnX: number, spawnY: number, gold: readonly Point[] = []) {
    this.map = map;
    this.ninja = new Ninja(map, spawnX, spawnY);
    this.gold = gold.map((g) => new Gold(g.x, g.y));
  }

  /** Advance the simulation by exactly one frame. */
  tick(horInput: HorInput, jumpInput: boolean): void {
    this.frame++;
    this.goldThisTick.length = 0;
    const ninja = this.ninja;
    ninja.horInput = horInput;
    ninja.jumpInput = jumpInput;

    if (ninja.state === NinjaState.Disabled || ninja.state === NinjaState.Dead) return;

    ninja.integrate();
    ninja.preCollision();
    // N++ runs four collision passes per frame (entities would go in between).
    for (let i = 0; i < 4; i++) ninja.collideVsTiles();
    // Logical (non-physical) entity collisions open N++'s post-collision step.
    this.collectGold();
    ninja.postCollision();
    ninja.think();
  }

  private collectGold(): void {
    const n = this.ninja;
    if (n.state === NinjaState.Celebrating) return;
    // N++ only tests entities in the 3x3 cells around the ninja; any gold close
    // enough to touch (10 + 6 px < one 24 px cell) is in there, so test them all.
    for (const g of this.gold) {
      if (g.active && overlapCircleVsCircle(g.x, g.y, GOLD_RADIUS, n.xpos, n.ypos, NINJA.RADIUS)) {
        g.active = false;
        this.goldCollected++;
        this.goldThisTick.push(g);
      }
    }
  }
}
