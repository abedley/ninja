import type { LevelDef } from './level';
import levels from './levels.json';

/**
 * Level data lives in levels.json so that tools (e.g. tools/golden/gen_golden.py)
 * can read exactly the same levels as the game. See level.ts for the tile legend.
 */
export const LEVELS: LevelDef[] = levels;

export const PLAYGROUND = LEVELS[0];

/** The default level: a one-button climb, made for portrait screens. */
export const TOWER = LEVELS.find((l) => l.name === 'Tower')!;
