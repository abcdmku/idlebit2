import { G, LOC } from '../core/buffers';
import { allocParent, allocRecord, addSibling, freeRecord } from '../core/pool';
import { linkDeadline } from '../core/deadlines';
import { rqAt, rqLen, rqPush, rqRemove, rqRow, wakeAllRouters } from '../core/routerQueue';
import { GATHER_WAIT_TICKS } from '../core/constants';
import type { World } from '../core/world';
import { dropProbe, headGate, probeHead, takeHead } from '../market/queue';
import { FAMILIES, payoutAt } from '../market/families';
import { hasRule } from '../exec/rules';
import { CAUSE, failParent, failRecord } from '../exec/outcome';
import { detailIndex } from '../market/fleet';
import { noteTake, refreshSummaries, reserve } from '../exec/slots';
import { addTransit } from './fifo';
import { forward } from './links';
import { FIRST } from './paths';
import { rebalance } from './rebalance';
import { withExactSummaries } from './routeMemo';
import { routeStrategy } from './routers';
import { FILTER_BIT } from './filters';
import { GLOBAL, noteRoute, RACK, resetRouted, ROOM, routerOf, SITE, topRouter } from './scope';
import { queueFree, split, splitMiss, tree } from './split';
import { gateBelow } from './stuck';

export { canTake, firstLinkRoom, linkRoom } from './split';

/**
 * Route phase (tick step 4, spec §7.6, D25.7). From Rack on: rebalancing (shard stealing,
 * checkpoint replacements), then (1) every router queue dispatches top-down, strictly FIFO, while
 * its front entry can be split; then (2) the top router takes market heads: it splits the head now
 * when its queue is empty and the split succeeds, or takes it into its queue when a slot is free;
 * otherwise the head waits with its clock running. Every take is pickup. Each split is reserved
 * atomically: a slot and one shard transfer queued on the first link per system leaf, a share per
 * router-queue leaf. Routers have no budget (D12.5).
 */

const top = { kind: 0, id: 0 };

/** Sends shard (or unsplit task) record r toward system `target`: reserves its slot and queues it on the first link. */
export function dispatch(w: World, r: number, target: number): void {
  const rec = w.hot.rec;
  reserve(w, target, rec.count[r]!, r);
  noteTake(w, target);
  rec.target[r] = target;
  addTransit(w.hot, rec.count[r]!);
  forward(w, r, FIRST, hasRule(w, 'qos'));
}

/** A new shard record of parent p with `units`, index `shard`, sent to system s. */
export function placeShard(w: World, p: number, s: number, units: number, shard: number): void {
  const rec = w.hot.rec, par = w.hot.parent;
  const r = allocRecord(w.hot);
  rec.family[r] = par.family[p]!; rec.count[r] = 1; rec.units[r] = units; rec.taskId[r] = par.taskId[p]!;
  rec.taken[r] = par.taken[p]!; rec.shard[r] = shard; rec.stage[r] = 0; rec.part[r] = 0; rec.threads[r] = 0; rec.deadline[r] = par.deadline[p]!;
  // A shard pays nothing (D25.5); its share of W only orders the priority scheduler.
  rec.payout[r] = par.units[p]! > 0 ? (par.work[p]! * units) / par.units[p]! : 0;
  addSibling(w.hot, p, r);
  dispatch(w, r, s);
}

/** The entry being committed: a whole task (record `record`, or none yet) or a share of parent row `parent`. */
interface Commit { taskId: number; family: number; units: number; parent: number; record: number; taken: number; deadline: number }

/**
 * A parent row for a task taken at `taken`: a split task's, and every windowed task's (D26.5), so the
 * deadline ring can find it wherever its shards and router-queue shares are.
 */
export function openParent(w: World, taskId: number, family: number, units: number, taken: number, deadline: number): number {
  const hot = w.hot, par = hot.parent, f = FAMILIES[family]!;
  const p = allocParent(hot);
  par.taskId[p] = taskId; par.family[p] = family; par.units[p] = units; par.work[p] = payoutAt(f, units);
  par.minShards[p] = Math.max(1, f.members); par.taken[p] = taken; par.next[p] = -1; par.deadline[p] = deadline;
  linkDeadline(hot, p);
  return p;
}

/** Reserves the split tree in `tree` for entry e (spec §7.6 reserve: all of it, or none was planned). */
function commit(w: World, e: Commit): void {
  for (let i = 0; i < tree.notes; i += 1) noteRoute(w, tree.noteKind[i]!, tree.noteId[i]!, tree.noteSlot[i]!);
  for (let i = 0; i < tree.used; i += 1) routeStrategy(tree.usedStrategy[i]!).used?.(w, tree.usedKind[i]!, tree.usedId[i]!, tree.usedSlot[i]!);
  const hot = w.hot, rec = hot.rec, par = hot.parent;
  if (e.parent < 0 && tree.n === 1 && e.deadline < 0) {
    if (tree.kind[0] === -1) {
      const r = e.record >= 0 ? e.record : materialize(w, e);
      rec.shard[r] = 0;
      dispatch(w, r, tree.id[0]!);
    } else {
      rqPush(hot, rqRow(hot, tree.kind[0]!, tree.id[0]!), e.taskId, -1, e.units, e.family, w.tick);
      if (e.record >= 0) freeRecord(hot, e.record);
    }
    return;
  }
  let p = e.parent;
  if (p < 0) {
    p = openParent(w, e.taskId, e.family, e.units, e.taken, e.deadline);
    if (e.record >= 0) freeRecord(hot, e.record);
  }
  for (let i = 0; i < tree.n; i += 1) {
    if (tree.kind[i] === -1) {
      const shard = par.placed[p]!;
      par.placed[p] = shard + 1;
      placeShard(w, p, tree.id[i]!, tree.units[i]!, shard);
    } else {
      rqPush(hot, rqRow(hot, tree.kind[i]!, tree.id[i]!), par.taskId[p]!, p, tree.units[i]!, par.family[p]!, w.tick);
      par.pending[p] = par.pending[p]! + 1;
    }
  }
}

function materialize(w: World, e: Commit): number {
  const rec = w.hot.rec, r = allocRecord(w.hot);
  rec.family[r] = e.family; rec.count[r] = 1; rec.units[r] = e.units; rec.payout[r] = payoutAt(FAMILIES[e.family]!, e.units);
  rec.taskId[r] = e.taskId; rec.taken[r] = e.taken; rec.deadline[r] = e.deadline;
  return r;
}

const e: Commit = { taskId: 0, family: 0, units: 0, parent: -1, record: -1, taken: 0, deadline: -1 };

/** Filters whose verdicts move with phys state between router wakes (health, power, thermal). */
const DRIFTING = FILTER_BIT.health | FILTER_BIT.power | FILTER_BIT.thermal;
const cols = { strategy: 0, filters: 0 };

/**
 * A blocked front entry is tried again only after a wake (core/routerQueue.ts: a slot, queue slot
 * or first link freed below, a mode change, a build or research change). Two waits end without a
 * wake: Gather's 10 s, and a minimum split behind filters that read phys state.
 */
function retryBlocked(w: World, kind: number, id: number, since: number, minSplit: boolean): boolean {
  if (hasRule(w, 'gather') && w.tick - since <= GATHER_WAIT_TICKS) return true;
  return minSplit && (routerOf(w, kind, id, cols).filters & DRIFTING) !== 0;
}

/** Phase 1: router queue (kind, id) dispatches its front entries while they can be split (strict FIFO). */
function dispatchQueue(w: World, kind: number, id: number): void {
  const hot = w.hot, q = hot.rq, row = rqRow(hot, kind, id);
  if (row >= q.len) return;
  while (rqLen(hot, row) > 0) {
    const at = rqAt(hot, row, 0);
    const p = q.rqParent[at]!;
    // A share of all its task's units, nothing placed yet, is the whole task (a windowed task queues so, D26.5).
    const whole = p < 0 || (hot.parent.placed[p] === 0 && hot.parent.units[p] === q.rqUnits[at]);
    if (q.rqWait[row] === 1 && !retryBlocked(w, kind, id, q.rqSince[at]!, whole && FAMILIES[q.rqFamily[at]!]!.members > 1)) return;
    e.taskId = q.rqTask[at]!; e.units = q.rqUnits[at]!; e.parent = p;
    e.family = p >= 0 ? hot.parent.family[p]! : q.rqFamily[at]!;
    e.taken = p >= 0 ? hot.parent.taken[p]! : q.rqSince[at]!;
    // A windowed task always queues as a share of its parent row; a whole entry has none.
    e.deadline = p >= 0 ? hot.parent.deadline[p]! : -1;
    const since = q.rqSince[at]!;
    const probe = allocRecord(hot), rec = hot.rec;
    rec.family[probe] = e.family; rec.count[probe] = 1; rec.units[probe] = e.units; rec.taskId[probe] = e.taskId;
    rec.taken[probe] = e.taken; rec.payout[probe] = payoutAt(FAMILIES[e.family]!, e.units); rec.loc[probe] = LOC.probe;
    const size = p >= 0 ? hot.parent.units[p]! : e.units;
    if (!split(w, kind, id, probe, e.units, size, whole, since)) {
      // An entry that no system below can ever run would hold the queue for good: it fails (misroute).
      const gate = splitMiss.room ? 0 : gateBelow(w, kind, id, e.family, e.units, size, whole);
      if (gate === 0) { freeRecord(hot, probe); q.rqWait[row] = 1; return; }
      rqRemove(w, row, 0);
      if (p >= 0) { hot.parent.pending[p] = hot.parent.pending[p]! - 1; freeRecord(hot, probe); failParent(w, p, CAUSE.misroute, detailIndex(gate)); }
      else { rec.loc[probe] = LOC.free; failRecord(w, probe, CAUSE.misroute, detailIndex(gate)); }
      continue;
    }
    rqRemove(w, row, 0);
    if (p >= 0) { hot.parent.pending[p] = hot.parent.pending[p]! - 1; freeRecord(hot, probe); e.record = -1; }
    else { rec.loc[probe] = LOC.free; e.record = probe; }
    commit(w, e);
  }
}

/** Phase 1 over every router, top-down: global, sites, zones, racks; index order within a scope. */
function dispatchAll(w: World): void {
  if (w.hot.g[G.rqTotal]! <= 0) return;
  const c = w.compiled;
  if (c.global.exists[0] === 1) dispatchQueue(w, GLOBAL, 0);
  for (let s = 0; s < c.site.len; s += 1) if (c.site.alive[s] === 1) dispatchQueue(w, SITE, s);
  for (let m = 0; m < c.room.len; m += 1) if (c.room.alive[m] === 1) dispatchQueue(w, ROOM, m);
  for (let r = 0; r < c.rack.len; r += 1) if (c.rack.alive[r] === 1) dispatchQueue(w, RACK, r);
}

/** Phase 2: takes heads at the top router while it can split them or hold them in its queue. */
function takeHeads(w: World): void {
  const hot = w.hot, rec = hot.rec;
  for (;;) {
    if (headGate(w) !== 0) return;
    const r = probeHead(w);
    if (r < 0) return;
    const units = rec.units[r]!;
    const row = rqRow(hot, top.kind, top.id);
    const empty = row >= hot.rq.len || rqLen(hot, row) === 0;
    if (empty && split(w, top.kind, top.id, r, units, units, true, w.tick)) {
      const t = takeHead(w, r);
      e.taskId = rec.taskId[t]!; e.family = rec.family[t]!; e.units = rec.units[t]!; e.parent = -1; e.record = t; e.taken = w.tick;
      e.deadline = rec.deadline[t]!;
      commit(w, e);
      continue;
    }
    if (queueFree(w, top.kind, top.id) > 0) {
      const t = takeHead(w, r);
      // D26.5: the window runs from this take; router-queue time counts. A windowed task waits as its parent's share.
      if (rec.deadline[t]! >= 0) {
        const p = openParent(w, rec.taskId[t]!, rec.family[t]!, rec.units[t]!, w.tick, rec.deadline[t]!);
        hot.parent.pending[p] = 1;
        rqPush(hot, row, rec.taskId[t]!, p, rec.units[t]!, rec.family[t]!, w.tick);
      } else rqPush(hot, row, rec.taskId[t]!, -1, rec.units[t]!, rec.family[t]!, w.tick);
      freeRecord(hot, t);
      continue;
    }
    dropProbe(w, r);
    return;
  }
}

export function routePhase(w: World): void {
  if (w.round.phase !== 'running' || !topRouter(w, top)) return;
  // A build or research change can let any blocked entry split: every router tries again.
  const stamp = w.build.revision * 4096 + w.research.completed.length;
  if (w.hot.g[G.routeStamp] !== stamp) { w.hot.g[G.routeStamp] = stamp; wakeAllRouters(w.hot); }
  // Mode changes and take-limit resets move the summaries unseen; their racks are recounted.
  refreshSummaries(w);
  resetRouted(w);
  // Summaries are exact from the recount through every take of this phase.
  withExactSummaries(w, () => {
    rebalance(w);
    dispatchAll(w);
    takeHeads(w);
  });
}

export { RACK, ROOM };
