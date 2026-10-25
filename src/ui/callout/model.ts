// Click to upgrade (D15.4): what a tapped world target offers, and where its callout sits.
// Desktop docks it in the right gutter with a leader to the part; phone sits it above or below (A07).
import { formatHertz, LEVEL_NAMES, type LevelSnapshot, type NodeRef, type PartSlotKind, type Quote, type QuoteResult } from '../../game';
import type { HitTarget, Rect } from '../../render/core';
import { rackLetter, regionName, SLOT_TITLE, zoneLetter } from '../plates/copy';
import { changeText, type Offer, type Offers } from '../deck/offers';
import { isPowerCtl } from '../plates/targets';

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

/** What an empty site adds, from the renderer's stable target id, and the deck row that sells it. */
const SITE_PART: Readonly<Record<string, { label: string; row: string | null }>> = {
  cpu: { label: 'CPU', row: 'cpu' }, ram: { label: 'RAM', row: 'ram' }, gpu: { label: 'GPU', row: 'gpu' },
  drive: { label: 'Storage', row: 'storage' }, storage: { label: 'Storage', row: 'storage' }, psu: { label: 'PSU', row: 'psu' },
};
export function slotSite(t: HitTarget, focus: LevelSnapshot): { name: string; row: string | null } {
  if (focus.level === 'chip') {
    if (t.id === 'queue') return { name: 'Add queue', row: 'scheduler' };
    const core = /^site([0-9]+)$/.exec(t.id);
    if (core) return { name: `Add Core ${Number(core[1]) + 1}`, row: 'core' };
  }
  const board = /^slot-([a-z]+)[0-9]*$/.exec(t.id), part = board ? SITE_PART[board[1]!] : undefined;
  if (part) return { name: `Add ${part.label}`, row: part.row };
  return { name: focus.level === 'rack' ? 'Add server' : focus.level === 'room' ? 'Add rack' : focus.level === 'global' ? 'Add site' : 'Add part', row: null };
}

/** The board's own labels where they differ from the plate titles (A07). */
const BOARD_NAME: Partial<Record<PartSlotKind, string>> = { l1: 'Cache', scheduler: 'Queue' };

export function targetName(t: HitTarget, focus: LevelSnapshot): string {
  if (isPowerCtl(t)) return 'Power control';
  const site = t.unit?.kind === 'site' && focus.level === 'global' ? focus.sites.find(s => s.siteId === t.unit!.id) : undefined;
  if (site) return regionName(site.region);
  if (t.drill && (t.kind === 'child' || t.kind === 'unit')) return nodeName(t.drill, focus);
  if (t.kind === 'port') return t.port === -1 ? 'Uplink' : `Port ${(t.port ?? 0) + 1}`;
  if (t.kind === 'slot') return slotSite(t, focus).name;
  if (t.kind === 'unit' && t.unit) return t.unit.kind === 'system' ? `System ${t.unit.id + 1}` : t.unit.kind === 'rack' ? `Rack ${rackLetter(t.unit.id)}` : 'Unit';
  if (t.part) {
    const k = t.part.slot.kind;
    if (k === 'core') return `Core ${(t.part.slot as { index: number }).index + 1}`;
    // One cache level reads "Cache", as on the board; several name their level ("L2 cache").
    if ((k === 'l1' || k === 'l2' || k === 'l3') && focus.level === 'chip' && focus.cache.levels.length > 1) return SLOT_TITLE[k];
    return BOARD_NAME[k] ?? SLOT_TITLE[k];
  }
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
  /** What the part is, or for a research-locked add, what you get ("Add Core 2"). */
  readonly name: string;
  /** "1 → 2 bits", "Needs research: Dual core", or a blank line. */
  readonly change: string;
  readonly offer: Pick<Offer, 'quote' | 'price' | 'affordable' | 'lock' | 'where'> | null;
  /** The research that opens this offer, when that is what stands in the way. */
  readonly research: string | null;
  /** Open: drill into this unit. */
  readonly drill: NodeRef | null;
}

/**
 * What the callout shows for a target. A part the deck lists reads the deck's own row, so the
 * world and the deck always agree (A08); every other target reads its plate quotes.
 */
export function calloutModel(t: HitTarget, focus: LevelSnapshot, quotes: QuoteResult | null, offers: Offers | null): CalloutModel {
  const kind = t.part?.slot.kind, drill = t.drill;
  let name = targetName(t, focus), change = '', offer: CalloutModel['offer'] = null;
  // A core: an installed one reads its own upgrade and rate; an empty core site offers the next core.
  const core = t.part?.slot.kind === 'core' ? t.part.slot : null;
  const own = core && offers ? offers.cores[core.index] ?? null : null;
  // An empty site reads as what you'd add there ("Add queue", "Add Core 2", "Add RAM") and its deck row's offer.
  const site = t.kind === 'slot' ? slotSite(t, focus) : null;
  const siteRow = site?.row && offers ? offers.rows.find(r => r.key === site.row && r.quote) ?? null : null;
  // D31.3: the Power control slot reads its own deck row (the rack's fifth infrastructure item).
  const ctl = isPowerCtl(t) && offers ? offers.rows.find(r => r.key === 'powerCtl') ?? null : null;
  const row = own ?? siteRow ?? ctl ?? (kind && offers ? offers.rows.find(r => r.slot === kind) ?? null : null);
  if (site && siteRow) {
    // The deck row says "Add RAM" with no change; here the effect line shows what the add gives ("0 → 2 slots").
    offer = siteRow; change = siteRow.quote?.effect ? changeText(siteRow.quote.effect) : siteRow.change;
  } else if (row) {
    offer = row; change = row.change;
    if (own) { if (!own.quote?.effect && focus.level === 'chip') change = formatHertz(focus.clock.effectiveHz); }
    else if (core) name = `Add Core ${(offers?.cores.length ?? 0) + 1}`;
    else name = row.name.replace(/^Add /, '');
  } else {
    const q = quotes ? primaryQuote(t, quotes.quotes) : null;
    if (q) {
      const credits = q.currency === 'credits';
      change = q.effect ? changeText(q.effect) : q.label;
      offer = { quote: q, price: q.locked || !credits ? null : Math.ceil(Number(q.cost)), affordable: !q.locked && credits && q.affordable,
        lock: q.locked?.text ?? null, where: false };
    }
  }
  const lock = offer?.quote?.locked;
  // "Upgrade at the Rack switch" is a structure lock (D15.5), not research the player can start.
  const research = lock?.code === 'research' && !offer!.where && !/^Upgrade at /.test(lock.text) ? lock.text.replace(/^Needs /, '') : null;
  if (research) {
    // Locked grammar (A07): the title is what you get, line 2 what it needs, the key opens it.
    change = `Needs research: ${research}`;
  }
  return { name, change, offer, research, drill };
}

/**
 * Phone (A07): below the tapped part when there is room, else above it, else docked across the bottom
 * of the free world just above the head card. Computed from the part's own rect, so the same part
 * always gets the same place, and the part stays in view.
 */
export function placePhone(t: Rect, size: { w: number; h: number }, bounds: Rect): Rect {
  const { w, h } = size, x = clamp(Math.round((t.x + t.w / 2 - w / 2) / 8) * 8, bounds.x, bounds.x + bounds.w - w);
  const below = Math.ceil((t.y + t.h + 8) / 8) * 8, above = Math.floor((t.y - 8 - h) / 8) * 8;
  if (below + h <= bounds.y + bounds.h) return { x, y: below, w, h };
  if (above >= bounds.y) return { x, y: above, w, h };
  return { x: bounds.x, y: bounds.y + bounds.h - h, w: bounds.w, h };
}

/** Desktop (A07): the callout docks in the world's right gutter, its top level with the part's, clamped. */
export function dockCallout(t: Rect, size: { w: number; h: number }, bounds: Rect): Rect {
  const x = bounds.x + bounds.w - size.w, y = clamp(Math.round(t.y / 8) * 8, bounds.y, bounds.y + bounds.h - size.h);
  return { x, y, w: size.w, h: size.h };
}

/**
 * The leader from the part to its callout (A07), one art px thick on the art grid: horizontal when
 * the callout sits beside the part, vertical when above or below; null when they overlap.
 */
export function leaderRect(t: Rect, c: Rect, n: number): Rect | null {
  const snap = (v: number) => Math.round(v / n) * n;
  if (c.x >= t.x + t.w || c.x + c.w <= t.x) {
    const lo = Math.max(t.y, c.y + 8), hi = Math.min(t.y + t.h, c.y + c.h - 8);
    if (lo > hi) return null;
    const y = snap(clamp(t.y + Math.min(t.h / 2, 24), lo, hi)), right = c.x >= t.x + t.w;
    const x0 = snap(right ? t.x + t.w : c.x + c.w), x1 = snap(right ? c.x : t.x);
    return x1 > x0 ? { x: x0, y, w: x1 - x0, h: n } : null;
  }
  const lo = Math.max(t.x, c.x + 8), hi = Math.min(t.x + t.w, c.x + c.w - 8);
  if (lo > hi) return null;
  const x = snap(clamp(t.x + t.w / 2, lo, hi)), below = c.y >= t.y + t.h;
  const y0 = snap(below ? t.y + t.h : c.y + c.h), y1 = snap(below ? c.y : t.y);
  return y1 > y0 ? { x, y: y0, w: n, h: y1 - y0 } : null;
}
