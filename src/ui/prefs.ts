// UI preferences, kept apart from the game save (A29): the level the player last looked at.
import { LEVEL_NAMES, type LevelId, type RenderSnapshot } from '../game';

const KEY = 'idlebit2.ui.level';
const LEVELS = Object.keys(LEVEL_NAMES) as LevelId[];

export function readLastLevel(): LevelId | null {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return LEVELS.find(l => l === v) ?? null;
  } catch { return null; }
}

export function writeLastLevel(level: LevelId): void {
  try { globalThis.localStorage?.setItem(KEY, level); } catch { /* Private mode or no storage: the pref is optional. */ }
}

/** The deepest-first ladder's last opened rung: where a player with no pref lives. */
export function highestUnlocked(s: RenderSnapshot): LevelId {
  return [...LEVELS].reverse().find(l => s.unlocked[l] && s.home[l]) ?? 'chip';
}

/** Where to open: the last level if it is still open, else the highest unlocked one. */
export function openingLevel(s: RenderSnapshot): LevelId {
  const last = readLastLevel();
  return last && s.unlocked[last] && s.home[last] ? last : highestUnlocked(s);
}
