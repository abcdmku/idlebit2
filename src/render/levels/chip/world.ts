// The CPU world (L2, D15/D17): only the CPU. Every mark is a part, a route or a real state:
// queue wells fill with waiting tasks, cache cells with held bits, cores with their task's progress,
// the clock lamp ticks with real cycles, the IN pad lights while a transfer lands, OUT on a payout.
import { familyId } from '../../../game';
import type { ChipSnapshot, CoreView } from '../../../game';
import { P, createRateAnimation, drawFamilyIcon, rateAnimation, transferProgress } from '../../core';
import type { Rect, WorldFrame, WorldForm } from '../../core';
import { coreSites, coreText, floorOf, queueWells } from './layout';
import type { Floor } from './layout';
import { CLOCK_TRACE, bar, cacheBlock, clockBlock, copper, coreBlock, coreGhost, drawMetal, pad, queueBlock, queueGhost, staticCpu } from './sprites';

type G = CanvasRenderingContext2D;
const cycle = createRateAnimation();
const centres: number[] = [];
const NONE: readonly never[] = [];
/** Sim tick length: events carry ticks. */
const TICK_MS = 100;
/** A payout lights OUT this long after its event. */
export const OUT_LIT_MS = 300;

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
export const lentCore = (c: CoreView): boolean => c.research > 0 && c.busy <= 0;
/** A met event for this system within the last OUT_LIT_MS. */
export function paidRecently(chip: ChipSnapshot, frame: WorldFrame): boolean {
  const events = frame.snapshot.events;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!, age = frame.timeMs - e.tick * TICK_MS;
    if (age > OUT_LIT_MS) return false;
    if (e.kind === 'met' && e.system === chip.systemId && age >= 0) return true;
  }
  return false;
}
/** The world's bottom edge as the player sees it: where OUT copper ends and payouts pop. */
export function bottomOf(f: Floor, frame: WorldFrame | null): number {
  const v = frame?.visible;
  return v ? Math.min(f.world.h, Math.floor(v.y + v.h)) : f.world.h;
}

export function drawWorld(g: G, chip: ChipSnapshot, frame: WorldFrame, form: WorldForm): void {
  const f = floorOf(form), live = isLive(chip, frame);
  g.drawImage(staticCpu(f, form), 0, 0);
  const sites = coreSites(f, siteCount(chip)), used = Math.max(1, Math.min(sites.length, chip.cores.length));
  centres.length = 0;
  for (let i = 0; i < used; i++) centres.push(sites[i]!.x + (sites[i]!.w >> 1));
  drawMetal(g, f, centres);
  copper(g, f.out.x, f.out.y + 2, bottomOf(f, frame), live && paidRecently(chip, frame));

  const sc = chip.scheduler;
  if (sc) queueBlock(g, f.queue, queueWells(f, sc.q, form), live ? chip.queue : NONE); else queueGhost(g, f.queue);
  cacheBlock(g, f.cache, chip.cache.capacityBits, live ? chip.cache.usedBits : 0);

  let working = false;
  for (const c of chip.cores) if (c.busy > 0 || c.research > 0) working = true;
  rateAnimation(chip.clock.effectiveHz, frame.timeMs, 2, live && working, cycle);
  clockBlock(g, f.clock, cycle.active && (cycle.saturated || frame.reducedMotion || cycle.phase < 0.5));
  for (let i = 0; i < used; i++) {
    const s = sites[i]!;
    g.fillStyle = CLOCK_TRACE; g.fillRect(s.x + s.w, s.y + (s.h >> 1), Math.max(0, f.clock.x - s.x - s.w), 1);
  }
  let landing = live && chip.pipe.waiting && chip.pipe.transfer !== null;
  for (let i = 0; i < sites.length; i++) {
    const core = chip.cores[i], idle = !!core && core.busy <= 0 && !lentCore(core);
    drawCore(g, sites[i]!, core, live, chip, frame, i, sites.length, landing && idle, form);
    if (landing && idle) landing = false;
  }
  pad(g, f.inp.x, f.inp.y, live && chip.pipe.transfer !== null);
  pad(g, f.out.x, f.out.y, live && paidRecently(chip, frame));
}

/** `landing`: this idle core waits on the pipe's transfer (no scheduler), so its bar shows the landing. */
function drawCore(g: G, r: Rect, core: CoreView | undefined, live: boolean, chip: ChipSnapshot, frame: WorldFrame, i: number, n: number,
  landing: boolean, form: WorldForm): void {
  if (!core) { coreGhost(g, r, siteLocked(chip, i)); return; }
  const busy = live && core.busy > 0, lent = live && lentCore(core);
  coreBlock(g, r, busy, lent);
  if (n > 2) return;
  // Big sites (L2): the task's family icon under the name, its progress bar near the foot.
  const c = coreText(r, form), bw = r.w - 2 * (c.icon.x - r.x);
  if (busy && core.family !== null) drawFamilyIcon(g, familyId(core.family), c.icon.x, c.icon.y);
  const ix = c.icon.x, by = c.bar;
  const t = chip.pipe.transfer, s = frame.snapshot;
  const fill = busy ? core.progress : lent ? s.research?.progress ?? 0 : landing && t ? transferProgress(t, s.simTimeMs, frame.timeMs) : 0;
  bar(g, ix, by, bw, fill, busy ? P.op : lent ? P.rnd : landing ? P.net : P.op);
}
