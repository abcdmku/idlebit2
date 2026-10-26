// "Saving up · ~4 min" beside an unaffordable price (user, 26 Oct: a buy you can't make yet must never
// look like nothing happened). The same recent-income ETA as the Buy tile.
import { useGameSelector } from '../storeHooks';
import { etaText, useCreditsPerSec } from './eta';

export function useSavingUp(price: number | null, affordable: boolean): string | null {
  const credits = useGameSelector(s => Math.floor(Number(s.hud.credits)), Object.is, 500);
  const cps = useCreditsPerSec();
  if (affordable || price === null || price <= 0) return null;
  return `Saving up · ${etaText(Math.max(0, price - credits), cps) ?? '—'}`;
}

/** The note for one offer, or nothing when it can be bought (or has no price). */
export function SavingUp({ price, affordable, className = 'dim' }: { price: number | null; affordable: boolean; className?: string }) {
  const text = useSavingUp(price, affordable);
  return text ? <span className={className}> · {text}</span> : null;
}
