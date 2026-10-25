import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuote, useShell, useViewState } from '../storeHooks';
import { buildOffers, linkRequest, type Offers } from './offers';

/**
 * The visible level's offers: tray quotes (R13 order) and the inbound link, with their effects.
 * Quotes are lazy and refresh at most 2 Hz (useQuote). The world prices its build
 * ghosts with the same tray quotes.
 */
export function useOffers(): Offers {
  const { surface } = useShell();
  const at = useViewState().focus;
  const tray = useQuote({ kind: 'tray', at });
  const quotes = tray?.quotes ?? null;
  const link = useQuote(linkRequest(at));
  useEffect(() => { surface.buildQuotes = tray; }, [surface, tray]);
  useEffect(() => () => { surface.buildQuotes = null; }, [surface]);
  return useMemo(() => buildOffers(at.level, quotes, link?.quotes[0] ?? null), [at.level, quotes, link]);
}

/** One set of offers for the deck and the callout; the shell provides it. */
export const OffersContext = createContext<Offers | null>(null);
export function useShellOffers(): Offers {
  const offers = useContext(OffersContext);
  if (!offers) throw new Error('idlebit2 offers provider is missing');
  return offers;
}

/** Computes the offers once for everything under it (the deck and the callout). */
export function OffersScope({ children }: { children: ReactNode }) {
  return createElement(OffersContext.Provider, { value: useOffers() }, children);
}
