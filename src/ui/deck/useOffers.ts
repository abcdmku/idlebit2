import { createContext, createElement, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useGameSelector, useQuote, useShell, useViewState } from '../storeHooks';
import type { RenderSnapshot } from '../../game';
import { buildOffers, EXTRA_ROWS, extraOffer, extraRequest, linkRequest, WALL_ROWS, type Offers } from './offers';

/** A timeout is too little speed: the clock on a CPU, the CPU on a system. */
const SLOW_ROWS = ['clock', 'core', 'port', 'cpu'];
/** Draw at or above this share of a supply's capacity (or a lump this hot) makes it worth featuring. */
const NEAR = 0.8, HOT_F = 85;

/**
 * QA-05: what the wall is now, as row keys (the head's block, else last round's top failure), and which
 * supplies run near their limit. A string, so the selector only changes when the answer does.
 */
export function wallKey(s: RenderSnapshot): string {
  const report = s.round.lastReport, top = report?.details[0];
  const wall = s.feed.blockedBy ? WALL_ROWS[s.feed.blockedBy] ?? []
    : top ? WALL_ROWS[top.detail] ?? (top.cause === 'timeout' || top.cause === 'late' ? SLOW_ROWS : [])
    : report && (report.failedByCause.timeout > 0 || report.failedByCause.late > 0) ? SLOW_ROWS : [];
  const f = s.focus, near: string[] = [];
  if ((f.level === 'system' || f.level === 'chip') && f.psu.usage >= NEAR) near.push('psu');
  if (f.level === 'rack') { if (f.pdu.usage >= NEAR) near.push('pdu'); if (f.tempF >= HOT_F || f.throttled) near.push('rackCooler'); }
  if (f.level === 'room') { if (f.ups.some(u => u.usage >= NEAR)) near.push('ups'); if (f.tempF >= HOT_F) near.push('roomCooler'); }
  return `${wall.join(',')}|${near.join(',')}`;
}

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
  const rackOpen = useGameSelector(s => s.unlocked.rack);
  const link = useQuote(at.level === 'chip' || at.level === 'system' || rackOpen ? linkRequest(at) : null);
  // At most two extra rows per level; two hook calls keep the hook order fixed.
  const defs = EXTRA_ROWS[at.level] ?? [];
  const extra0 = useQuote(defs[0] ? extraRequest(at, defs[0]) : null), extra1 = useQuote(defs[1] ? extraRequest(at, defs[1]) : null);
  const wk = useGameSelector(wallKey, Object.is, 500);
  useEffect(() => { surface.buildQuotes = tray; }, [surface, tray]);
  useEffect(() => () => { surface.buildQuotes = null; }, [surface]);
  return useMemo(() => buildOffers(at.level, quotes, link?.quotes[0] ?? null,
    [extraOffer(extra0?.quotes), extraOffer(extra1?.quotes)], wallContext(wk)), [at.level, quotes, link, extra0, extra1, wk]);
}

function wallContext(key: string) {
  const [wall = '', near = ''] = key.split('|');
  return { wall: wall ? wall.split(',') : [], supplyNear: new Set(near ? near.split(',') : []) };
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
