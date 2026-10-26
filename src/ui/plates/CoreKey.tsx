// D34: a core's plate sells the next core first (the Cores row's quote), or the clock once cores are at
// their cap. The same offer the deck and the Buy tile show, so they always agree (A08).
import { useShellOffers } from '../deck/useOffers';
import type { Offer } from '../deck/offers';
import { QuoteKey } from './widgets';
import type { PlateCommon } from './types';

/** The row a core sells: the next core, else (cores maxed) the clock. */
export function coreOffer(rows: readonly Offer[]): Offer | null {
  const cores = rows.find(r => r.key === 'core'), clock = rows.find(r => r.key === 'clock');
  return cores && cores.right.kind !== 'max' ? cores : clock ?? null;
}

export function CoreKey({ onAction, onResearch, researchName }: Pick<PlateCommon, 'onAction' | 'onResearch' | 'researchName'>) {
  const o = coreOffer(useShellOffers().rows);
  if (!o?.quote) return <div className="keys"><p className="key-slot" /></div>;
  const label = o.key === 'core' ? `Add core${o.change ? ` · ${o.change}` : ''}` : `Clock · ${o.change}`;
  // Locked behind research: one plain key that opens it ("Research Multi-core").
  const lock = o.quote.locked;
  if (lock?.code === 'research' && lock.node && onResearch) {
    const node = lock.node, name = researchName?.(node) ?? lock.text.replace(/^Needs /, '');
    return <div className="keys"><button type="button" className="key locked-action" data-qa-target onClick={() => onResearch(node)}>Research {name}</button></div>;
  }
  return <div className="keys">
    <QuoteKey quote={o.quote} label={label} onAction={q => onAction(q.action)} onResearch={onResearch} researchName={researchName} />
  </div>;
}
