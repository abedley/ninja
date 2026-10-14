import type { LevelDef } from './level';

/**
 * The level editor hands the level being edited to the game through this
 * browser's storage: the game opens it with ?level=editor.
 */
const PLAYTEST_KEY = 'ninja.editor.playtest';
export const PLAYTEST_PARAM = 'editor';

export function savePlaytest(def: LevelDef): boolean {
  try {
    localStorage.setItem(PLAYTEST_KEY, JSON.stringify(def));
    return true;
  } catch {
    return false;
  }
}

export function loadPlaytest(): LevelDef | null {
  try {
    const text = localStorage.getItem(PLAYTEST_KEY);
    return text ? (JSON.parse(text) as LevelDef) : null;
  } catch {
    return null;
  }
}
