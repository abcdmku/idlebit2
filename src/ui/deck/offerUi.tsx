// Shared pieces for anything that shows an offer: the price with its coin, and what a tap does.
import type { GameAction, LockReason } from '../../game';
import { SPR } from '../../render/core';
import { ArtCanvas } from '../art/ArtCanvas';
import { wholeText } from '../hooks/format';
import { useShell } from '../storeHooks';
import type { Offer } from './offers';

export function Coin({ n }: { n: number }) {
  return <ArtCanvas w={5} h={5} n={n} artKey="coin5" className="inl" draw={g => { g.clearRect(0, 0, 5, 5); g.drawImage(SPR.coin5, 0, 0); }} />;
}
export function PriceText({ offer, n }: { offer: Offer; n: number }) {
  return <span className={offer.affordable ? 'gold' : 'dim'}><Coin n={n} /> {wholeText(offer.price ?? 0)}</span>;
}

/** What tapping an offer does: buy it, or open the research that unlocks it. */
export function offerAction(o: Offer): { action: GameAction } | { research: LockReason } | null {
  if (!o.quote) return null;
  if (o.affordable && o.price !== null) return { action: o.quote.action };
  if (o.quote.locked?.code === 'research' && o.quote.locked.node && !o.where) return { research: o.quote.locked };
  return null;
}
export function useTapOffer() {
  const shell = useShell();
  return (o: Offer) => {
    const a = offerAction(o);
    if (!a) return;
    if ('action' in a) shell.dispatch(a.action);
    else shell.view.dispatch({ type: 'openResearch', project: a.research.node });
  };
}

export function lockWord(o: Offer): string {
  return o.where ? o.lock! : o.lock!.replace(/^Needs /, '');
}

