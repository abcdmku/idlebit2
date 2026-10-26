// Click to upgrade (D15.4): what a tapped world target offers, and where its callout sits.
// Desktop docks it in the right gutter with a leader to the part; phone sits it above or below (A07).
import { LEVEL_NAMES, type LevelSnapshot, type NodeRef, type PartSlotKind, type Quote, type QuoteResult } from '../../game';
import type { HitTarget } from '../../render/core';
import { rackLetter, regionName, SLOT_TITLE, zoneLetter } from '../plates/copy';
import { changeText, type Offer, type Offers } from '../deck/offers';
import { isPowerCtl } from '../plates/targets';


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
  if (t.kind === 'port') return t.port === -1 ? 'Uplink' : 'Switch';
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
  // An empty site reads as what you'd add there ("Add queue", "Add Core 2", "Add RAM") and its deck row's offer.
  const site = t.kind === 'slot' ? slotSite(t, focus) : null;
  const siteRow = site?.row && offers ? offers.rows.find(r => r.key === site.row && r.quote) ?? null : null;
  // D31.3: the Power control slot reads its own deck row (the rack's fifth infrastructure item).
  const ctl = isPowerCtl(t) && offers ? offers.rows.find(r => r.key === 'powerCtl') ?? null : null;
  const row = siteRow ?? ctl ?? (kind && offers ? offers.rows.find(r => r.slot === kind) ?? null : null);
  if (site && siteRow) {
    // The deck row says "Add RAM" with no change; here the effect line shows what the add gives ("0 → 2 slots").
    offer = siteRow; change = siteRow.quote?.effect ? changeText(siteRow.quote.effect) : siteRow.change;
  } else if (row) {
    offer = row; change = row.change;
    name = row.name.replace(/^Add /, '');
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
  // Locked grammar (A07): the title is what you get, line 2 what it needs, the key opens it.
  if (research) change = `Needs research: ${research}`;
  return { name, change, offer, research, drill };
}
