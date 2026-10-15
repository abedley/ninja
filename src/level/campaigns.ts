import type { LevelDef } from './level';
import campaigns from './campaigns.json';
import { LEVELS } from './levels';

/**
 * A campaign: levels played in order on one clock, like an N++ episode. It
 * starts with `time` seconds; each level after the first starts with the time
 * left at the end of the one before.
 */
export interface Campaign {
  name: string;
  description?: string;
  /** Seconds on the clock at the start of the first level. */
  time: number;
  levels: LevelDef[];
}

/** As written in campaigns.json: the levels by name (from levels.json). */
export interface CampaignDef {
  name: string;
  description?: string;
  time: number;
  levels: string[];
}

export function resolveCampaign(def: CampaignDef, levels: readonly LevelDef[]): Campaign {
  if (!def.levels.length) throw new Error(`Campaign "${def.name}" has no levels`);
  return {
    name: def.name,
    description: def.description,
    time: def.time,
    levels: def.levels.map((name) => {
      const level = levels.find((l) => l.name === name);
      if (!level) throw new Error(`Campaign "${def.name}" lists a level "${name}" that isn't in levels.json`);
      return level;
    }),
  };
}

/** The campaigns on the main menu, in campaigns.json's order. */
export const CAMPAIGNS: Campaign[] = (campaigns as CampaignDef[]).map((c) => resolveCampaign(c, LEVELS));
