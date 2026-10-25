// What the deck can buy: the build rows, the one Buy button and the callout all read offers built
// from quotes. Prices, locks and effects come from the sim; this file only words them ("x → x").
import type { EffectPreview, LevelId, NodeRef, Quote, QuoteRequest } from '../../game';
import type { PartIconKind } from '../art/deckArt';
import { quantity } from '../plates/format';

export interface Offer {
  readonly key: string;
  readonly icon: PartIconKind;
  readonly name: string;
  /** "1 → 2 bits", or the fixed value of a link that upgrades elsewhere ("1 kHz"). */
  readonly change: string;
  /** The quote a Buy dispatches; null when nothing is offered here yet. */
  readonly quote: Quote | null;
  /** Whole Credits, or null when locked or not for sale. */
  readonly price: number | null;
  readonly affordable: boolean;
  /** "Needs Dual core", "Max", "Upgrade at the Rack switch". */
  readonly lock: string | null;
  /** A link fixed until a structure exists: the lock says where it upgrades (D15.5). */
  readonly where: boolean;
}

interface RowDef { readonly key: string; readonly icon: PartIconKind; readonly name: string }
const row = (key: string, icon: PartIconKind, name: string): RowDef => ({ key, icon, name });

/** The four tray rows in `quote({ kind: 'tray' })` order (R13), then the level's inbound link. */
export const ROWS: Readonly<Record<LevelId, readonly [RowDef, RowDef, RowDef, RowDef, RowDef]>> = {
  chip: [row('core', 'core', 'Cores'), row('cache', 'cache', 'Cache'), row('clock', 'clock', 'Clock'), row('scheduler', 'queue', 'Queue'), row('link', 'pipe', 'Pipe')],
  system: [row('cpu', 'cpu', 'CPU'), row('ram', 'ram', 'RAM'), row('gpu', 'gpu', 'GPU'), row('storage', 'stor', 'Storage'), row('link', 'pipe', 'Pipe')],
  rack: [row('rackCooler', 'cool', 'Cooling'), row('pdu', 'power', 'Power'), row('lb', 'lb', 'Balancer'), row('switch', 'switch', 'Switch'), row('link', 'pipe', 'Uplink')],
  room: [row('roomSwitch', 'switch', 'Net rack'), row('row', 'rack', 'Rows'), row('roomCooler', 'cool', 'Cooling'), row('ups', 'power', 'Power'), row('link', 'pipe', 'Fiber')],
  global: [row('site', 'site', 'Sites'), row('backbone', 'pipe', 'Backbone'), row('globalScheduler', 'lb', 'Scheduler'), row('zone', 'rack', 'Zones'), row('link', 'pipe', 'Links')],
};

const UNIT: Readonly<Record<EffectPreview['unit'], string>> = {
  'ops/s': 'ops/s', bits: 'bits', 'bit/s': 'Hz', W: 'W', 'tasks/s': 'tasks/s', lanes: 'lanes', slots: 'slots', ports: 'ports', ops: 'ops',
};

/** One measurement: "1 bit", "4,096 bits", "1.5 kHz", "4 slots". */
export function measure(n: number, unit: EffectPreview['unit']): string {
  const u = UNIT[unit];
  if (u === 'bits') return n === 1 ? '1 bit' : n < 10_000 ? `${n.toLocaleString('en-US')} bits` : quantity(n, 'b');
  if (u === 'lanes' || u === 'slots' || u === 'ports') return `${Math.round(n)} ${u}`;
  return quantity(n, u);
}

/** "1 → 2 bits": the unit once, unless the prefix changes ("999 Hz → 1.5 kHz"). */
export function changeText(e: EffectPreview, clockHz = false): string {
  const unit = clockHz && e.unit === 'ops/s' ? 'bit/s' : e.unit;
  const a = measure(e.capacityBefore, unit), b = measure(e.capacityAfter, unit);
  const ia = a.indexOf(' '), ib = b.indexOf(' ');
  const ua = a.slice(ia + 1), ub = b.slice(ib + 1);
  return ia > 0 && (ua === ub || ub === `${ua}s`) ? `${a.slice(0, ia)} → ${b}` : `${a} → ${b}`;
}

/** The inbound link's next step and structure lock, at every level (R43). */
export function linkRequest(at: NodeRef): QuoteRequest {
  return { kind: 'inbound', at };
}

const whole = (cost: string) => Math.ceil(Number(cost));

function offerOf(def: RowDef, q: Quote | undefined): Offer {
  if (!q) return { ...def, change: '—', quote: null, price: null, affordable: false, lock: null, where: false };
  if (def.key === 'link') {
    const where = q.locked?.code === 'research', e = q.effect;
    return { ...def, change: e ? (where ? measure(e.capacityBefore, e.unit) : changeText(e)) : q.label,
      quote: q, price: q.locked ? null : whole(q.cost), affordable: !q.locked && q.affordable, lock: q.locked?.text ?? null, where };
  }
  const change = q.effect ? changeText(q.effect, def.key === 'clock') : q.label;
  const credits = q.currency === 'credits';
  return { ...def, change, quote: q, price: q.locked || !credits ? null : whole(q.cost),
    affordable: !q.locked && credits && q.affordable, lock: q.locked?.text ?? null, where: false };
}

export interface Offers {
  readonly rows: readonly [Offer, Offer, Offer, Offer, Offer];
  /** The Buy button: the cheapest affordable offer, else the cheapest priced one. */
  readonly next: Offer | null;
  /** Index into `rows` of the cheapest affordable offer (gold bar), or -1. */
  readonly best: number;
}

/**
 * Build the five rows from tray quotes (4, R13 order) and the inbound link quote.
 * Every effect comes from the quote that supplies the price and action (R42/R43).
 */
export function buildOffers(level: LevelId, tray: readonly Quote[] | null, link: Quote | null): Offers {
  const defs = ROWS[level];
  const rows = defs.map((d, i) => offerOf(d, i < 4 ? tray?.[i] : link ?? undefined)) as unknown as Offers['rows'];
  let best = -1, cheapest = -1;
  rows.forEach((o, i) => {
    if (o.price === null || o.price <= 0) return;
    if (cheapest < 0 || o.price < rows[cheapest]!.price!) cheapest = i;
    if (o.affordable && (best < 0 || o.price < rows[best]!.price!)) best = i;
  });
  const pick = best >= 0 ? best : cheapest;
  return { rows, next: pick >= 0 ? rows[pick]! : null, best };
}
