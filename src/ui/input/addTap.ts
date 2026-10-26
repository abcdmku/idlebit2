// Tapping a "+" buys that component (user, 26 Oct): the slot's default add, the same buy as its plate's
// primary key. Affordable: buy at once, no plate. Short of Credits or locked: open the detail at that slot,
// which shows the price and the saving time, or the lock. A buy over a supply still runs, with a warning.
import { type LevelSnapshot, type Quote, type SystemId } from '../../game';
import type { HitTarget } from '../../render/core';
import { primaryQuote, slotSite } from '../callout/model';
import { buildOffers } from '../deck/offers';
import { hasPlate, plateRequest } from '../plates/PlateLayer';
import { GPU_GENERATIONS } from '../plates/gpuModel';
import type { ShellContextValue } from '../storeHooks';
import { showSupplyToast } from '../shell/supplyToast';

type Shell = Pick<ShellContextValue, 'view' | 'store' | 'dispatch' | 'quote'>;

export const isAdd = (t: Pick<HitTarget, 'kind'>) => t.kind === 'add';

/**
 * The target the add's detail opens on: the Cores plate for the core "+", the Power control plate for its bay,
 * else the empty slot's plate (site, GPU picker, server or rack configuration). The id stays the "+"'s own, so
 * the plate anchors to it and a second tap closes it.
 */
export function addDetail(t: HitTarget): HitTarget {
  if (t.id === 'add:core' && t.unit?.kind === 'system')
    return { ...t, kind: 'part', part: { unit: t.unit, slot: { kind: 'core', socket: 0, index: t.slot ?? 0 } }, rect: { ...t.rect } };
  if (t.part) return { ...t, kind: 'part', rect: { ...t.rect } };
  return { ...t, kind: 'slot', rect: { ...t.rect } };
}

/** The cheapest buildable GPU for an empty bay; with none buildable, the first model (its lock shows). */
function defaultGpu(shell: Shell, system: SystemId): Quote | null {
  const all = GPU_GENERATIONS.flatMap(generation =>
    shell.quote({ kind: 'gpuModels', system, index: null, generation }).quotes);
  const open = all.filter(q => !q.locked);
  if (!open.length) return all[0] ?? null;
  return open.reduce((a, b) => (BigInt(b.cost.split('.')[0]!) < BigInt(a.cost.split('.')[0]!) ? b : a));
}

/** The slot's default add quote, or null when the sim offers none. */
export function defaultAdd(shell: Shell, t: HitTarget, focus: LevelSnapshot): Quote | null {
  const d = addDetail(t);
  if (t.id === 'add:core') {
    const tray = shell.quote({ kind: 'tray', at: t.owner }).quotes;
    return buildOffers(focus.level, tray, null).rows.find(r => r.key === 'core')?.quote ?? null;
  }
  if (focus.level === 'system' && /^add:gpu[0-9]+$/.test(t.id)) return defaultGpu(shell, focus.systemId);
  if (focus.level === 'chip' || focus.level === 'system') {
    // A board or CPU site: its deck row's quote (RAM at the newest generation, non-ECC; a drive; a socket).
    const site = slotSite(d, focus), tray = shell.quote({ kind: 'tray', at: t.owner }).quotes;
    const row = site.row ? buildOffers(focus.level, tray, null).rows.find(r => r.key === site.row)?.quote ?? null : null;
    return row ?? primaryQuote(d, tray);
  }
  const req = plateRequest(d, focus);
  if (!req) return null;
  const quotes = shell.quote(req).quotes;
  // A server, rack or site: the first buildable configuration (the barebones tier the add quote leads with).
  return d.kind === 'slot' ? primaryQuote(d, quotes) : quotes.find(q => !q.locked) ?? quotes[0] ?? null;
}

/** One tap on a "+". */
export function tapAdd(shell: Shell, t: HitTarget): void {
  const focus = shell.store.getSnapshot().focus, q = defaultAdd(shell, t, focus);
  if (q && !q.locked && q.affordable && shell.dispatch(q.action)?.ok) {
    shell.view.dispatch({ type: 'cancel' });
    if (q.overSupply) showSupplyToast(q.overSupply);
    return;
  }
  const d = addDetail(t);
  shell.view.dispatch({ type: 'select', target: d, plate: hasPlate(d, focus) });
}
