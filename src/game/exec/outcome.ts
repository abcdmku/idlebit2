import { G, LOC, TALLY } from '../core/buffers';
import { CHECKPOINT_TICKS } from '../core/constants';
import { tallyFailed, tallyMet } from '../core/events';
import { allocRecord, freeParent, freeRecord, frontList, unlink } from '../core/pool';
import { growTable } from '../core/table';
import { dirtySystem } from '../core/touch';
import { recordCompletion, recordShardDone } from '../core/completions';
import { recordFailures } from '../core/failures';
import { rqAt, rqLen, rqRemove } from '../core/routerQueue';
import type { World } from '../core/world';
import { FAIL_CAUSES, FAIL_DETAILS, NO_DETAIL, type FailCause } from '../types/events';
import { dueAt } from '../core/deadlines';
import { tierTraffic } from './memory';
import { addTransit, leaveLink } from '../net/fifo';
import { removeArrival } from '../net/links';
import { returnToFront } from '../market/queue';
import { queueUnlink } from './lists';
import { hasRule } from './rules';
import { canAdmit, noteAdmit, noteAdmitted } from './slots';
import { leaveStage, releaseRunning } from './stages';
import { releaseQueuedPreload } from './preload';

/**
 * Outcomes (spec §6.8, §6.9, D25.5): pay for the full task once, when its last shard completes;
 * fail it once, with its full work, when any shard is lost; abort a record wherever it is. A parent
 * row tracks the shards of one split task; an unsplit task is its own record and pays from it.
 */

export const CAUSE: { readonly [C in FailCause]: number } = Object.fromEntries(FAIL_CAUSES.map((c, i) => [c, i])) as never;

function addTally(w: World, family: number, pay: number, count: number, units: number): void {
  const t = w.hot.tally;
  if (t.len >= t.cap) growTable(TALLY, t, t.len + 1);
  t.count[t.len] = count;
  t.family[t.len] = family;
  t.units[t.len] = units;
  t.len += 1;
  const ratio = w.hot.fam.dataRatio[family]!;
  if (ratio > 0) w.hot.fam.dataTick[family] = w.hot.fam.dataTick[family]! + (count * pay) / ratio;
}

const traffic = new Float64Array(2);
/** D26.7 round spill sums: RAM and disk bits of met tasks (RoundReport.spill). */
function addSpill(w: World, ram: number, disk: number): void {
  w.hot.g[G.ramWork] = w.hot.g[G.ramWork]! + ram;
  w.hot.g[G.diskWork] = w.hot.g[G.diskWork]! + disk;
}

/** A parent's task is met once every placed shard is done and nothing waits to be placed. */
const finished = (w: World, p: number): boolean => {
  const par = w.hot.parent;
  return par.done[p] === par.placed[p] && par.pending[p] === 0 && par.replaceDeadline[p]! < 0;
};

/**
 * A finished record on system s: k met unsplit tasks, or one finished shard. A shard frees its
 * slot at once but pays nothing; the task pays W and its Data once, at the last shard (D25.5).
 */
export function completeRecord(w: World, s: number, r: number, tau: number, domain: number): void {
  const rec = w.hot.rec, par = w.hot.parent;
  const p = rec.parent[r]!;
  tierTraffic(w, r, traffic);
  if (p < 0) {
    const k = rec.count[r]!, pay = rec.payout[r]!;
    addSpill(w, k * traffic[0]!, k * traffic[1]!);
    recordCompletion(w, s, r, k, pay, tau, domain, 1);
    addTally(w, rec.family[r]!, pay, k, rec.units[r]!);
    tallyMet(w, rec.family[r]!, k, s, k * pay);
    freeRecord(w.hot, r);
    return;
  }
  par.done[p] = par.done[p]! + 1;
  par.ramBits[p] = par.ramBits[p]! + traffic[0]!;
  par.diskBits[p] = par.diskBits[p]! + traffic[1]!;
  if (!finished(w, p)) {
    recordShardDone(w, s, r, tau, domain);
    freeRecord(w.hot, r);
    return;
  }
  const family = par.family[p]!, work = par.work[p]!;
  addSpill(w, par.ramBits[p]!, par.diskBits[p]!);
  recordCompletion(w, s, r, 1, work, tau, domain, par.placed[p]!);
  addTally(w, family, work, 1, par.units[p]!);
  tallyMet(w, family, 1, s, work);
  freeRecord(w.hot, r);
  freeParent(w.hot, p);
}

/** Releases a reservation of k tasks of record r on system s (a transfer cancelled or delivered). */
export function releaseReservation(w: World, s: number, k: number, r: number): void {
  const before = canAdmit(w, s);
  w.hot.sys.reserved[s] = w.hot.sys.reserved[s]! - k;
  noteAdmitted(w, s, -k, r);
  noteAdmit(w, s, before);
}

/**
 * Removes record r from wherever it is and frees it, counting nothing. Queued and running work is
 * discarded; a transfer gives back its link place and its reservation.
 */
export function abortRecord(w: World, r: number): void {
  const rec = w.hot.rec, h = w.hot.sys;
  const k = rec.count[r]!;
  switch (rec.loc[r]) {
    case LOC.queue: {
      const s = rec.owner[r]!;
      releaseQueuedPreload(w, s, r);
      const before = canAdmit(w, s);
      queueUnlink(w.hot, s, r);
      h.queueLen[s] = h.queueLen[s]! - k;
      w.hot.g[G.queued] = w.hot.g[G.queued]! - k;
      noteAdmitted(w, s, -k, r);
      noteAdmit(w, s, before);
      break;
    }
    case LOC.running: {
      const s = rec.owner[r]!;
      leaveStage(w, s, r);
      releaseRunning(w, s, r);
      dirtySystem(w, s);
      break;
    }
    case LOC.link: {
      const s = rec.target[r]!;
      if (rec.owner[r]! >= 0) leaveLink(w.hot, r);
      else if (h.pipeRec[s] === r) { h.pipeRec[s] = -1; h.pipeLeft[s] = 0; }
      // Arrived this tick and waiting for the admit phase: it leaves that list too, or admit would deliver a
      // freed (or already reused) record and free it twice, corrupting the record pool and parent sibling lists.
      else removeArrival(r);
      addTransit(w.hot, -k);
      releaseReservation(w, s, k, r);
      break;
    }
    case LOC.front:
      unlink(w.hot, frontList(w.hot), r);
      break;
  }
  freeRecord(w.hot, r);
}

/** Router-queue shares of parent p, removed (they move no bits, so nothing else is held). */
function dropShares(w: World, p: number): void {
  const hot = w.hot, q = hot.rq;
  if (hot.parent.pending[p] === 0) return;
  for (let row = 0; row < q.len; row += 1) {
    for (let i = rqLen(hot, row) - 1; i >= 0; i -= 1) if (q.rqParent[rqAt(hot, row, i)] === p) rqRemove(w, row, i);
  }
  hot.parent.pending[p] = 0;
}

/** Aborts every live shard of parent p and its router-queue shares, then frees the row. */
function dropParent(w: World, p: number): void {
  const par = w.hot.parent;
  for (let r = par.head[p]!; r >= 0; r = par.head[p]!) abortRecord(w, r);
  dropShares(w, p);
  if (par.replaceDeadline[p]! >= 0) { par.replaceDeadline[p] = -1; w.hot.g[G.replacing] = w.hot.g[G.replacing]! - 1; }
  freeParent(w.hot, p);
}

/** Fails split task p once with `cause` and its full work W; aborts every sibling (D25.5). */
export function failParent(w: World, p: number, cause: number, detail: number = NO_DETAIL): void {
  const par = w.hot.parent;
  if (w.completions?.failures) recordFailures(w, par.family[p]!, cause, 1, par.taskId[p]!);
  tallyFailed(w, par.family[p]!, cause, 1, par.work[p]!, detail);
  dropParent(w, p);
}

/**
 * Fails record r with `cause`: k unsplit tasks, or the whole split task. With `checkpointing` a
 * lost shard instead waits up to 10 s for one replacement in its rack (spec §7.8 item 7).
 */
export function failRecord(w: World, r: number, cause: number, detail: number = NO_DETAIL): void {
  const rec = w.hot.rec, par = w.hot.parent;
  const p = rec.parent[r]!;
  if (p >= 0) {
    if (hasRule(w, 'checkpointing') && par.replaceDeadline[p]! < 0 && w.round.phase === 'running') {
      const s = rec.loc[r] === LOC.link ? rec.target[r]! : rec.owner[r]!;
      par.lostCause[p] = cause;
      par.replaceDeadline[p] = w.tick + CHECKPOINT_TICKS;
      par.replaceRack[p] = s >= 0 ? w.compiled.sys.rack[s]! : -1;
      par.replaceUnits[p] = rec.units[r]!;
      par.replaceShard[p] = rec.shard[r]!;
      w.hot.g[G.replacing] = w.hot.g[G.replacing]! + 1;
      abortRecord(w, r);
      return;
    }
    failParent(w, p, cause, detail);
    return;
  }
  if (w.completions?.failures) recordFailures(w, rec.family[r]!, cause, rec.count[r]!, rec.taskId[r]!);
  tallyFailed(w, rec.family[r]!, cause, rec.count[r]!, rec.count[r]! * rec.payout[r]!, detail);
  abortRecord(w, r);
}

/**
 * Taken work goes back to the queue front (spec §6.9): an unsplit record as it is (the caller took
 * it off every list); a shard returns its whole task, every sibling aborted, unless a sibling has
 * already finished, which fails the task with `cause` instead.
 */
export function returnTask(w: World, r: number, cause: number): void {
  const p = w.hot.rec.parent[r]!;
  if (p < 0) { returnToFront(w, r); return; }
  abortRecord(w, r);
  returnParent(w, p, cause);
}

/** Returns split task p to the queue front as one whole committed task, or fails it if a shard finished. */
export function returnParent(w: World, p: number, cause: number): void {
  const par = w.hot.parent, rec = w.hot.rec;
  if (par.done[p]! > 0) { failParent(w, p, cause); return; }
  const t = allocRecord(w.hot);
  rec.family[t] = par.family[p]!; rec.count[t] = 1; rec.units[t] = par.units[p]!; rec.payout[t] = par.work[p]!;
  rec.taskId[t] = par.taskId[p]!; rec.taken[t] = par.taken[p]!; rec.deadline[t] = par.deadline[p]!;
  dropParent(w, p);
  returnToFront(w, t);
}

const LATE_DETAIL = [NO_DETAIL, FAIL_DETAILS.indexOf('ram'), FAIL_DETAILS.indexOf('disk')];
const due: number[] = [];
/**
 * D26.5 (tick step 7, after the head): every taken task whose window ends this tick and is not met fails
 * `late` with its full W; its shards and router-queue shares are aborted. The detail is the slowest tier
 * its shards' traffic touched.
 */
export function latePhase(w: World): void {
  if (w.round.phase !== 'running') return;
  for (const p of dueAt(w.hot, w.tick, due)) failParent(w, p, CAUSE.late, LATE_DETAIL[w.hot.parent.tier[p]!]!);
}
