import { ExitDoor, ExitKey } from './exit';
import { Gold, GoldState } from './gold';
import { LaunchPad } from './launchPad';
import { Mine } from './mine';
import { Ninja, NinjaState, type HorInput } from './ninja';
import { OneWayPlatform } from './oneWay';
import { TILE_SIZE } from './tileDefs';
import { TileMap } from './tileMap';

/** Simulation runs at a fixed 60 ticks per second, like N++. */
export const TICK_RATE = 60;
/** Each piece of gold adds two seconds to the clock, as in N. */
export const GOLD_TIME_BONUS = 2 * TICK_RATE;

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
  /** Toggle gold: can't be collected until touched once and moved off (see GoldState). */
  toggleGold?: readonly Point[];
  /** The exit door and the key (N++'s exit switch) that opens it. */
  exit?: { door: Point; key: Point };
  /** Launch pads, each facing one of N++'s 8 orientations (0 right, then clockwise). */
  launchPads?: readonly LaunchPadPlacement[];
  /** One-way platforms, each facing 0 (right), 2 (down), 4 (left) or 6 (up): solid only from that side. */
  oneWays?: readonly LaunchPadPlacement[];
}

export interface LaunchPadPlacement extends Point {
  orientation: number;
}

type Touchable = Gold | Mine | LaunchPad | OneWayPlatform | ExitKey | ExitDoor;

export class Simulator {
  readonly map: TileMap;
  ninja: Ninja;
  frame = 0;
  /** Regular gold, then toggle gold. */
  readonly gold: Gold[];
  goldCollected = 0;
  /** Gold picked up during the most recent tick. */
  readonly goldThisTick: Gold[] = [];
  /** Regular mines first, then toggle mines (the order N++ updates them in). */
  readonly mines: Mine[];
  /** The mine that killed the ninja, if one did. */
  killedBy: Mine | null = null;
  readonly launchPads: LaunchPad[];
  /** Launch pads that threw the ninja during the most recent tick. */
  readonly launchesThisTick: LaunchPad[] = [];
  readonly oneWays: OneWayPlatform[];
  readonly door: ExitDoor | null;
  readonly key: ExitKey | null;
  /** True once the ninja has reached the open door. */
  won = false;
  /**
   * Frames left on the clock. It runs while the ninja is alive and not
   * celebrating, gold adds GOLD_TIME_BONUS, and at zero the ninja dies.
   * Infinity (the default) means no time limit.
   */
  timeLeft = Infinity;
  timedOut = false;
  /** Entities the ninja can touch, in the order N++ checks them (see touchOrder()). */
  private readonly touchables: Touchable[];
  /** Each touchable's grid cell, as [x, y]. */
  private readonly cells: [number, number][];
  /** The one-way platforms in touch order, with their cells (they're collided with physically, in every pass). */
  private readonly solids: { e: OneWayPlatform; cell: [number, number] }[];

  constructor(map: TileMap, spawnX: number, spawnY: number, entities: Entities = {}) {
    this.map = map;
    this.ninja = new Ninja(map, spawnX, spawnY);
    this.gold = [...(entities.gold ?? []).map((g) => new Gold(g.x, g.y)), ...(entities.toggleGold ?? []).map((g) => new Gold(g.x, g.y, true))];
    this.mines = [
      ...(entities.mines ?? []).map((m) => new Mine(m.x, m.y, false)),
      ...(entities.toggleMines ?? []).map((m) => new Mine(m.x, m.y, true)),
    ];
    this.launchPads = (entities.launchPads ?? []).map((p) => new LaunchPad(p.x, p.y, p.orientation));
    this.oneWays = (entities.oneWays ?? []).map((p) => new OneWayPlatform(p.x, p.y, p.orientation));
    const exit = entities.exit;
    this.door = exit ? new ExitDoor(exit.door.x, exit.door.y) : null;
    this.key = exit ? new ExitKey(exit.key.x, exit.key.y) : null;
    this.touchables = touchOrder([
      ...this.gold,
      ...this.mines,
      ...this.launchPads,
      ...this.oneWays,
      ...(this.key ? [this.key] : []),
      ...(this.door ? [this.door] : []),
    ]);
    this.cells = this.touchables.map((e) => cellOf(e.x, e.y));
    this.solids = this.touchables.flatMap((e, i) => (e instanceof OneWayPlatform ? [{ e, cell: this.cells[i] }] : []));
  }

  /** Advance the simulation by exactly one frame. */
  tick(horInput: HorInput, jumpInput: boolean): void {
    this.frame++;
    this.goldThisTick.length = 0;
    this.launchesThisTick.length = 0;
    const ninja = this.ninja;
    ninja.horInput = horInput;
    ninja.jumpInput = jumpInput;

    // Entities think first, using the ninja's position from the previous frame.
    for (const m of this.mines) m.think(ninja);
    for (const g of this.gold) if (g.toggle) g.think(ninja);

    if (ninja.state === NinjaState.Disabled || ninja.state === NinjaState.Dead) return;

    ninja.integrate();
    ninja.preCollision();
    // N++ runs four collision passes per frame: solid entities, then tiles.
    for (let i = 0; i < 4; i++) {
      if (this.solids.length) this.collideVsObjects();
      ninja.collideVsTiles();
    }
    // Logical (non-physical) entity collisions open N++'s post-collision step.
    const wallNormal = this.logicalCollisions();
    this.runClock();
    ninja.postCollision(wallNormal);
    ninja.think();
  }

  /** Push the ninja out of the one-way platforms in the 3x3 cells around it (N++'s physical entity collisions). */
  private collideVsObjects(): void {
    const n = this.ninja;
    const [cx, cy] = cellOf(n.xpos, n.ypos);
    // (Gathered before any push moves the ninja.)
    const near = this.solids.filter(({ cell: [ex, ey] }) => Math.abs(ex - cx) <= 1 && Math.abs(ey - cy) <= 1);
    for (const { e } of near) {
      const d = e.depenetration(n);
      if (d) n.depenetrateOneWay(d.nx, d.ny, d.len);
    }
  }

  /** Returns the first wall normal found among the entities (a one-way platform's side), or 0. */
  private logicalCollisions(): number {
    let wallNormal = 0;
    const n = this.ninja;
    // N++ gathers the entities to test before testing them, so a door opened
    // by the key this frame can't be entered until the next one.
    const doorOpen = this.door?.open ?? false;
    // Only entities in the 3x3 cells around the ninja, found before any are tested (a launch pad can move it).
    const [cx, cy] = cellOf(n.xpos, n.ypos);
    for (let i = 0; i < this.touchables.length; i++) {
      const e = this.touchables[i];
      const [ex, ey] = this.cells[i];
      if (Math.abs(ex - cx) > 1 || Math.abs(ey - cy) > 1) continue;
      if (e instanceof Gold) {
        if (e.active && e.state === GoldState.Ready && n.state !== NinjaState.Celebrating && e.touches(n)) {
          e.active = false;
          this.goldCollected++;
          this.goldThisTick.push(e);
          this.timeLeft += GOLD_TIME_BONUS;
        }
      } else if (e instanceof Mine) {
        if (e.logicalCollision(n)) this.killedBy ??= e;
      } else if (e instanceof LaunchPad) {
        if (e.logicalCollision(n)) this.launchesThisTick.push(e);
      } else if (e instanceof OneWayPlatform) {
        wallNormal ||= e.wallNormal(n);
      } else if (e instanceof ExitKey) {
        if (e.active && e.logicalCollision(n)) this.door!.open = true;
      } else if (doorOpen && e.logicalCollision(n)) {
        this.won = true;
      }
    }
    return wallNormal;
  }

  /** Not part of N++'s physics (it has no per-level clock), so it can't affect anything above. */
  private runClock(): void {
    if (this.ninja.state >= NinjaState.Dead || this.timeLeft === Infinity) return;
    this.timeLeft--;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.timedOut = true;
      const n = this.ninja;
      n.kill(n.xpos, n.ypos, n.xspeed * 0.5, n.yspeed * 0.5);
    }
  }
}

/**
 * An entity grid cell (a tile). (N++ also clamps cells to its 44x25 grid,
 * which changes nothing inside a level that size; levels here can be bigger.)
 */
function cellOf(x: number, y: number): [number, number] {
  return [Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)];
}

/**
 * N++ tests the entities in the 3x3 grid cells around the ninja, cell by cell
 * (column by column, top to bottom within a column), each cell's entities in
 * the order they were added. The exit door is added to its cell when it opens,
 * so it comes after everything else there.
 *
 * Only some orders matter: entering the door stops gold being collected and
 * mines killing (and the reverse) for the rest of that frame.
 */
function touchOrder(list: Touchable[]): Touchable[] {
  const key = (e: Touchable) => [Math.floor(e.x / TILE_SIZE), Math.floor(e.y / TILE_SIZE), e instanceof ExitDoor ? 1 : 0];
  return list
    .map((e, i) => ({ e, i, k: key(e) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map(({ e }) => e);
}
