import { AutoRunner } from '../../src/game/autoRunner';
import type { MineState } from '../../src/physics/mine';
import { Ninja, NinjaState } from '../../src/physics/ninja';
import { Simulator } from '../../src/physics/simulator';
import type { Level } from '../../src/level/level';

/**
 * A search bot for one-button levels: a beam search over jump presses that
 * finds a way to get the ninja up to `goalY` and survive the landing. It
 * proves that a level can be completed with the one-button controls; the
 * plans it finds are replayed by tests/tower.test.ts.
 *
 * A plan is a list of presses, each [frames released before it, frames held].
 * Play starts (the ninja starts running) after 20 frames of settling.
 */
export type Plan = [gap: number, hold: number][];

interface Node {
  ninja: Ninja;
  dir: -1 | 1;
  /** Toggle mines remember being touched, so their states are part of the search state. */
  mines: MineState[];
  frame: number;
  bestY: number;
  plan: Plan;
}

const GAPS = [1, 4, 8, 13, 19, 26, 35, 46, 60, 80];
const HOLDS = [3, 9, 16, 25, 35, 46];

function cloneNinja(n: Ninja): Ninja {
  return Object.assign(Object.create(Ninja.prototype) as Ninja, n);
}

/** Run `frames` frames from a node's state; returns false if the ninja died. */
function advance(node: Node, frames: number, held: boolean, firstPressed: boolean, sim: Simulator, runner: AutoRunner): boolean {
  for (let i = 0; i < frames; i++) {
    const n = sim.ninja;
    sim.tick(runner.input(n, held && i === 0 && firstPressed), held);
    runner.update(n);
    node.frame++;
    if (n.ypos < node.bestY) node.bestY = n.ypos;
    if (n.state >= NinjaState.Dead || n.state === NinjaState.AwaitingDeath) return false;
  }
  return true;
}

export interface SolveResult {
  plan: Plan | null;
  /** Highest point reached (lowest y) by any surviving path. */
  bestY: number;
}

export function solve(level: Level, goalY: number, opts: { beam?: number; maxPresses?: number } = {}): SolveResult {
  const beamWidth = opts.beam ?? 80;
  const maxPresses = opts.maxPresses ?? 200;
  const sim = new Simulator(level.map, level.spawnX, level.spawnY, { mines: level.mines, toggleMines: level.toggleMines });
  const loadMines = (states: MineState[]) => sim.mines.forEach((m, i) => (m.state = states[i]));
  const saveMines = () => sim.mines.map((m) => m.state);
  // Settle at the spawn point before the first press.
  for (let i = 0; i < 20; i++) sim.tick(0, false);
  let beam: Node[] = [{ ninja: cloneNinja(sim.ninja), dir: 1, mines: saveMines(), frame: 0, bestY: sim.ninja.ypos, plan: [] }];
  let bestY = sim.ninja.ypos;

  for (let depth = 0; depth < maxPresses && beam.length; depth++) {
    const next = new Map<string, Node>();
    for (const node of beam) {
      for (const gap of GAPS) {
        for (const hold of HOLDS) {
          const child: Node = { ...node, ninja: cloneNinja(node.ninja), plan: [...node.plan, [gap, hold]] };
          sim.ninja = child.ninja;
          loadMines(node.mines);
          const runner = new AutoRunner(child.ninja, child.dir);
          if (!advance(child, gap, false, false, sim, runner)) continue;
          if (!advance(child, hold, true, true, sim, runner)) continue;
          child.dir = runner.dir;
          child.mines = saveMines();
          bestY = Math.min(bestY, child.bestY);
          if (child.bestY <= goalY) {
            // Make sure the ninja survives the landing.
            const check = { ...child, ninja: cloneNinja(child.ninja), mines: [...child.mines] };
            sim.ninja = check.ninja;
            if (advance(check, 150, false, false, sim, runner)) return { plan: child.plan, bestY };
            continue;
          }
          const n = child.ninja;
          const key = `${Math.round(n.xpos / 8)},${Math.round(n.ypos / 8)},${child.dir},${n.airborn ? 1 : 0},${Math.round(n.yspeed)},${child.mines.join('')}`;
          const prev = next.get(key);
          if (!prev || score(child) < score(prev)) next.set(key, child);
        }
      }
    }
    beam = [...next.values()].sort((a, b) => score(a) - score(b)).slice(0, beamWidth);
  }
  return { plan: null, bestY };
}

/** Lower is better: mostly current height, with credit for the best height so far. */
function score(n: Node): number {
  return n.ninja.ypos * 0.7 + n.bestY * 0.3 + n.frame * 0.01;
}

/** Replay a plan from the spawn; returns the simulator after it, plus a final 150 idle frames. */
export function replay(level: Level, plan: Plan, onFrame?: (sim: Simulator) => void): Simulator {
  const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
  for (let i = 0; i < 20; i++) sim.tick(0, false);
  const runner = new AutoRunner(sim.ninja);
  const step = (held: boolean, pressed: boolean) => {
    sim.tick(runner.input(sim.ninja, pressed), held);
    runner.update(sim.ninja);
    onFrame?.(sim);
  };
  for (const [gap, hold] of plan) {
    for (let i = 0; i < gap; i++) step(false, false);
    for (let i = 0; i < hold; i++) step(true, i === 0);
  }
  for (let i = 0; i < 150; i++) step(false, false);
  return sim;
}
