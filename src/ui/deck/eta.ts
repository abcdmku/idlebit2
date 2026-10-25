// How long until the Credits for a buy are in hand, at the recent net income (HudSnapshot.incomeRecent:
// the last 30 s, energy included, so it goes negative when the bill outruns pay).
import { etaSpan } from '../hooks/format';
import { useGameSelector } from '../storeHooks';

/** "~9 s", "~35 min", "~2 h", or null when income is 0 (the first 10 s of a round) or negative. */
export function etaText(shortCredits: number, creditsPerSec: number): string | null {
  if (!(creditsPerSec > 0) || !(shortCredits > 0)) return null;
  return etaSpan(shortCredits / creditsPerSec);
}

/** Recent net Credits per second, read once a second. */
export function useCreditsPerSec(): number {
  return useGameSelector(s => (s.hud.incomeRecent ?? s.hud.income)?.creditsPerSec ?? 0, Object.is, 1000);
}
