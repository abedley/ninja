/**
 * Find a one-button route up a level and print it as a plan for tests/tower.test.ts.
 *
 * Usage: npx vite-node tools/solver/solve.ts [level name] [goal row] [beam width]
 * The goal row counts from the top of the level's rows (0 = top row).
 */
import { parseLevel } from '../../src/level/level';
import { LEVELS } from '../../src/level/levels';
import { TILE_SIZE } from '../../src/physics/tileDefs';
import { replay, solve } from './solver';

// (The project has no Node type definitions; this script only needs these.)
declare const process: { argv: string[]; exitCode?: number };

const [name = 'Tower', goalRow = '3', beam = '60'] = process.argv.slice(2);
const def = LEVELS.find((l) => l.name.toLowerCase() === name.toLowerCase());
if (!def) throw new Error(`No level named "${name}"`);
const level = parseLevel(def);
// +1 for the border row above the level.
const goalY = (Number(goalRow) + 1) * TILE_SIZE;
const started = Date.now();
const { plan, bestY } = solve(level, goalY, { beam: Number(beam) });
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (plan) {
  const sim = replay(level, plan);
  console.log(`Route found in ${secs}s: ${plan.length} presses, ${sim.frame} frames, gold ${sim.goldCollected}/${sim.gold.length}.`);
  console.log(JSON.stringify(plan));
} else {
  console.log(`No route found in ${secs}s. Highest point reached: row ${(bestY / TILE_SIZE - 1).toFixed(1)}.`);
  process.exitCode = 1;
}
