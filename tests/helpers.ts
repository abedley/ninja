import { parseLevel, upgradeLevel, type Level, type LegacyLevelDef } from '../src/level/level';

/**
 * Parse a test level written the short way, with its objects marked in the
 * rows (N spawn, < spawn facing left, $ gold, * mine, % toggle mine, D door,
 * K key), as levels were before they kept only terrain in their rows.
 */
export function parseAscii(def: LegacyLevelDef): Level {
  return parseLevel(upgradeLevel(def));
}
