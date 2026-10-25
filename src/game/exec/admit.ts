import { canRunOn, detailIndex } from '../market/fleet';
import { dirtySystem } from '../core/touch';
import type { World } from '../core/world';
import { addTransit } from '../net/fifo';
import { arrived } from '../net/links';
import { enqueue } from './alloc';
import { CAUSE, failRecord, releaseReservation } from './outcome';
import { canAdmit, noteAdmit, noteAdmitted } from './slots';

/**
 * Admit phase (tick step 5, spec §7.5). Transfers that arrived this tick are delivered in order of
 * system index, then arrival. A system that cannot run the task (§6.3) fails it `misroute` with the
 * failing gate as its detail; otherwise it takes its reserved slot in the queue. Pickup already
 * happened when the task was taken. The lone system's pipe lands inside the run phase.
 */

const order: number[] = [];

export function admitPhase(w: World): void {
  if (arrived.length === 0) return;
  const rec = w.hot.rec;
  order.length = 0;
  for (const r of arrived) order.push(r);
  arrived.length = 0;
  order.sort((a, b) => rec.target[a]! - rec.target[b]!);
  for (const r of order) deliver(w, r);
}

function deliver(w: World, r: number): void {
  const rec = w.hot.rec;
  const s = rec.target[r]!;
  const k = rec.count[r]!;
  dirtySystem(w, s);
  const gate = canRunOn(w, s, r);
  if (gate !== 0) { failRecord(w, r, CAUSE.misroute, detailIndex(gate)); return; }
  addTransit(w.hot, -k);
  releaseReservation(w, s, k, r);
  const before = canAdmit(w, s);
  enqueue(w, s, r);
  noteAdmitted(w, s, k, r);
  noteAdmit(w, s, before);

}
