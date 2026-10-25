import { G, LOC, type HotBuffers } from '../core/buffers';
import { DT_S, headDeadlineTick, QUEUE_VISIBLE, RATE_RING_TICKS, SLA_GRACE_TASKS } from '../core/constants';
import { allocRecord, forEachInList, freeRecord, frontList, insertBefore, splitRecord, unlink } from '../core/pool';
import { nextFloat, reseedForRound, roundSeed, seedRng } from '../core/rng';
import type { World } from '../core/world';
import { NO_DETAIL } from '../types/events';
import type { QueuedTask } from '../types/state';
import { baseRate, baseWeight, CURVE, memberSize, sizeJitter } from './curve';
import { FAMILIES, payoutAt } from './families';
import { canRunFleet, detailIndex } from './fleet';
import { failTasks } from './sla';

/**
 * The endless queue (program D10, spec §5.2, §14.1 steps 2 and 7). The window holds the next five
 * untaken tasks; taken work that comes back waits at the front as committed records. Only the head
 * has a clock. Hardware takes the head (net before admission, exec before Rack) through
 * probeHead → takeHead; every task that leaves the window draws one replacement at the back.
 */

const JITTER_SALT = 0x5eed1e55;
/** Past the last family window, the mix of this I holds while sizes keep growing (docs/tasks.md §3.4). */
export const MIX_CAP_I = 58.9;

/** One queue draw at I (spec §14.3): a family by seeded weight, then a size jitter. Reserves the next ID. */
export function drawTask(hot: HotBuffers, I: number): QueuedTask {
  const mixI = Math.min(I, MIX_CAP_I);
  let total = 0;
  for (const f of FAMILIES) total += baseWeight(f, mixI) * hot.fam.weightJitter[f.id]!;
  let draw = nextFloat(hot) * total;
  // At the zero-weight boundary I = 0, Bit Flip is the authored opening family.
  let family = FAMILIES[0]!;
  for (const f of FAMILIES) {
    draw -= baseWeight(f, mixI) * hot.fam.weightJitter[f.id]!;
    if (draw < 0) { family = f; break; }
  }
  const size = memberSize(I, sizeJitter(nextFloat(hot)), family.members);
  const taskId = hot.g[G.nextTaskId]!;
  hot.g[G.nextTaskId] = taskId + 1;
  return { taskId, family: family.id, size };
}

/** Round preparation, once, at initialization or the previous round's end: seed, jitters, five tasks at I. */
export function prepareQueue(hot: HotBuffers, seed: number, roundIndex: number, I: number): QueuedTask[] {
  reseedForRound(hot, seed, roundIndex);
  const host = { rng: new Uint32Array(4), g: new Float64Array(G.rngDraws + 1) };
  seedRng(host.rng, (roundSeed(seed, roundIndex) ^ JITTER_SALT) >>> 0);
  for (const f of FAMILIES) {
    hot.fam.weightJitter[f.id] = 1 + CURVE.weightJit * (2 * nextFloat(host) - 1);
    hot.fam.dataRatio[f.id] = f.dataRatio * (1 + CURVE.dataJit * (2 * nextFloat(host) - 1));
  }
  const tasks: QueuedTask[] = [];
  for (let i = 0; i < QUEUE_VISIBLE; i += 1) tasks.push(drawTask(hot, I));
  return tasks;
}

/** The SLA grace prior G (spec §4.2): 10 × the largest work among the five opening tasks. */
export function graceOf(window: readonly QueuedTask[]): number {
  let max = 0;
  for (const t of window) max = Math.max(max, payoutAt(FAMILIES[t.family]!, t.size));
  return SLA_GRACE_TASKS * max;
}

/** The first tick a head promoted now can be taken (spec §5.2): this tick until the deadline step, else the next. */
const headNow = (w: World): number => w.tick + (w.late ? 1 : 0);
const promote = (w: World): void => { w.market.headTick = headNow(w); };

const ringRow = (w: World): number => w.tick % RATE_RING_TICKS;

/** Fills record r from a queued descriptor. */
function materialize(w: World, r: number, t: QueuedTask): void {
  const rec = w.hot.rec, family = FAMILIES[t.family]!;
  rec.family[r] = t.family;
  rec.count[r] = 1;
  rec.scale[r] = t.size;
  rec.payout[r] = payoutAt(family, t.size);
  rec.threads[r] = family.threads;
  rec.taskId[r] = t.taskId;
}

/** Removes window entry i and draws its replacement at the back at the current I. */
function leaveWindow(w: World, i: number): void {
  const tasks = w.market.window;
  tasks.splice(i, 1);
  tasks.push(drawTask(w.hot, w.market.intensity));
}

/**
 * The head as a record for a take attempt: the first front record, or a probe record built from
 * window[0]. Pass it to takeHead or dropProbe. -1 when the round is not running.
 */
export function probeHead(w: World): number {
  if (w.round.phase !== 'running') return -1;
  const front = w.hot.g[G.frontHead]!;
  if (front >= 0) return front;
  const t = w.market.window[0];
  if (!t) return -1;
  const r = allocRecord(w.hot);
  materialize(w, r, t);
  w.hot.rec.loc[r] = LOC.probe;
  return r;
}

/** Gives back a probe that was not taken. Front records stay where they are. */
export function dropProbe(w: World, r: number): void {
  if (w.hot.rec.loc[r] === LOC.probe) freeRecord(w.hot, r);
}

/**
 * Takes one task of the head probed as r (pickup, spec §6.4): returns its own count-1 record, off
 * every list, with `taken` stamped. The next task becomes the head with a fresh 10 s; a window
 * take draws one replacement at the back.
 */
export function takeHead(w: World, r: number): number {
  const rec = w.hot.rec;
  let t = r;
  if (rec.loc[r] === LOC.probe) leaveWindow(w, 0);
  else if (rec.count[r]! > 1) t = splitRecord(w.hot, r, 1);
  else unlink(w.hot, frontList(w.hot), r);
  rec.loc[t] = LOC.free;
  rec.taken[t] = w.tick;
  w.hot.g[G.taken] = w.hot.g[G.taken]! + 1;
  const row = ringRow(w);
  w.hot.ring.taken[row] = w.hot.ring.taken[row]! + 1;
  promote(w);
  return t;
}

/**
 * Taken work back at the queue front (spec §5.2, §6.9): ahead of the window in original queue
 * order (task ID), still committed. The caller took r off every other list. A new head gets a fresh 10 s.
 */
export function returnToFront(w: World, r: number): void {
  const rec = w.hot.rec;
  const id = rec.taskId[r]!;
  let before = w.hot.g[G.frontHead]!;
  while (before >= 0 && rec.taskId[before]! <= id) before = rec.next[before]!;
  rec.loc[r] = LOC.front;
  rec.owner[r] = -1;
  rec.target[r] = -1;
  rec.stage[r] = 0;
  rec.gang[r] = -1;
  insertBefore(w.hot, frontList(w.hot), r, before);
  if (w.hot.g[G.frontHead] === r) promote(w);
}

/** Frees the queue front without counting it (round end, spec §4.1). */
export function clearFront(w: World): void {
  const hot = w.hot;
  forEachInList(hot, frontList(hot), (r) => {
    unlink(hot, frontList(hot), r);
    freeRecord(hot, r);
  });
}

/** The head's family and per-member size into `out`; false when there is none. */
export function peekHead(w: Pick<World, 'hot' | 'market'>, out: { family: number; size: number; front: boolean }): boolean {
  const front = w.hot.g[G.frontHead]!;
  if (front >= 0) { out.family = w.hot.rec.family[front]!; out.size = w.hot.rec.scale[front]!; out.front = true; return true; }
  const t = w.market.window[0];
  if (!t) return false;
  out.family = t.family; out.size = t.size; out.front = false;
  return true;
}

const head = { family: 0, size: 0, front: false };

/** 0 when some hardware in the static capability set can run the head, else its detail code (spec §6.3). */
export function headGate(w: World): number {
  if (!peekHead(w, head)) return 0;
  return canRunFleet(w, FAMILIES[head.family]!, head.size);
}

/**
 * Dismissal (spec §5.2): window entry i leaves for free, the rest shift up and one task is drawn at
 * the back. A dismissed head promotes the next with a fresh 10 s. Changes no SLA sum or count.
 */
export function dismissAt(w: World, i: number): void {
  const wasHead = i === 0 && w.hot.g[G.frontHead]! < 0;
  leaveWindow(w, i);
  w.hot.g[G.dismissed] = w.hot.g[G.dismissed]! + 1;
  if (wasHead) promote(w);
}

/** The head fails at its deadline step (spec §5.2): cantRun when no static-capability hardware can run it. */
function failHead(w: World): void {
  const gate = headGate(w);
  const cause = gate !== 0 ? 'cantRun' : 'timeout';
  const detail = gate !== 0 ? detailIndex(gate) : NO_DETAIL;
  const front = w.hot.g[G.frontHead]!;
  if (front >= 0) {
    const rec = w.hot.rec;
    const r = rec.count[front]! > 1 ? splitRecord(w.hot, front, 1) : front;
    if (r === front) unlink(w.hot, frontList(w.hot), r);
    failTasks(w, rec.family[r]!, cause, 1, rec.payout[r]!, detail);
    freeRecord(w.hot, r);
  } else {
    const t = w.market.window[0]!;
    failTasks(w, t.family, cause, 1, payoutAt(FAMILIES[t.family]!, t.size), detail);
    leaveWindow(w, 0);
  }
  promote(w);
}

/**
 * Market (tick step 2): advance I by round age and start this tick's rate row. With Auto-skip
 * (D12.3), dismiss uncommitted heads no static-capability hardware can run; at most one window's
 * worth per tick, an engine bound that a real queue never reaches.
 */
export function marketPhase(w: World): void {
  if (w.round.phase !== 'running') return;
  const m = w.market;
  m.intensity += DT_S * baseRate(m.intensity);
  if (m.intensity > w.round.peakIntensity) w.round.peakIntensity = m.intensity;
  const ring = w.hot.ring, row = ringRow(w);
  ring.at[row] = w.tick;
  ring.taken[row] = 0;
  if (!w.research.unlocks.rules.includes('autoSkip')) return;
  for (let i = 0; i < QUEUE_VISIBLE && w.hot.g[G.frontHead]! < 0 && headGate(w) !== 0; i += 1) dismissAt(w, 0);
}

/** Deadlines (tick step 7): the head only. Untaken at the end of headTick + 99, it fails once. */
export function deadlinePhase(w: World): void {
  w.late = true;
  if (w.round.phase !== 'running') return;
  if (w.tick >= headDeadlineTick(w.market.headTick) && peekHead(w, head)) failHead(w);
}
/** Index of a task in the window, or -1. */
export const windowIndexOf = (tasks: readonly QueuedTask[], taskId: number): number => tasks.findIndex((t) => t.taskId === taskId);
