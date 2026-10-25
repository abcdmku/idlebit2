// The CPU world (L2, D15/D17): only the CPU. Every mark is a part, a route or a real state:
// queue wells fill with waiting tasks, cache cells with held bits, cores with the piece of their
// shard still to run (D25: it drains; cores of one shard are outlined as one group), the clock lamp
// ticks with real cycles, the IN pad lights while a transfer lands. Payouts pop on the core that ran
// the task's last shard (core/pops.ts).
import { familyId } from '../../../game';
import type { ChipSnapshot, CoreView, QuoteResult, SystemId } from '../../../game';
import { P, brackets, createRateAnimation, drawFamilyIcon, rateAnimation, transferProgress } from '../../core';
import type { Rect, ViewPresentation, WorldFrame, WorldForm } from '../../core';
import { MAX_CORES, arrangementOf, coreSites, coreText, floorOf, queueWells } from './layout';
import type { CoreArrangement } from './layout';
import { coreColor, drawGridPiece, drawShardGroups, remaining } from './shards';
import { CLOCK_TRACE, bar, cacheBlock, clockBlock, coreBlock, coreGhost, drawMetal, lockedSite, pad, queueBlock, queueGhost, staticCpu } from './sprites';
import type { Incoming } from './sprites';
import { blockOf, createBlock, drawBlock } from './block';
import { dimIfAsleep } from './speed';
import type { Block } from './block';

type G = CanvasRenderingContext2D;
const cycle = createRateAnimation();
const centres: number[] = [];
const NONE: readonly never[] = [];
const incoming: Incoming = { count: 0, family: null, progress: 0 };

export function isLive(chip: ChipSnapshot, frame: WorldFrame): boolean {
  return !frame.paused && (chip.online === 'onMarket' || chip.online === 'draining');
}
export function siteCount(chip: ChipSnapshot): number {
  let locked = 0;
  for (const s of chip.slots) if (s.kind === 'core' && s.locked) locked = Math.max(locked, s.index + 1);
  return Math.max(chip.coreSites, chip.cores.length, locked);
}
export function siteLocked(chip: ChipSnapshot, i: number): boolean {
  for (const s of chip.slots) if (s.kind === 'core' && s.index === i) return s.locked;
  return i >= chip.coreSites;
}
/** No scheduler yet and its slot is open to buy. Otherwise (locked or not offered) the queue site is locked. */
export function queueOpen(chip: ChipSnapshot): boolean {
  for (const s of chip.slots) if (s.kind === 'scheduler') return !s.locked;
  return false;
}
/** D26: bits of running shards that didn't fit cache (0 until the sim sends it). */
export const spilledOut = (chip: ChipSnapshot): number => chip.cache.spilledOutBits;
export const lentCore = (c: CoreView): boolean => c.research > 0 && c.busy <= 0;
/** The first locked core site at or after the installed cores (sites before it are open to buy). */
export function firstLockedSite(chip: ChipSnapshot, n: number): number {
  for (let i = chip.cores.length; i < n; i++) if (siteLocked(chip, i)) return i;
  return n;
}
const openBlock = createBlock(), lockBlock = createBlock();
/** On a grid: the open and the locked empty sites as two blocks (A25). Empty blocks when the sites are big. */
export function emptyBlocks(chip: ChipSnapshot, sites: readonly Rect[]): { readonly open: Block; readonly locked: Block } {
  const grid = sites.length > 2, cut = firstLockedSite(chip, sites.length), from = Math.min(chip.cores.length, sites.length);
  blockOf(sites, from, grid ? cut : from, openBlock); blockOf(sites, grid ? cut : from, grid ? sites.length : from, lockBlock);
  return { open: openBlock, locked: lockBlock };
}

/**
 * Which CPU parts have an affordable, unlocked buy among the tray quotes the UI holds (A25):
 * clock, cache (any level), queue (scheduler upgrade or add), the next core site (add core), and
 * each installed core (its own upgrade, when a quote for it is present).
 */
export interface ChipAfford { clock: boolean; cache: boolean; queue: boolean; site: boolean; readonly core: boolean[] }
export const createChipAfford = (): ChipAfford => ({ clock: false, cache: false, queue: false, site: false, core: Array<boolean>(MAX_CORES).fill(false) });
export function chipAfford(quotes: QuoteResult | null, system: SystemId, out: ChipAfford): ChipAfford {
  out.clock = out.cache = out.queue = out.site = false; out.core.fill(false);
  const list = quotes?.quotes;
  if (!list) return out;
  for (let i = 0; i < list.length; i++) {
    const q = list[i]!, a = q.action;
    if (!q.affordable || q.locked) continue;
    if (a.type === 'addPart' && a.system === system) {
      if (a.kind === 'core') out.site = true; else if (a.kind === 'scheduler') out.queue = true; else if (a.kind === 'l2' || a.kind === 'l3') out.cache = true;
    } else if (a.type === 'upgradePart' && a.part.unit.kind === 'system' && a.part.unit.id === system) {
      const slot = a.part.slot;
      if (slot.kind === 'clock') out.clock = true;
      else if (slot.kind === 'l1' || slot.kind === 'l2' || slot.kind === 'l3') out.cache = true;
      else if (slot.kind === 'scheduler') out.queue = true;
      else if (slot.kind === 'core' && slot.index < out.core.length) out.core[slot.index] = true;
    }
  }
  return out;
}
const afford = createChipAfford();
/** 1 art px gold corners just outside a part whose buy is affordable: "tap me" at a glance. Static. */
const goldBracket = (g: G, r: Rect): void => brackets(g, r.x - 2, r.y - 2, r.w + 4, r.h + 4, P.gold);

/** `view` carries the tray quotes for the affordable brackets; without it none are drawn. */
export function drawWorld(g: G, chip: ChipSnapshot, frame: WorldFrame, form: WorldForm, view?: ViewPresentation | null): void {
  const f = floorOf(form), live = isLive(chip, frame), arr = arrangementOf(frame.scale, form);
  g.drawImage(staticCpu(f, form), 0, 0);
  const sites = coreSites(f, siteCount(chip)), used = Math.max(1, Math.min(sites.length, chip.cores.length));
  centres.length = 0;
  for (let i = 0; i < used; i++) centres.push(sites[i]!.x + (sites[i]!.w >> 1));
  drawMetal(g, f, centres);

  const sc = chip.scheduler, qOpen = !sc && queueOpen(chip);
  if (sc) {
    // Reserved wells hold tasks still on the pipe (one transfer at a time): the landing one shows its
    // real progress, so a newly bought queue reads as filling at the pipe's rate, not ignored.
    const t = live ? chip.pipe.transfer : null, s = frame.snapshot;
    incoming.count = live ? sc.reserved : 0; incoming.family = t ? t.family : null;
    incoming.progress = t ? transferProgress(t, s.simTimeMs, frame.timeMs) : 0;
    queueBlock(g, f.queue, queueWells(f, sc.q, form), live ? chip.queue : NONE, incoming);
  }
  else if (qOpen) queueGhost(g, f.queue); else lockedSite(g, f.queue);
  cacheBlock(g, f.cache, chip.cache.capacityBits, live ? chip.cache.usedBits : 0, live ? spilledOut(chip) : 0);

  let working = false;
  for (const c of chip.cores) if (c.busy > 0 || c.research > 0) working = true;
  rateAnimation(chip.clock.effectiveHz, frame.timeMs, 2, live && working, cycle);
  clockBlock(g, f.clock, cycle.active && (cycle.saturated || frame.reducedMotion || cycle.phase < 0.5));
  for (let i = 0; i < used; i++) {
    const s = sites[i]!;
    g.fillStyle = CLOCK_TRACE; g.fillRect(s.x + s.w, s.y + (s.h >> 1), Math.max(0, f.clock.x - s.x - s.w), 1);
  }
  let landing = live && chip.pipe.waiting && chip.pipe.transfer !== null;
  const grid = sites.length > 2, empty = emptyBlocks(chip, sites);
  if (grid) { drawBlock(g, empty.open, false); drawBlock(g, empty.locked, true); }
  for (let i = 0; i < sites.length; i++) {
    if (grid && i >= chip.cores.length) break;
    const core = chip.cores[i], idle = !!core && core.busy <= 0 && !lentCore(core);
    drawCore(g, sites[i]!, core, live, chip, frame, i, sites.length, landing && idle, arr);
    if (landing && idle) landing = false;
  }
  drawShardGroups(g, sites, chip.cores, live);
  pad(g, f.inp.x, f.inp.y, live && chip.pipe.transfer !== null);

  const a = chipAfford(view?.quotes ?? null, chip.systemId, afford);
  if (a.clock) goldBracket(g, f.clock);
  if (a.cache) goldBracket(g, f.cache);
  if (a.queue && (sc || qOpen)) goldBracket(g, f.queue);
  for (let i = 0; i < Math.min(sites.length, chip.cores.length); i++) if (a.core[i]) goldBracket(g, sites[i]!);
  // Adding a core: one bracket on the open block (grid), or on the next open big site.
  if (a.site && grid && empty.open.n) goldBracket(g, empty.open.box);
  else if (a.site && !grid && chip.cores.length < sites.length && !siteLocked(chip, chip.cores.length)) goldBracket(g, sites[chip.cores.length]!);
}

/**
 * `landing`: this idle core waits on the pipe's transfer (no scheduler), so its bar shows the landing.
 * A busy core shows its piece of the shard (D25): the work it still holds, in the task type's colour,
 * draining as the shard runs.
 */
function drawCore(g: G, r: Rect, core: CoreView | undefined, live: boolean, chip: ChipSnapshot, frame: WorldFrame, i: number, n: number,
  landing: boolean, arr: CoreArrangement): void {
  if (!core) { if (siteLocked(chip, i)) lockedSite(g, r); else coreGhost(g, r); return; }
  const busy = live && core.busy > 0, lent = live && lentCore(core), colour = busy ? coreColor(core) ?? P.op : P.op;
  coreBlock(g, r, busy, lent);
  dimIfAsleep(g, r, core, live);
  if (n > 2) {
    if (busy) drawGridPiece(g, r, remaining(core.progress), colour);
    return;
  }
  // Big sites (L2): the task's family icon under the name, its piece gauge near the foot.
  const c = coreText(r, arr), bw = r.w - 2 * c.pad;
  if (busy && core.family !== null) drawFamilyIcon(g, familyId(core.family), c.icon.x, c.icon.y);
  const ix = c.icon.x, by = c.bar;
  const t = chip.pipe.transfer, s = frame.snapshot;
  const fill = busy ? remaining(core.progress) : lent ? s.research?.progress ?? 0 : landing && t ? transferProgress(t, s.simTimeMs, frame.timeMs) : 0;
  bar(g, ix, by, bw, fill, busy ? colour : lent ? P.rnd : landing ? P.net : P.op);
}
