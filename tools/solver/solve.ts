/**
 * Find a one-button route through a level in levels.json and print it as a plan (as used by tests/campaign.test.ts).
 *
 * Usage: npx vite-node tools/solver/solve.ts [level name] [beam width] [goal row]
 * The route collects the key and reaches the exit door; or, given a goal row
 * (counting from the top of the level's rows, 0 = top row), just climbs that high.
 */
import { parseLevel } from '../../src/level/level';
import { LEVELS } from '../../src/level/levels';
import { TICK_RATE } from '../../src/physics/simulator';
import { TILE_SIZE } from '../../src/physics/tileDefs';
import { replay, solve } from './solver';

// (The project has no Node type definitions; this script only needs these.)
declare const process: { argv: string[]; exitCode?: number };

const [name = LEVELS[0].name, beam = '60', goalRow] = process.argv.slice(2);
const def = LEVELS.find((l) => l.name.toLowerCase() === name.toLowerCase());
if (!def) throw new Error(`No level named "${name}"`);
const level = parseLevel(def);
// +1 for the border row above the level.
const goalY = goalRow === undefined ? undefined : (Number(goalRow) + 1) * TILE_SIZE;
const started = Date.now();
const { plan, bestY } = solve(level, { goalY, beam: Number(beam) });
const secs = ((Date.now() - started) / 1000).toFixed(1);
if (plan) {
  const sim = replay(level, plan);
  const time = level.time === undefined ? '' : `, ${(sim.timeLeft / TICK_RATE).toFixed(2)}s of ${level.time}s left`;
  console.log(
    `Route found in ${secs}s: ${plan.length} presses, ${sim.frame} frames, gold ${sim.goldCollected}/${sim.gold.length}` +
      `${sim.won ? ', exit reached' : ''}${time}.`,
  );
  console.log(JSON.stringify(plan));
} else {
  console.log(`No route found in ${secs}s. Highest point reached: row ${(bestY / TILE_SIZE - 1).toFixed(1)}.`);
  process.exitCode = 1;
}
