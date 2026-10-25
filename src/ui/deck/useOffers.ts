import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useGameSelector, useQuote, useShell, useViewState } from '../storeHooks';
import { buildOffers, EXTRA_ROWS, extraRequest, linkRequest, type Offers } from './offers';

/**
 * The visible level's offers: tray quotes (R13 order), the inbound link and the level's other parts
 * (the System's PSU, a router's queue), with their effects. Quotes are lazy and refresh at most 2 Hz (useQuote). The
 * world prices its build ghosts with the same tray quotes.
 */
export function useOffers(): Offers {
  const { surface } = useShell();
  const at = useViewState().focus;
  const tray = useQuote({ kind: 'tray', at });
  const quotes = tray?.quotes ?? null;
  const link = useQuote(linkRequest(at));
  // At most one extra row per level today; one hook call keeps the hook order fixed.
  const extraDef = EXTRA_ROWS[at.level]?.[0];
  const extra = useQuote(extraDef ? extraRequest(at, extraDef) : null);
  const cacheLevels = useGameSelector(s => (s.focus.level === 'chip' ? s.focus.cache.levels.length : 1));
  useEffect(() => { surface.buildQuotes = tray; }, [surface, tray]);
  useEffect(() => () => { surface.buildQuotes = null; }, [surface]);
  return useMemo(() => buildOffers(at.level, quotes, link?.quotes[0] ?? null,
    [extra?.quotes.find(q => q.action.type === 'upgradePart' || q.action.type === 'upgradeRouterQueue') ?? null], { cacheLevels }), [at.level, quotes, link, extra, cacheLevels]);
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
