import { describe, expect, it } from 'vitest';
import golden from './fixtures/golden.json';
import { ENTITY_GRID, parseLevel } from '../src/level/level';
import { Simulator, type Point } from '../src/physics/simulator';
import type { HorInput, Ninja } from '../src/physics/ninja';
import { TILE_SEGMENT_CIRCULAR, TILE_SEGMENT_DIAG, TILE_SEGMENT_ORTHO } from '../src/physics/tileDefs';

/**
 * Replays inputs recorded against nclone (the reference N++ simulator, see
 * tools/golden/gen_golden.py) and requires our ninja to be bit-identical on
 * every single frame.
 */

const f64 = new Float64Array(5);
const bytes = new Uint8Array(f64.buffer);

/** FNV-1a over the little-endian bytes of (x, y, xspeed, yspeed, state). Matches gen_golden.py. */
function stateHash(n: Ninja): string {
  f64[0] = n.xpos;
  f64[1] = n.ypos;
  f64[2] = n.xspeed;
  f64[3] = n.yspeed;
  f64[4] = n.state;
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Gold on every point of N++'s 6 px entity grid inside the border (matches gold_field() in gen_golden.py). */
function goldField(): Point[] {
  const out: Point[] = [];
  for (let y = 4; y < 97; y++) for (let x = 4; x < 173; x++) out.push({ x: x * ENTITY_GRID, y: y * ENTITY_GRID });
  return out;
}

function decodeInput(ch: string): [HorInput, boolean] {
  const v = Number(ch);
  return [v & 4 ? -1 : v & 2 ? 1 : 0, (v & 1) === 1];
}

describe('tile tables match N++', () => {
  it('orthogonal segments', () => {
    for (const [id, edges] of Object.entries(golden.tables.ortho)) {
      expect(TILE_SEGMENT_ORTHO[Number(id)], `tile ${id}`).toEqual(edges);
    }
  });
  it('diagonal segments', () => {
    expect(Object.keys(TILE_SEGMENT_DIAG).sort()).toEqual(Object.keys(golden.tables.diag).sort());
    for (const [id, seg] of Object.entries(golden.tables.diag)) {
      expect(TILE_SEGMENT_DIAG[Number(id)], `tile ${id}`).toEqual(seg);
    }
  });
  it('circular segments', () => {
    expect(Object.keys(TILE_SEGMENT_CIRCULAR).sort()).toEqual(Object.keys(golden.tables.circular).sort());
    for (const [id, [center, quadrant, convex]] of Object.entries(golden.tables.circular)) {
      expect(TILE_SEGMENT_CIRCULAR[Number(id)], `tile ${id}`).toEqual({ center, quadrant, convex });
    }
  });
});

describe('frame-exact physics vs nclone', () => {
  for (const scenario of golden.scenarios) {
    it(scenario.name, () => {
      const level = parseLevel({
        name: scenario.name,
        rows: scenario.rows,
        mines: scenario.mines as [number, number][],
        toggleMines: scenario.toggleMines as [number, number][],
        exit: scenario.exit ? { door: scenario.exit[0] as [number, number], key: scenario.exit[1] as [number, number] } : undefined,
      });
      const gold = scenario.goldField ? [...level.gold, ...goldField()] : level.gold;
      const sim = new Simulator(level.map, level.spawnX, level.spawnY, { ...level, gold });
      // Mine states as the reference has them, updated from its log of changes.
      const mineStates = sim.mines.map((m) => m.state as number);
      let mineLogPos = 0;
      // Frame -> total gold collected, at each frame where the total changes.
      const goldAt = new Map(scenario.gold.map(([frame, total]) => [frame, total]));
      let goldTotal = 0;
      const checkpoints = new Map(scenario.checkpoints.map((c) => [c[0], c]));
      // Frames the key was collected and the ninja won (null if never).
      const [keyFrame, winFrame] = (scenario.exitLog as (number | null)[] | undefined) ?? [null, null];
      for (let i = 0; i < scenario.inputs.length; i++) {
        const [hor, jump] = decodeInput(scenario.inputs[i]);
        sim.tick(hor, jump);
        const n = sim.ninja;
        const expected = scenario.hashes.slice(i * 8, i * 8 + 8);
        if (stateHash(n) !== expected) {
          // Report the nearest earlier checkpoint to help track down where things diverged.
          const prev = [...checkpoints.keys()].filter((f) => f <= sim.frame).pop();
          throw new Error(
            `Diverged at frame ${sim.frame}: got x=${n.xpos} y=${n.ypos} vx=${n.xspeed} vy=${n.yspeed} state=${n.state}` +
              (prev !== undefined ? `; last reference checkpoint ${JSON.stringify(checkpoints.get(prev))}` : ''),
          );
        }
        goldTotal = goldAt.get(sim.frame) ?? goldTotal;
        if (sim.goldCollected !== goldTotal) {
          throw new Error(`Gold diverged at frame ${sim.frame}: collected ${sim.goldCollected}, expected ${goldTotal}`);
        }
        while (mineLogPos < scenario.mineLog.length && scenario.mineLog[mineLogPos][0] === sim.frame) {
          const [, index, state] = scenario.mineLog[mineLogPos++];
          mineStates[index] = state;
        }
        const keyExpected = keyFrame !== null && sim.frame >= keyFrame;
        if (sim.key && !sim.key.active !== keyExpected) {
          throw new Error(`Key diverged at frame ${sim.frame}: collected ${!sim.key.active}, expected on frame ${keyFrame}`);
        }
        if (sim.won !== (winFrame !== null && sim.frame >= winFrame)) {
          throw new Error(`Exit diverged at frame ${sim.frame}: won ${sim.won}, expected on frame ${winFrame}`);
        }
        sim.mines.forEach((m, j) => {
          if (m.state !== mineStates[j]) {
            throw new Error(`Mine ${j} diverged at frame ${sim.frame}: state ${m.state}, expected ${mineStates[j]}`);
          }
        });
      }
      expect(sim.frame).toBe(scenario.inputs.length);
    });
  }
});
