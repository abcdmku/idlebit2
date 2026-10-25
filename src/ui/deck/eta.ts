// How long until the Credits for a buy are in hand, at this round's net income (HudSnapshot.income).
import { useGameSelector } from '../storeHooks';

/** "~35 min", "~2 h", or null when income is 0 (the first 10 s of a round) or negative. */
export function etaText(shortCredits: number, creditsPerSec: number): string | null {
  if (!(creditsPerSec > 0) || !(shortCredits > 0)) return null;
  const min = shortCredits / creditsPerSec / 60;
  return min < 90 ? `~${Math.max(1, Math.round(min))} min` : `~${Math.round(min / 60)} h`;
}

/** Net Credits per second this round, read once a second. */
export function useCreditsPerSec(): number {
  return useGameSelector(s => s.hud.income?.creditsPerSec ?? 0, Object.is, 1000);
}
