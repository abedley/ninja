import type { LevelDef } from './level';
import levels from './levels.json';

/**
 * Every level in the game. Campaigns (campaigns.json) play them in order on
 * one clock; a level's own time is used when it's played on its own
 * (?level=<name>, or from the level editor).
 *
 * Level data lives in levels.json so that tools can read exactly the same
 * levels as the game. See level.ts for the tile legend.
 */
export const LEVELS: LevelDef[] = levels;
