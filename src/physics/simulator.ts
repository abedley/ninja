import { GOLD_RADIUS, Gold, overlapCircleVsCircle } from './gold';
import { Mine } from './mine';
import { NINJA, Ninja, NinjaState, type HorInput } from './ninja';
import { TileMap } from './tileMap';

/** Simulation runs at a fixed 60 ticks per second, like N++. */
export const TICK_RATE = 60;

export interface Point {
  x: number;
  y: number;
}

/** Entities to place in a level (positions in world px). */
export interface Entities {
  gold?: readonly Point[];
  mines?: readonly Point[];
  /** Toggle mines: safe until touched, armed once the ninja moves off them. */
  toggleMines?: readonly Point[];
}

export class Simulator {
  readonly map: TileMap;
  ninja: Ninja;
  frame = 0;
  readonly gold: Gold[];
  goldCollected = 0;
  /** Gold picked up during the most recent tick. */
  readonly goldThisTick: Gold[] = [];
  /** Regular mines first, then toggle mines (the order N++ updates them in). */
  readonly mines: Mine[];
  /** The mine that killed the ninja, if one did. */
  killedBy: Mine | null = null;

  constructor(map: TileMap, spawnX: number, spawnY: number, entities: Entities = {}) {
    this.map = map;
    this.ninja = new Ninja(map, spawnX, spawnY);
    this.gold = (entities.gold ?? []).map((g) => new Gold(g.x, g.y));
    this.mines = [
      ...(entities.mines ?? []).map((m) => new Mine(m.x, m.y, false)),
      ...(entities.toggleMines ?? []).map((m) => new Mine(m.x, m.y, true)),
    ];
  }

  /** Advance the simulation by exactly one frame. */
  tick(horInput: HorInput, jumpInput: boolean): void {
    this.frame++;
    this.goldThisTick.length = 0;
    const ninja = this.ninja;
    ninja.horInput = horInput;
    ninja.jumpInput = jumpInput;

    // Entities think first, using the ninja's position from the previous frame.
    for (const m of this.mines) m.think(ninja);

    if (ninja.state === NinjaState.Disabled || ninja.state === NinjaState.Dead) return;

    ninja.integrate();
    ninja.preCollision();
    // N++ runs four collision passes per frame (entities would go in between).
    for (let i = 0; i < 4; i++) ninja.collideVsTiles();
    // Logical (non-physical) entity collisions open N++'s post-collision step.
    // (Gold and mines don't affect each other, so their order doesn't matter.)
    this.collectGold();
    for (const m of this.mines) if (m.logicalCollision(ninja)) this.killedBy ??= m;
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
