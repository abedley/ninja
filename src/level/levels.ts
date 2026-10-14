import type { LevelDef } from './level';
import levels from './levels.json';

/**
 * The campaign: the game plays these levels in order, on one clock (the first
 * level's time; each level after starts with the time left at the end of the
 * one before). A level's own time is used when it's played on its own.
 *
 * Level data lives in levels.json so that tools can read exactly the same
 * levels as the game. See level.ts for the tile legend.
 */
export const LEVELS: LevelDef[] = levels;
