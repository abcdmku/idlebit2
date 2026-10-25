// What the deck can buy: the build rows, the one Buy key and the callouts all read one offer list
// built from quotes (A08). Prices, locks and effects come from the sim; this file only words them,
// in one grammar (A14): name · change · a right column (price, "Research: <node>", "Max" or "At <place>").
import type { EffectPreview, LevelId, NodeRef, PartSlotKind, Quote, QuoteRequest } from '../../game';
import type { PartIconKind } from '../art/deckArt';
import { measureUnit } from '../plates/format';

/** The right column of a row: what a tap does, or why it can't. */
export type OfferRight =
  | { readonly kind: 'price' }
  | { readonly kind: 'research'; readonly node: string }
  | { readonly kind: 'max' }
  | { readonly kind: 'at'; readonly place: string }
  | { readonly kind: 'lock'; readonly text: string }
  | { readonly kind: 'none' };

export interface Offer {
  readonly key: string;
  readonly icon: PartIconKind;
  /** The board's label ("Cache"), or "Add RAM" for a first one. */
  readonly name: string;
  /** The world part this row upgrades, so a tapped part reads the same offer. */
  readonly slot: PartSlotKind | null;
  /** "1 → 2 bits", or the fixed value of a link that upgrades elsewhere ("1 kHz"); empty for a first add. */
  readonly change: string;
  /** The quote a Buy dispatches; null when nothing is offered here yet. */
  readonly quote: Quote | null;
  /** Whole Credits, or null when locked or not for sale. */
  readonly price: number | null;
  readonly affordable: boolean;
  /** The sim's lock copy: "Needs Dual core", "Max", "Upgrade at the Rack switch". */
  readonly lock: string | null;
  /** A link fixed until a structure exists: the lock says where it upgrades (D15.5). */
  readonly where: boolean;
  readonly right: OfferRight;
}

export interface RowDef { readonly key: string; readonly icon: PartIconKind; readonly name: string; readonly slot: PartSlotKind | null }
const row = (key: string, icon: PartIconKind, name: string, slot: PartSlotKind | null = null): RowDef => ({ key, icon, name, slot });

/** The four tray rows in `quote({ kind: 'tray' })` order (R13), then the level's inbound link. */
export const ROWS: Readonly<Record<LevelId, readonly [RowDef, RowDef, RowDef, RowDef, RowDef]>> = {
  chip: [row('core', 'core', 'Cores', 'core'), row('cache', 'cache', 'Cache', 'l1'), row('clock', 'clock', 'Clock', 'clock'),
    row('scheduler', 'queue', 'Queue', 'scheduler'), row('link', 'pipe', 'Pipe')],
  system: [row('cpu', 'cpu', 'CPU'), row('ram', 'ram', 'RAM'), row('gpu', 'gpu', 'GPU'), row('storage', 'stor', 'Storage'), row('link', 'pipe', 'Pipe')],
  rack: [row('rackCooler', 'cool', 'Cooling', 'rackCooler'), row('pdu', 'power', 'Power', 'pdu'), row('lb', 'lb', 'Balancer'),
    row('switch', 'switch', 'Switch'), row('link', 'pipe', 'Uplink')],
  room: [row('roomSwitch', 'switch', 'Net rack'), row('row', 'rack', 'Rows'), row('roomCooler', 'cool', 'Cooling', 'roomCooler'),
    row('ups', 'power', 'Power'), row('link', 'pipe', 'Fiber')],
  global: [row('site', 'site', 'Sites'), row('backbone', 'pipe', 'Backbone'), row('globalScheduler', 'lb', 'Scheduler'),
    row('zone', 'rack', 'Zones'), row('link', 'pipe', 'Links')],
};

/**
 * What a level sells beyond the tray, each from its own quote (A08): the System's PSU, and each
 * router's queue (D25.7), which is what tapping the load balancer offers.
 */
export const EXTRA_ROWS: Readonly<Partial<Record<LevelId, readonly RowDef[]>>> = {
  system: [row('psu', 'power', 'PSU', 'psu')],
  rack: [row('lbQueue', 'lb', 'LB queue', 'lb')],
  room: [row('lbQueue', 'lb', 'LB queue', 'roomLb')],
  global: [row('lbQueue', 'lb', 'Scheduler queue', 'globalScheduler')],
};

/** The part quote request behind an extra row at `at`. */
export function extraRequest(at: NodeRef, def: RowDef): QuoteRequest | null {
  if (at.level === 'system' && def.slot === 'psu') return { kind: 'part', part: { unit: { kind: 'system', id: at.id }, slot: { kind: 'psu' } } };
  if (def.key === 'lbQueue') {
    if (at.level === 'rack') return { kind: 'routerQueue', unit: { kind: 'rack', id: at.id } };
    if (at.level === 'room') return { kind: 'routerQueue', unit: { kind: 'room', id: at.id } };
    if (at.level === 'global') return { kind: 'routerQueue', unit: { kind: 'global' } };
  }
  return null;
}

const COUNTS: ReadonlySet<string> = new Set(['lanes', 'slots', 'cores', 'ports']);

/** One measurement through the shared formatters: "1 b", "21.4 kb", "1.5 kHz", "4 slots". */
export const measure = (n: number, unit: EffectPreview['unit']): string => measureUnit(n, unit);

/** "1 → 2 b": the unit once, unless the prefix changes ("999 Hz → 1.5 kHz"). */
export function changeText(e: EffectPreview): string {
  const a = measure(e.capacityBefore, e.unit), b = measure(e.capacityAfter, e.unit);
  const ia = a.indexOf(' '), ib = b.indexOf(' ');
  const ua = a.slice(ia + 1), ub = b.slice(ib + 1);
  return ia > 0 && (ua === ub || ub === `${ua}s`) ? `${a.slice(0, ia)} → ${b}` : `${a} → ${b}`;
}

/** The inbound link's next step and structure lock, at every level (R43). */
export function linkRequest(at: NodeRef): QuoteRequest {
  return { kind: 'inbound', at };
}

const whole = (cost: string) => Math.ceil(Number(cost));
/** A quote the sim can't price at all ("No such part"): the row is hidden, never shown as copy. */
const invalid = (q: Quote) => q.locked?.code === 'fit' && /^No such/.test(q.locked.text);

function rightOf(q: Quote | null, price: number | null, where: boolean): OfferRight {
  if (!q) return { kind: 'none' };
  const lock = q.locked;
  if (!lock) return price !== null ? { kind: 'price' } : { kind: 'none' };
  if (where || /^Upgrade at /.test(lock.text)) return { kind: 'at', place: lock.text.replace(/^Upgrade at /, '') };
  if (lock.code === 'research') return { kind: 'research', node: lock.text.replace(/^Needs /, '') };
  if (lock.code === 'ceiling' || lock.code === 'cap') return { kind: 'max' };
  return { kind: 'lock', text: lock.text };
}

/** One row, or null when the sim has no valid quote for it (hidden). */
export function offerOf(def: RowDef, q: Quote | undefined, link = def.key === 'link'): Offer | null {
  // No quote yet (still loading): a placeholder keeps the row in place.
  if (!q) return { ...def, change: '—', quote: null, price: null, affordable: false, lock: null, where: false, right: { kind: 'none' } };
  if (invalid(q)) return null;
  if (link) {
    const where = q.locked?.code === 'research', e = q.effect, price = q.locked ? null : whole(q.cost);
    return { ...def, change: e ? (where ? measure(e.capacityBefore, e.unit) : changeText(e)) : q.label,
      quote: q, price, affordable: !q.locked && q.affordable, lock: q.locked?.text ?? null, where, right: rightOf(q, price, where) };
  }
  const e = q.effect, first = !!e && COUNTS.has(e.unit) && e.capacityBefore === 0;
  const credits = q.currency === 'credits', price = q.locked || !credits ? null : whole(q.cost);
  // At the top of a ladder the step is a no-op: show where it stands ("32 slots"), not "32 → 32".
  // A first add keeps its "Add RAM" name and shows what it gives ("0 → 2 slots"), as the board does (user).
  const change = !e ? q.label : e.capacityBefore === e.capacityAfter ? measure(e.capacityBefore, e.unit) : changeText(e);
  return { ...def, name: first ? `Add ${def.name}` : def.name, change,
    quote: q, price, affordable: !q.locked && credits && q.affordable, lock: q.locked?.text ?? null, where: false, right: rightOf(q, price, false) };
}

export interface Offers {
  /** The tray rows, the inbound link, then the level's other parts; hidden rows dropped. Order never changes. */
  readonly rows: readonly Offer[];
  /** The Buy key: the cheapest affordable offer, else the cheapest priced one. */
  readonly next: Offer | null;
  /** Index into `rows` of the cheapest affordable offer (gold bar), or -1. */
  readonly best: number;
  /** With nothing priced: the first research that opens a row ("Next: Dual socket · research"). */
  readonly unlock: Offer | null;
  /** Chip: each installed core's own upgrade (the tray quotes after the four primary ones), by core index. */
  readonly cores: readonly (Offer | null)[];
}

/** What the deck needs from the level beyond quotes: the chip's cache level count (to name the level). */
export interface OfferContext { readonly cacheLevels: number }

/** The quote's part slot, when it upgrades a part. */
const slotOf = (q: Quote | undefined): PartSlotKind | null => (q?.action.type === 'upgradePart' ? q.action.part.slot.kind : null);
/** "Cache" on a one-level CPU; with more levels the row names the level its quote upgrades: "L2 cache". */
function cacheRow(def: RowDef, q: Quote | undefined, levels: number): RowDef {
  const slot = slotOf(q);
  return slot ? { ...def, slot, name: levels > 1 ? `${slot.toUpperCase()} cache` : def.name } : def;
}

/**
 * Build the rows from tray quotes (4, R13 order), the inbound link quote and any extra part quotes.
 * Every effect comes from the quote that supplies the price and action (R42/R43).
 */
export function buildOffers(level: LevelId, tray: readonly Quote[] | null, link: Quote | null, extras: readonly (Quote | null)[] = [],
  ctx: OfferContext = { cacheLevels: 1 }): Offers {
  const defs = ROWS[level], more = EXTRA_ROWS[level] ?? [];
  const def = (d: RowDef, i: number) => (d.key === 'cache' ? cacheRow(d, tray?.[i], ctx.cacheLevels) : d);
  const rows = [...defs.map((d, i) => offerOf(def(d, i), i < 4 ? tray?.[i] : link ?? undefined)), ...more.map((d, i) => offerOf(d, extras[i] ?? undefined))]
    .filter((o): o is Offer => o !== null);
  let best = -1, cheapest = -1;
  rows.forEach((o, i) => {
    if (o.price === null || o.price <= 0) return;
    if (cheapest < 0 || o.price < rows[cheapest]!.price!) cheapest = i;
    if (o.affordable && (best < 0 || o.price < rows[best]!.price!)) best = i;
  });
  const pick = best >= 0 ? best : cheapest;
  const unlock = pick >= 0 ? null : rows.find(o => o.right.kind === 'research' && o.quote?.locked?.node) ?? null;
  const cores = level === 'chip' ? (tray ?? []).slice(4).map((q, i) => offerOf(row(`core${i}`, 'core', `Core ${i + 1}`, 'core'), q)) : [];
  return { rows, next: pick >= 0 ? rows[pick]! : null, best, unlock, cores };
}
