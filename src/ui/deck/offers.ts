// What the deck can buy: the build rows, the one Buy key and the callouts all read one offer list
// built from quotes (A08). Prices, locks and effects come from the sim; this file only words them,
// in one grammar (A14): name · change · a right column (price, "Needs <node>", "Max" or "At <place>").
import type { EffectPreview, FailDetail, LevelId, NodeRef, PartSlotKind, Quote, QuoteRequest, RackId, RoomId } from '../../game';
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
  /** The sim's lock copy, including research and fit reasons. */
  readonly lock: string | null;
  /** A link fixed until a structure exists: the lock says where it upgrades (D15.5). */
  readonly where: boolean;
  readonly right: OfferRight;
}

export interface RowDef { readonly key: string; readonly icon: PartIconKind; readonly name: string; readonly slot: PartSlotKind | null }
const row = (key: string, icon: PartIconKind, name: string, slot: PartSlotKind | null = null): RowDef => ({ key, icon, name, slot });

/** The four tray rows in `quote({ kind: 'tray' })` order (R13), then the level's inbound link. */
export const ROWS: Readonly<Record<LevelId, readonly RowDef[]>> = {
  chip: [row('core', 'core', 'Core', 'core'), row('cache', 'cache', 'Cache'), row('clock', 'clock', 'Clock', 'clock'),
    row('scheduler', 'queue', 'Scheduler', 'scheduler')],
  system: [row('cpu', 'cpu', 'CPU'), row('ram', 'ram', 'RAM'), row('gpu', 'gpu', 'GPU'), row('storage', 'stor', 'Storage')],
  rack: [row('rackCooler', 'cool', 'Cooling', 'rackCooler'), row('pdu', 'power', 'Power', 'pdu'), row('lb', 'lb', 'Balancer'),
    row('switch', 'switch', 'Switch'), row('link', 'pipe', 'Uplink')],
  room: [row('roomSwitch', 'switch', 'Net rack'), row('row', 'rack', 'Rows'), row('roomCooler', 'cool', 'Cooling', 'roomCooler'),
    row('ups', 'power', 'Power'), row('link', 'pipe', 'Fiber')],
  global: [row('site', 'site', 'Sites'), row('backbone', 'pipe', 'Backbone'), row('globalScheduler', 'lb', 'Scheduler'),
    row('zone', 'rack', 'Zones'), row('link', 'pipe', 'Links')],
};

/**
 * What a level sells beyond the tray, each from its own quote (A08): the System's PSU, the rack's
 * Power control (D31.3, its fifth infrastructure slot), and each router's queue (D25.7), which is what
 * tapping the load balancer offers. At most two per level.
 */
export const EXTRA_ROWS: Readonly<Partial<Record<LevelId, readonly RowDef[]>>> = {
  system: [],
  rack: [row('powerCtl', 'power', 'Power control'), row('lbQueue', 'lb', 'LB queue', 'lb')],
  room: [row('lbQueue', 'lb', 'LB queue', 'roomLb'), row('roomStart', 'power', 'Start control')],
  global: [row('lbQueue', 'lb', 'Scheduler queue', 'globalScheduler'), row('globalStart', 'power', 'Start control')],
};

/**
 * The quote an extra row sells: its upgrade (or the router queue's next slot); with none, an empty D31
 * part's first buildable install (`replacePart` from nothing), never a configuration.
 */
export function extraOffer(quotes: readonly Quote[] | undefined): Quote | null {
  if (!quotes) return null;
  const up = quotes.find(q => q.action.type === 'upgradePart' || q.action.type === 'upgradeRouterQueue');
  if (up) return up;
  const installs = quotes.filter(q => q.action.type === 'replacePart');
  return installs.find(q => !q.locked) ?? installs[0] ?? null;
}

/** The part quote request behind an extra row at `at`. */
export function extraRequest(at: NodeRef, def: RowDef): QuoteRequest | null {
  if (at.level === 'system' && def.slot === 'psu') return { kind: 'part', part: { unit: { kind: 'system', id: at.id }, slot: { kind: 'psu' } } };
  // D31: each scope's optional power part (rack Power control, room and global start controllers).
  if (at.level === 'rack' && def.key === 'powerCtl') return { kind: 'power', unit: { kind: 'rack', id: at.id as RackId } };
  if (at.level === 'room' && def.key === 'roomStart') return { kind: 'power', unit: { kind: 'room', id: at.id as RoomId } };
  if (at.level === 'global' && def.key === 'globalStart') return { kind: 'power', unit: { kind: 'global' } };
  if (def.key === 'lbQueue') {
    if (at.level === 'rack') return { kind: 'routerQueue', unit: { kind: 'rack', id: at.id } };
    if (at.level === 'room') return { kind: 'routerQueue', unit: { kind: 'room', id: at.id } };
    if (at.level === 'global') return { kind: 'routerQueue', unit: { kind: 'global' } };
  }
  return null;
}

const COUNTS: ReadonlySet<string> = new Set(['slots', 'cores', 'ports']);

/** One measurement through the shared formatters: "1 b", "21.4 kb", "1.5 kHz", "4 slots". */
export const measure = (n: number, unit: EffectPreview['unit']): string => measureUnit(n, unit);

/** "1 → 2 b": the unit once, unless the prefix changes ("999 Hz → 1.5 kHz"). */
export function changeText(e: EffectPreview): string {
  const a = measure(e.capacityBefore, e.unit), b = measure(e.capacityAfter, e.unit);
  const ia = a.indexOf(' '), ib = b.indexOf(' ');
  const ua = a.slice(ia + 1), ub = b.slice(ib + 1);
  return ia > 0 && ua.replace(/s$/, "") === ub.replace(/s$/, "") ? `${a.slice(0, ia)} → ${b}` : `${a} → ${b}`;
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
  // A first add reads "Add …": a count from 0, or a card into a free bay (QA-15: never "GPU 0 → …" beside an installed card).
  const e = q.effect, first = (!!e && e.capacityBefore === 0 && (COUNTS.has(e.unit) || q.action.type === 'replacePart')) || (q.action.type === 'installGpu' && q.action.index === null);
  const credits = q.currency === 'credits', price = q.locked || !credits ? null : whole(q.cost);
  // At the top of a ladder the step is a no-op: show where it stands ("32 slots"), not "32 → 32".
  // A first add keeps its "Add RAM" name and shows what it gives ("0 → 2 slots"), as the board does (user).
  // A start controller's upgrade has no capacity effect (D31): its level step, from the quote's "… · level 3".
  const step = !e && q.action.type === 'upgradePart' ? /· L([0-9]+)$/.exec(q.label) : null;
  const maxed = q.locked?.code === 'ceiling' || q.locked?.code === 'cap';
  // At Max a row says only where it stands (QA-08): never a next level beside "Max".
  const change = maxed ? (e ? measure(e.capacityBefore, e.unit) : '')
    : step ? `L${Number(step[1]) - 1} → L${step[1]}` : !e ? q.label : e.capacityBefore === e.capacityAfter ? measure(e.capacityBefore, e.unit) : changeText(e);
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
}

/** Context for the deck's featured offer. */
export interface OfferContext {
  /** Row keys that answer the current wall (the head's block, else last round's top failure), best first (QA-05). */
  readonly wall?: readonly string[];
  /** Supply rows drawing near their limit; other supply upgrades are never featured (QA-05). */
  readonly supplyNear?: ReadonlySet<string>;
}

/** What answers a failure or a block: the rows that would let the work run (A02, QA-05). */
export const WALL_ROWS: Readonly<Partial<Record<FailDetail, readonly string[]>>> = {
  cache: ['cache'], ram: ['ram', 'storage'], disk: ['ram', 'storage'], ecc: ['ram'], gpu: ['gpu'], gpuCores: ['gpu'], vram: ['gpu'], link: ['link'],
  psu: ['psu'], pdu: ['pdu'], ups: ['ups'], rack: ['rackCooler'], room: ['roomCooler'],
};
/** Supplies and coolers: worth buying only near their limit. */
export const SUPPLY_ROWS: ReadonlySet<string> = new Set(['psu', 'pdu', 'ups', 'rackCooler', 'roomCooler']);
/** A row a suggestion may point at: something to buy, or research that opens it; never Max or a dead lock. */
export const actionable = (o: Offer) => !!o.quote && (o.right.kind === 'price' || o.right.kind === 'research') && !(o.price !== null && o.price <= 0);

/**
 * Build the rows from tray quotes (4, R13 order), the inbound link quote and any extra part quotes.
 * Every effect comes from the quote that supplies the price and action (R42/R43).
 */
export function buildOffers(level: LevelId, tray: readonly Quote[] | null, link: Quote | null, extras: readonly (Quote | null)[] = [],
  ctx: OfferContext = {}): Offers {
  const defs = ROWS[level], more = EXTRA_ROWS[level] ?? [];
  const rows = [...defs.map((d, i) => offerOf(d, i < 4 ? tray?.[i] : link ?? undefined)), ...more.map((d, i) => offerOf(d, extras[i] ?? undefined))]
    .filter((o): o is Offer => o !== null);
  // The featured buy (QA-05): what answers the wall first (saving up for it if need be), then the cheapest
  // affordable, then the cheapest. Supplies only when they run near their limit.
  const wall = ctx.wall ?? [];
  const usable = (o: Offer) => o.price !== null && o.price > 0 && (!SUPPLY_ROWS.has(o.key) || !!ctx.supplyNear?.has(o.key) || wall.includes(o.key));
  let best = -1, cheapest = -1, walled = -1;
  rows.forEach((o, i) => {
    if (!usable(o)) return;
    const w = wall.indexOf(o.key);
    if (w >= 0 && (walled < 0 || w < wall.indexOf(rows[walled]!.key))) walled = i;
    if (cheapest < 0 || o.price! < rows[cheapest]!.price!) cheapest = i;
    if (o.affordable && (best < 0 || o.price! < rows[best]!.price!)) best = i;
  });
  const pick = walled >= 0 ? walled : best >= 0 ? best : cheapest;
  const research = rows.filter(o => o.right.kind === 'research' && o.quote?.locked?.node);
  const unlock = pick >= 0 ? null : research.find(o => wall.includes(o.key)) ?? research[0] ?? null;
  return { rows, next: pick >= 0 ? rows[pick]! : null, best, unlock };
}
