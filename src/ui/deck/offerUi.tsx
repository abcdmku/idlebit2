// Shared pieces for anything that shows an offer: the price with its coin, the right column, and what a tap does.
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
export function LockGlyph({ n }: { n: number }) {
  return <ArtCanvas w={7} h={8} n={n} artKey="lock" className="inl" style={{ verticalAlign: 'middle' }} draw={g => { g.clearRect(0, 0, 7, 8); g.drawImage(SPR.lock, 0, 0); }} />;
}

/** The right column (A14): the price, "Research: Dual core" with the lock, "Max", or "At the Rack switch". */
export function RightText({ offer: o, n }: { offer: Offer; n: number }) {
  switch (o.right.kind) {
    case 'price': return <PriceText offer={o} n={n} />;
    case 'research': return <span className="dim">Research: {o.right.node} <LockGlyph n={n} /></span>;
    case 'max': return <span className="dim">Max</span>;
    case 'at': return <span className="net">At {o.right.place}</span>;
    case 'lock': return <span className="dim">{o.right.text}</span>;
    case 'none': return null;
  }
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
