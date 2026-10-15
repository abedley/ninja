import { AutoRunner } from '../../src/game/autoRunner';
import type { MineState } from '../../src/physics/mine';
import { Ninja, NinjaState } from '../../src/physics/ninja';
import { Simulator, TICK_RATE, type Point } from '../../src/physics/simulator';
import type { Level } from '../../src/level/level';
import { GREASED_TILE, TILE_SIZE } from '../../src/physics/tileDefs';
import type { TileMap } from '../../src/physics/tileMap';

/**
 * A search bot for one-button levels: a beam search over jump presses. With
 * no goal height it finds a way to collect the key and reach the exit door;
 * given one, a way to get the ninja up to that height and survive the
 * landing. It proves that a level can be completed with the one-button
 * controls; the plans it finds are replayed by tests/campaign.test.ts.
 *
 * A plan is a list of presses, each [frames released before it, frames held].
 * The plan starts with the tap that starts the level: as in the game, the
 * physics doesn't run before it (the ninja hangs at the spawn point).
 */
export type Plan = [gap: number, hold: number][];

interface Node {
  ninja: Ninja;
  runner: AutoRunner;
  /** Toggle mines remember being touched, so their states are part of the search state. */
  mines: MineState[];
  hasKey: boolean;
  frame: number;
  /** Closest the ninja has come to its current target. */
  bestDist: number;
  bestY: number;
  plan: Plan;
}

const GAPS = [1, 4, 8, 13, 19, 26, 35, 46, 60, 80];
const HOLDS = [3, 9, 16, 25, 35, 46];

function cloneNinja(n: Ninja): Ninja {
  return Object.assign(Object.create(Ninja.prototype) as Ninja, n);
}

/** Run `frames` frames from a node's state; returns false if the ninja died. */
function advance(node: Node, frames: number, held: boolean, sim: Simulator, target: () => Goal | null): boolean {
  const runner = node.runner;
  for (let i = 0; i < frames; i++) {
    const n = sim.ninja;
    sim.tick(...runner.control(n, held));
    runner.update(n);
    node.frame++;
    if (n.ypos < node.bestY) node.bestY = n.ypos;
    if (n.state >= NinjaState.Dead || n.state === NinjaState.AwaitingDeath) return n.state === NinjaState.Celebrating;
    if (sim.key && !sim.key.active && !node.hasKey) {
      // Got the key: now head for the door.
      node.hasKey = true;
      node.bestDist = Infinity;
    }
    const t = target();
    if (t) node.bestDist = Math.min(node.bestDist, distance(n, t));
  }
  return true;
}

/** A target, with each tile's distance from it (in tiles, through open tiles). */
interface Goal extends Point {
  field: Int32Array;
  width: number;
}

/** Breadth-first distances (in tiles) from the target's tile to every tile that isn't solid. */
function goal(map: TileMap, t: Point): Goal {
  const { width, height } = map;
  const field = new Int32Array(width * height).fill(-1);
  const start = Math.floor(t.y / TILE_SIZE) * width + Math.floor(t.x / TILE_SIZE);
  field[start] = 0;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const x = c % width;
    const y = (c - x) / width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const tile = map.tileAt(nx, ny);
      if (tile === 1 || tile === GREASED_TILE) continue;
      const n = ny * width + nx;
      if (field[n] >= 0) continue;
      field[n] = field[c] + 1;
      queue.push(n);
    }
  }
  return { x: t.x, y: t.y, field, width };
}

/**
 * How far the ninja is from a target: the length of the shortest path to it
 * through open tiles (so walls and floors in the way count), and the straight
 * distance once it's close.
 */
function distance(n: Ninja, t: Goal): number {
  const tiles = t.field[Math.floor(n.ypos / TILE_SIZE) * t.width + Math.floor(n.xpos / TILE_SIZE)];
  const straight = Math.hypot(n.xpos - t.x, n.ypos - t.y);
  return tiles <= 1 ? straight : Math.max(straight, tiles * TILE_SIZE);
}

export interface SolveResult {
  plan: Plan | null;
  /** Highest point reached (lowest y) by any surviving path. */
  bestY: number;
}

export function solve(level: Level, opts: { goalY?: number; beam?: number; maxPresses?: number } = {}): SolveResult {
  const beamWidth = opts.beam ?? 80;
  const maxPresses = opts.maxPresses ?? 200;
  const goalY = opts.goalY;
  const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
  const { key, door } = sim;
  if (goalY === undefined && !(key && door)) throw new Error('The level has no exit, so a goal height is needed');
  const loadState = (node: Node) => {
    sim.ninja = node.ninja;
    sim.mines.forEach((m, i) => (m.state = node.mines[i]));
    if (key) key.active = !node.hasKey;
    if (door) door.open = node.hasKey;
  };
  const saveMines = () => sim.mines.map((m) => m.state);
  let beam: Node[] = [{ ninja: cloneNinja(sim.ninja), runner: new AutoRunner(sim.ninja, level.facing), mines: saveMines(), hasKey: false, frame: 0, bestDist: Infinity, bestY: sim.ninja.ypos, plan: [] }];
  let bestY = sim.ninja.ypos;
  const keyGoal = key && goal(level.map, key);
  const doorGoal = door && goal(level.map, door);
  const targetOf = (node: Node): Goal | null => (goalY !== undefined ? null : node.hasKey ? doorGoal : keyGoal);
  const goalReached = (node: Node) => (goalY === undefined ? node.ninja.state === NinjaState.Celebrating : node.bestY <= goalY);

  for (let depth = 0; depth < maxPresses && beam.length; depth++) {
    const next = new Map<string, Node>();
    for (const node of beam) {
      for (const gap of GAPS) {
        for (const hold of HOLDS) {
          const child: Node = { ...node, ninja: cloneNinja(node.ninja), runner: node.runner.clone(), plan: [...node.plan, [gap, hold]] };
          loadState(child);
          const target = () => targetOf(child);
          if (!advance(child, gap, false, sim, target)) continue;
          if (child.ninja.state !== NinjaState.Celebrating && !advance(child, hold, true, sim, target)) continue;
          child.mines = saveMines();
          bestY = Math.min(bestY, child.bestY);
          if (goalReached(child)) {
            if (goalY === undefined) return { plan: child.plan, bestY };
            // Make sure the ninja survives the landing.
            const check = { ...child, ninja: cloneNinja(child.ninja), runner: child.runner.clone(), mines: [...child.mines] };
            sim.ninja = check.ninja;
            if (advance(check, 150, false, sim, () => null)) return { plan: child.plan, bestY };
            continue;
          }
          const n = child.ninja;
          const k = `${Math.round(n.xpos / 8)},${Math.round(n.ypos / 8)},${child.runner.dir},${n.airborn ? 1 : 0},${Math.round(n.yspeed)},${child.hasKey ? 1 : 0},${child.mines.join('')}`;
          const prev = next.get(k);
          if (!prev || score(child, targetOf(child)) < score(prev, targetOf(prev))) next.set(k, child);
        }
      }
    }
    beam = [...next.values()]
      .map((node) => ({ node, s: score(node, targetOf(node)) }))
      .sort((a, b) => a.s - b.s)
      .slice(0, beamWidth)
      .map(({ node }) => node);
  }
  return { plan: null, bestY };
}

/**
 * Lower is better. Climbing to a height: mostly current height, with credit
 * for the best height so far. Going for the key, then the door: the same, by
 * distance to the target, and any node with the key beats any without.
 */
function score(node: Node, target: Goal | null): number {
  const n = node.ninja;
  if (!target) return n.ypos * 0.7 + node.bestY * 0.3 + node.frame * 0.01;
  return distance(n, target) * 0.7 + node.bestDist * 0.3 + node.frame * 0.01 + (node.hasKey ? 0 : 1e6);
}

/**
 * Replay a plan from the spawn, as the game plays it (the clock starts with
 * the first press of play); returns the simulator after it, plus a final 150
 * idle frames. The clock starts with `clock` frames (by default the level's
 * own time).
 */
export function replay(level: Level, plan: Plan, onFrame?: (sim: Simulator) => void, clock?: number): Simulator {
  const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
  if (clock !== undefined) sim.timeLeft = clock;
  else if (level.time !== undefined) sim.timeLeft = level.time * TICK_RATE;
  const runner = new AutoRunner(sim.ninja, level.facing);
  const step = (held: boolean) => {
    sim.tick(...runner.control(sim.ninja, held));
    runner.update(sim.ninja);
    onFrame?.(sim);
  };
  for (const [gap, hold] of plan) {
    for (let i = 0; i < gap; i++) step(false);
    for (let i = 0; i < hold; i++) step(true);
  }
  for (let i = 0; i < 150; i++) step(false);
  return sim;
}
