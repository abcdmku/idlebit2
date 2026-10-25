// Click to upgrade (D15.4): what a tapped world target offers, and where its callout sits.
// The callout sits beside the target, never over it (L2 calloutRect).
import { LEVEL_NAMES, type LevelSnapshot, type NodeRef, type Quote, type QuoteResult } from '../../game';
import type { HitTarget, Rect } from '../../render/core';
import { rackLetter, SLOT_TITLE, zoneLetter } from '../plates/copy';
import { changeText, type Offer, type Offers } from '../deck/offers';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Right of the target if there is room, else left, level with it; with no room either side (phone),
 * above it, else below. Every edge lands on the lattice; the callout stays inside `bounds`.
 */
export function placeCallout(t: Rect, size: { w: number; h: number }, bounds: Rect, lat: number): Rect {
  const { w, h } = size, top = bounds.y, bottom = bounds.y + bounds.h, left = bounds.x, right = bounds.x + bounds.w;
  const xr = Math.ceil((t.x + t.w + lat) / lat) * lat, xl = Math.floor((t.x - lat - w) / lat) * lat;
  let x: number | null = null, y: number;
  if (xr + w <= right) x = xr; else if (xl >= left) x = xl;
  if (x !== null) y = clamp(Math.round((t.y + t.h / 2 - h / 2) / lat) * lat, top, bottom - h);
  else {
    x = clamp(Math.round((t.x + t.w / 2 - w / 2) / lat) * lat, left, right - w);
    y = Math.floor((t.y - lat - h) / lat) * lat;
    if (y < top) y = Math.ceil((t.y + t.h + lat) / lat) * lat;
    y = clamp(y, top, bottom - h);
  }
  return { x, y, w, h };
}

/** A unit a target opens: "System 1", "Rack B", "AZ a". */
export function nodeName(ref: NodeRef, focus: LevelSnapshot): string {
  switch (ref.level) {
    case 'chip': return 'CPU';
    case 'system': return `System ${ref.id + 1}`;
    case 'rack': return `Rack ${rackLetter(ref.id)}`;
    case 'room': return focus.level === 'global' ? `Room ${ref.id + 1}` : `AZ ${zoneLetter(focus.level === 'room' ? focus.zone : 0)}`;
    case 'global': return LEVEL_NAMES.global;
  }
}

export function targetName(t: HitTarget, focus: LevelSnapshot): string {
  if (t.drill && (t.kind === 'child' || t.kind === 'unit')) return nodeName(t.drill, focus);
  if (t.kind === 'port') return t.port === -1 ? 'Uplink' : `Port ${(t.port ?? 0) + 1}`;
  if (t.kind === 'slot') return 'Empty slot';
  if (t.kind === 'unit' && t.unit) return t.unit.kind === 'system' ? `System ${t.unit.id + 1}` : t.unit.kind === 'rack' ? `Rack ${rackLetter(t.unit.id)}` : 'Unit';
  if (t.part) return t.part.slot.kind === 'core' ? `Core ${t.part.slot.index + 1}` : SLOT_TITLE[t.part.slot.kind];
  return LEVEL_NAMES[t.owner.level];
}

/** The callout's one buy among a plate's quotes: the hot upgrade, the tapped port's step, the first addable unit. */
export function primaryQuote(t: HitTarget, quotes: readonly Quote[]): Quote | null {
  if (t.kind === 'port') {
    const port = t.port ?? 0;
    return quotes.find(q => port === -1 ? q.action.type === 'upgradeUplink' : q.action.type === 'upgradePort' && q.action.port === port) ?? null;
  }
  if (t.kind === 'slot') return quotes.find(q => (q.action.type === 'addUnit' || q.action.type === 'addPart' || q.action.type === 'installGpu') && !q.locked)
    ?? quotes.find(q => q.action.type === 'addUnit' || q.action.type === 'addPart') ?? null;
  return quotes.find(q => q.action.type === 'upgradePart' || q.action.type === 'upgradePort') ?? null;
}

export interface CalloutModel {
  readonly name: string;
  /** "1 → 2 bits", the lock, or a blank line. */
  readonly change: string;
  readonly offer: Pick<Offer, 'quote' | 'price' | 'affordable' | 'lock' | 'where'> | null;
  /** Open: drill into this unit. */
  readonly drill: NodeRef | null;
}

/**
 * What the callout shows for a target: a core reads the deck's Cores row (cores are added, not
 * upgraded); every other target reads its plate quotes.
 */
export function calloutModel(t: HitTarget, focus: LevelSnapshot, quotes: QuoteResult | null, offers: Offers | null): CalloutModel {
  const name = targetName(t, focus), drill = t.drill;
  if (t.part?.slot.kind === 'core' && offers) {
    const o = offers.rows.find(r => r.key === 'core') ?? null;
    return { name, change: o?.change ?? '', offer: o, drill };
  }
  const q = quotes ? primaryQuote(t, quotes.quotes) : null;
  if (!q) return { name, change: '', offer: null, drill };
  const credits = q.currency === 'credits';
  return { name, change: q.effect ? changeText(q.effect, t.part?.slot.kind === 'clock') : q.label, drill,
    offer: { quote: q, price: q.locked || !credits ? null : Math.ceil(Number(q.cost)), affordable: !q.locked && credits && q.affordable,
      lock: q.locked?.text ?? null, where: false } };
}
