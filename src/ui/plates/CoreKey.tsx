// D34: the Cores plate sells the next core first (the deck's Cores row, so they always agree, A08):
// "Add core · 2 → 3" with its price, "Max" at the cap (D39: cores are never research-locked). A core you
// can't afford yet says "Saving up", so a tap never looks like nothing happened.
import { useShellOffers } from '../deck/useOffers';
import type { Offer } from '../deck/offers';
import { useSavingUp } from '../deck/SavingUp';
import { QuoteKey } from './widgets';
import type { PlateCommon } from './types';

/** The Cores row: the next core. */
export const coreOffer = (rows: readonly Offer[]): Offer | null => rows.find(r => r.key === 'core') ?? null;

export function CoreKey({ onAction, onResearch, researchName }: Pick<PlateCommon, 'onAction' | 'onResearch' | 'researchName'>) {
  const o = coreOffer(useShellOffers().rows);
  const saving = useSavingUp(o?.price ?? null, !!o?.affordable);
  if (!o?.quote) return <div className="keys"><p className="key-slot" /></div>;
  if (o.right.kind === 'max') return <div className="keys"><p className="key-slot">Max · {o.change || 'every core site filled'}</p></div>;
  return <div className="keys">
    <QuoteKey quote={o.quote} label={`Add core${o.change ? ` · ${o.change}` : ''}`} reason={saving} onAction={q => onAction(q.action)}
      onResearch={onResearch} researchName={researchName} />
  </div>;
}
