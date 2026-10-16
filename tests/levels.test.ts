import { describe, expect, it } from 'vitest';
import { AutoRunner } from '../src/game/autoRunner';
import { parseAscii } from './helpers';
import { parseLevel, upgradeLevel } from '../src/level/level';
import { LEVELS } from '../src/level/levels';
import { Simulator } from '../src/physics/simulator';
import { NinjaState } from '../src/physics/ninja';
import { GoldState } from '../src/physics/gold';
import { GREASED_TILE } from '../src/physics/tileDefs';

describe('shipped levels', () => {
  for (const def of LEVELS) {
    // Only that the game can load them: they change often, so the rest of the tests use their own (tests/fixtures).
    it(`${def.name} loads`, () => {
      expect(() => parseLevel(def)).not.toThrow();
    });
  }
});

describe('level parser', () => {
  it('rejects ragged rows, unknown tiles, objects in the rows and missing spawns', () => {
    const spawn: [number, number] = [6, 6];
    expect(() => parseLevel({ name: 'x', rows: ['...', '##'], spawn })).toThrow(/expected 3/);
    expect(() => parseLevel({ name: 'x', rows: ['..?'], spawn })).toThrow(/unknown tile/);
    expect(() => parseLevel({ name: 'x', rows: ['..$'], spawn })).toThrow(/rows are only terrain/);
    expect(() => parseLevel({ name: 'x', rows: ['...'] })).toThrow(/no spawn/);
    expect(() => parseLevel({ name: 'x', rows: ['...'], spawn, facing: 'up' as 'left' })).toThrow(/facing/);
    expect(() => parseLevel({ name: 'x', rows: ['...'], spawn, key: [10, 6] })).toThrow(/both an exit door/);
  });

  it('places every object by N++ entity coordinates (6 px, from the outer edge of the border)', () => {
    const level = parseLevel({
      name: 'x',
      rows: ['.....', '#####'],
      spawn: [6, 6],
      facing: 'left',
      gold: [[9, 7], [14, 6]],
      mines: [[20, 8]],
      toggleMines: [[12, 4]],
      toggleGold: [[16, 4]],
      key: [10, 6],
      door: [22, 6],
      launchPads: [[16, 8, 6]],
    });
    expect([level.spawnX, level.spawnY, level.facing]).toEqual([36, 36, -1]);
    expect(level.gold).toEqual([{ x: 54, y: 42 }, { x: 84, y: 36 }]);
    expect(level.mines).toEqual([{ x: 120, y: 48 }]);
    expect(level.toggleMines).toEqual([{ x: 72, y: 24 }]);
    expect(level.toggleGold).toEqual([{ x: 96, y: 24 }]);
    expect(level.exit).toEqual({ key: { x: 60, y: 36 }, door: { x: 132, y: 36 } });
    expect(level.launchPads).toEqual([{ x: 96, y: 48, orientation: 6 }]);
    expect(parseLevel({ name: 'x', rows: ['.'], spawn: [6, 6] }).facing).toBe(1);
  });
});

describe('levels in the old format', () => {
  it('have the objects marked in their rows moved to coordinates, in the middle of their tiles', () => {
    const old = { name: 'x', rows: ['.$*%', 'K<.D', '####'], gold: [[9, 7]] as [number, number][] };
    expect(upgradeLevel(old)).toEqual({
      name: 'x',
      rows: ['....', '....', '####'],
      spawn: [10, 10],
      facing: 'left',
      // Gold from the rows first, then the gold that was already listed: the order the game loaded them in.
      gold: [[10, 6], [9, 7]],
      mines: [[14, 6]],
      toggleMines: [[18, 6]],
      key: [6, 10],
      door: [18, 10],
    });
  });

  it('have "exit" split into the key and door', () => {
    const old = { name: 'x', rows: ['N...'], exit: { door: [18, 6] as [number, number], key: [10, 6] as [number, number] } };
    expect(upgradeLevel(old)).toEqual({ name: 'x', rows: ['....'], spawn: [6, 6], key: [10, 6], door: [18, 6] });
  });

  it('are left alone once up to date', () => {
    const def = { name: 'x', rows: ['....'], spawn: [6, 6] as [number, number] };
    expect(upgradeLevel(def)).toBe(def);
  });
});

describe('gold', () => {
  it('is collected once, by running into it', () => {
    const level = parseAscii({ name: 'x', rows: ['N.....$..', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    let pickedUpOn = 0;
    for (let i = 0; i < 120; i++) {
      sim.tick(1, false);
      if (sim.goldThisTick.length) pickedUpOn = sim.frame;
    }
    expect(sim.goldCollected).toBe(1);
    expect(sim.gold[0].active).toBe(false);
    expect(pickedUpOn).toBeGreaterThan(0);
  });

  it('is not collected when a tile overhead', () => {
    const level = parseAscii({ name: 'x', rows: ['.........', '......$..', 'N........', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    for (let i = 0; i < 120; i++) sim.tick(1, false);
    expect(sim.goldCollected).toBe(0);
  });
});

describe('toggle gold', () => {
  // A corridor with toggle gold in its middle, at the ninja's height (6 px units: tile 5's centre).
  const level = parseLevel({ name: 'x', rows: ['.........', '#########'], spawn: [6, 6], toggleGold: [[22, 6]] });

  it('is only collected the second time through: touched once, moved off, then touched again', () => {
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    const g = sim.gold[0];
    expect([sim.gold.length, g.state]).toEqual([1, GoldState.Dormant]);
    // Run right through it: it wakes as the ninja passes, and is ready once it's gone by.
    const states = new Set<GoldState>();
    for (let i = 0; i < 70; i++) {
      sim.tick(1, false);
      states.add(g.state);
    }
    expect(states).toEqual(new Set([GoldState.Dormant, GoldState.Waking, GoldState.Ready]));
    expect([sim.goldCollected, g.active]).toEqual([0, true]);
    // Back through it: collected, with its time bonus.
    for (let i = 0; i < 70 && !sim.goldCollected; i++) sim.tick(-1, false);
    expect([sim.goldCollected, g.active, sim.goldThisTick]).toEqual([1, false, [g]]);
  });

  it('goes back to dormant if the ninja dies on it', () => {
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    const g = sim.gold[0];
    for (let i = 0; i < 70 && g.state !== GoldState.Waking; i++) sim.tick(1, false);
    expect(g.state).toBe(GoldState.Waking);
    // (The ninja is dead the frame after it's killed.)
    sim.ninja.kill(sim.ninja.xpos, sim.ninja.ypos, 0, 0);
    sim.tick(0, false);
    sim.tick(0, false);
    expect(g.state).toBe(GoldState.Dormant);
  });
});

describe('exit', () => {
  const corridor = (row: string) => parseAscii({ name: 'x', rows: [row, '#'.repeat(row.length)] });

  it('needs both a door (D) and a key (K)', () => {
    expect(() => corridor('N...D....')).toThrow(/both an exit door/);
    expect(corridor('N.K...D..').exit).toEqual({ door: { x: 7 * 24 + 12, y: 36 }, key: { x: 3 * 24 + 12, y: 36 } });
  });

  it('is shut until the key is collected', () => {
    const level = corridor('N.D...K..');
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    // Run right past the shut door to the key...
    for (let i = 0; i < 90; i++) sim.tick(1, false);
    expect(sim.won).toBe(false);
    expect(sim.key!.active).toBe(false);
    expect(sim.door!.open).toBe(true);
    // ...then back to the door.
    for (let i = 0; i < 120 && !sim.won; i++) sim.tick(-1, false);
    expect(sim.won).toBe(true);
    expect(sim.ninja.state).toBe(NinjaState.Celebrating);
  });

  it('ends play: the ninja stops responding, collects no more gold and the clock stops', () => {
    const level = corridor('NKD.$....');
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    sim.timeLeft = 600;
    for (let i = 0; i < 60 && !sim.won; i++) sim.tick(1, false);
    expect(sim.won).toBe(true);
    const timeLeft = sim.timeLeft;
    for (let i = 0; i < 120; i++) sim.tick(1, true);
    expect(sim.ninja.state).toBe(NinjaState.Celebrating);
    expect(sim.ninja.xspeed).toBeCloseTo(0);
    expect(sim.goldCollected).toBe(0);
    expect(sim.timeLeft).toBe(timeLeft);
  });
});

describe('clock', () => {
  it('runs one frame per tick, and at zero the ninja dies', () => {
    const level = parseAscii({ name: 'x', rows: ['N........', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    for (let i = 0; i < 30; i++) sim.tick(0, false);
    // Untimed until a time is set.
    expect(sim.timeLeft).toBe(Infinity);
    sim.timeLeft = 50;
    for (let i = 0; i < 49; i++) sim.tick(0, false);
    expect(sim.timeLeft).toBe(1);
    expect(sim.ninja.state).toBe(NinjaState.Immobile);
    sim.tick(0, false);
    expect(sim.timeLeft).toBe(0);
    expect(sim.timedOut).toBe(true);
    expect(sim.ninja.state).toBe(NinjaState.Dead);
  });

  it('gets two seconds for each piece of gold', () => {
    const level = parseAscii({ name: 'x', rows: ['N...$$...', '#########'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    sim.timeLeft = 1000;
    for (let i = 0; i < 90; i++) sim.tick(1, false);
    expect(sim.goldCollected).toBe(2);
    expect(sim.timeLeft).toBe(1000 - 90 + 2 * 120);
  });
});

describe('greased blocks (G)', () => {
  /** Jump from the floor into the wall on the right, holding jump for `hold` frames from frame 3; then a second press, if given. */
  function play(wall: string, frames: number, kick?: number) {
    const level = parseAscii({ name: 'g', rows: [...Array(8).fill('....' + wall), 'N....'] });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY);
    const runner = new AutoRunner(sim.ninja);
    for (let i = 0; i < 20; i++) sim.tick(0, false);
    const log: { state: NinjaState; x: number; y: number; yspeed: number; greased: boolean }[] = [];
    for (let f = 0; f < frames; f++) {
      const held = (f >= 3 && f < 48) || (kick !== undefined && f >= kick && f < kick + 10);
      sim.tick(...runner.control(sim.ninja, held));
      runner.update(sim.ninja);
      const n = sim.ninja;
      log.push({ state: n.state, x: n.xpos, y: n.ypos, yspeed: n.yspeed, greased: n.wallGreased });
    }
    return { sim, log };
  }

  it('are solid blocks: the same shape, and the same to run into and land on', () => {
    const run = (block: string) => {
      const level = parseAscii({ name: 'g', rows: ['.....', `N..${block}.`, `${block}${block}${block}${block}${block}`] });
      const sim = new Simulator(level.map, level.spawnX, level.spawnY);
      const trace: number[] = [];
      for (let i = 0; i < 120; i++) {
        sim.tick(i < 60 ? 1 : -1, i === 70);
        trace.push(sim.ninja.xpos, sim.ninja.ypos);
      }
      return trace;
    };
    expect(parseAscii({ name: 'g', rows: ['NG'] }).map.tileAt(2, 1)).toBe(GREASED_TILE);
    expect(run('G')).toEqual(run('#'));
  });

  it('have no grip: the ninja slides down their walls, speeding up, where a normal wall slows it', () => {
    const normal = play('#', 150).log.filter((e) => e.state === NinjaState.WallSliding);
    const greased = play('G', 150).log.filter((e) => e.state === NinjaState.WallSliding);
    expect(greased.length).toBeGreaterThan(10);
    expect(greased.every((e) => e.greased)).toBe(true);
    expect(normal.some((e) => e.greased)).toBe(false);
    // Speeding up all the way down, and much faster than the steady slide on a normal wall.
    for (let i = 1; i < greased.length; i++) expect(greased[i].yspeed).toBeGreaterThan(greased[i - 1].yspeed);
    expect(Math.max(...greased.map((e) => e.yspeed))).toBeGreaterThan(2 * Math.max(...normal.map((e) => e.yspeed)));
    expect(greased.length).toBeLessThan(normal.length / 1.5);
  });

  it('can still be jumped off', () => {
    const slide = play('G', 150).log.findIndex((e) => e.state === NinjaState.WallSliding);
    const { sim, log } = play('G', slide + 30, slide + 3);
    expect(sim.ninja.wallJumps).toBe(1);
    expect(log[log.length - 1].x).toBeLessThan(log[slide].x - 20);
  });
});

describe('launch pads', () => {
  const room = ['..........', '..........', '..........', '..........', 'N.........'];
  /** Run with the auto-runner (no jumps) through the room with the given pads. */
  function play(launchPads: [number, number, number][], frames: number) {
    const level = parseAscii({ name: 'pads', rows: room, launchPads });
    const sim = new Simulator(level.map, level.spawnX, level.spawnY, level);
    const runner = new AutoRunner(sim.ninja, level.facing);
    const log: { x: number; y: number; dir: number }[] = [];
    let launches = 0;
    for (let f = 0; f < frames; f++) {
      sim.tick(...runner.control(sim.ninja, false));
      runner.update(sim.ninja);
      launches += sim.launchesThisTick.length;
      log.push({ x: sim.ninja.xpos, y: sim.ninja.ypos, dir: runner.dir });
    }
    return { sim, log, launches };
  }

  it('are placed in 6 px units, facing one of 8 ways', () => {
    const level = parseAscii({ name: 'pads', rows: room, launchPads: [[12, 24, 6], [20, 10, 1]] });
    expect(level.launchPads).toEqual([
      { x: 72, y: 144, orientation: 6 },
      { x: 120, y: 60, orientation: 1 },
    ]);
    expect(() => parseAscii({ name: 'pads', rows: room, launchPads: [[12, 24, 8]] })).toThrow(/direction/);
  });

  // The floor of the room is at 6 px y = 24; the spawn at x = 6.
  it('throw the ninja up from a floor', () => {
    const { log, launches } = play([[14, 24, 6]], 70);
    expect(launches).toBe(1);
    expect(Math.min(...log.map((e) => e.y))).toBeLessThan(144 - 60);
  });

  it('work from below when floating in mid-air', () => {
    // An up pad 14 px above the ninja's centre as it runs: it touches it from underneath.
    const { launches, log } = play([[14, 20, 6]], 70);
    // (Passing up through it, it can throw on two frames in a row, as in N++.)
    expect(launches).toBeGreaterThan(0);
    expect(Math.min(...log.map((e) => e.y))).toBeLessThan(144 - 60);
  });

  it('set the auto-runner running the way they throw', () => {
    const { log, launches } = play([[14, 24, 4]], 60);
    expect(launches).toBeGreaterThan(0);
    const thrown = log.findIndex((e) => e.dir === -1);
    expect(thrown).toBeGreaterThan(0);
    expect(log[thrown + 20].x).toBeLessThan(log[thrown].x - 30);
  });
});
