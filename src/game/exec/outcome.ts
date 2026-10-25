import { G, LOC, TALLY } from '../core/buffers';
import { tallyFailed, tallyMet } from '../core/events';
import { freeGang, freeRecord, frontList, unlink } from '../core/pool';
import { growTable } from '../core/table';
import { dirtySystem } from '../core/touch';
import type { World } from '../core/world';
import { FAIL_CAUSES, NO_DETAIL, type FailCause } from '../types/events';
import { addTransit, leaveLink } from '../net/fifo';
import { queueUnlink } from './lists';
import { canAdmit, noteAdmit, noteAdmitted } from './slots';
import { leaveStage, releaseRunning } from './stages';

/**
 * Outcomes: payout of met tasks, failures with a cause (and their full work, for the SLA), and
 * aborting a record wherever it is. A gang row tracks the members of one taken distributed task.
 */

export const CAUSE: { readonly [C in FailCause]: number } = Object.fromEntries(FAIL_CAUSES.map((c, i) => [c, i])) as never;

function addTally(w: World, family: number, pay: number, count: number): void {
  const t = w.hot.tally;
  if (t.len >= t.cap) growTable(TALLY, t, t.len + 1);
  t.pay[t.len] = pay;
  t.count[t.len] = count;
  t.len += 1;
  const ratio = w.hot.fam.dataRatio[family]!;
  if (ratio > 0) w.hot.fam.dataTick[family] = w.hot.fam.dataTick[family]! + (count * pay) / ratio;
}

/** A finished record on system s: k met tasks, or one finished gang member. Frees the record. */
export function completeRecord(w: World, s: number, r: number): void {
  const rec = w.hot.rec;
  const g = rec.gang[r]!;
  if (g < 0) {
    addTally(w, rec.family[r]!, rec.payout[r]!, rec.count[r]!);
    tallyMet(w, rec.family[r]!, rec.count[r]!, s, rec.count[r]! * rec.payout[r]!);
  } else {
    const gang = w.hot.gang;
    gang.done[g] = gang.done[g]! + 1;
    if (gang.done[g] === gang.members[g]) {
      addTally(w, gang.family[g]!, gang.payout[g]!, 1);
      tallyMet(w, gang.family[g]!, 1, s, gang.payout[g]!);
      freeGang(w.hot, g);
    }
  }
  freeRecord(w.hot, r);
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

/** Every live member record of gang g. Scans the pool (gang failures are rare). */
export function gangRecords(w: World, g: number, out: number[]): number[] {
  out.length = 0;
  const rec = w.hot.rec;
  for (let r = 0; r < rec.len; r += 1) if (rec.loc[r] !== LOC.free && rec.gang[r] === g) out.push(r);
  return out;
}

const scratch: number[] = [];

/** Fails gang g once with `cause` (the root cause, D4.1) and aborts every member. */
export function failGang(w: World, g: number, cause: number, detail: number = NO_DETAIL): void {
  tallyFailed(w, w.hot.gang.family[g]!, cause, 1, w.hot.gang.payout[g]!, detail);
  for (const r of gangRecords(w, g, scratch)) abortRecord(w, r);
  freeGang(w.hot, g);
}

/** Fails record r with `cause`: k tasks, or its whole gang. Removes and frees what is left. */
export function failRecord(w: World, r: number, cause: number, detail: number = NO_DETAIL): void {
  const g = w.hot.rec.gang[r]!;
  if (g >= 0) { failGang(w, g, cause, detail); return; }
  tallyFailed(w, w.hot.rec.family[r]!, cause, w.hot.rec.count[r]!, w.hot.rec.count[r]! * w.hot.rec.payout[r]!, detail);
  abortRecord(w, r);
}
