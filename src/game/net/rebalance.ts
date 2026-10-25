import { G, LINK_KIND, LOC } from '../core/buffers';
import { RACKS_PER_ROOM, SERVERS_PER_RACK } from '../core/constants';
import { MODE } from '../core/timers';
import type { World } from '../core/world';
import { failParent } from '../exec/outcome';
import { hasRule } from '../exec/rules';
import { queueUnlink } from '../exec/lists';
import { canAdmit, keffOf, noteAdmit, noteAdmitted, reserve } from '../exec/slots';
import { addTransit } from './fifo';
import { forward } from './links';
import { placeShard } from './hops';
import { canTake } from './split';

/**
 * Start of the route phase's dispatch step (spec §7.6, §7.8 item 7, D25.9):
 * - checkpoint replacements: a lost shard's replacement goes to the first system with room in its
 *   rack, until its 10 s deadline; then its task fails with the lost shard's cause;
 * - shard stealing (`shardSteal`, `stealRoom`): each onMarket system with a free running slot and
 *   an empty queue takes the newest not-started shard queued on another system of its rack (zone).
 */
export function rebalance(w: World): void {
  if (w.hot.g[G.replacing]! > 0) replace(w);
  const zone = hasRule(w, 'stealRoom');
  if (zone || hasRule(w, 'shardSteal')) steal(w, zone);
}

function replace(w: World): void {
  const par = w.hot.parent, c = w.compiled;
  for (let p = 0; p < par.len; p += 1) {
    if (par.replaceDeadline[p]! < 0 || par.placed[p]! + par.pending[p]! === 0) continue;
    if (w.tick > par.replaceDeadline[p]!) { failParent(w, p, par.lostCause[p]!); continue; }
    const rack = par.replaceRack[p]!;
    if (rack < 0) continue;
    for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
      const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
      if (s < 0 || c.sys.alive[s] !== 1 || c.sys.kind[s] !== 0 || !canTake(w, s)) continue;
      par.replaceDeadline[p] = -1;
      w.hot.g[G.replacing] = w.hot.g[G.replacing]! - 1;
      placeShard(w, p, s, par.replaceUnits[p]!, par.replaceShard[p]!);
      break;
    }
  }
}

/** The newest not-started shard queued on system s, or -1. */
function newestShard(w: World, s: number): number {
  const rec = w.hot.rec;
  let best = -1;
  for (let r = w.hot.sys.queueHead[s]!; r >= 0; r = rec.next[r]!) {
    if (rec.parent[r]! < 0 || rec.count[r] !== 1) continue;
    if (best < 0 || rec.taken[r]! > rec.taken[best]! || (rec.taken[r] === rec.taken[best] && rec.taskId[r]! > rec.taskId[best]!)) best = r;
  }
  return best;
}

/** Systems of one steal group (a rack, or a room with stealRoom), in index order. */
const group: number[] = [];

function steal(w: World, zone: boolean): void {
  if (w.hot.g[G.queued]! <= 0) return;
  const c = w.compiled;
  if (zone) {
    for (let m = 0; m < c.room.len; m += 1) {
      // A thief can admit now: a room or rack with no free slot has none (exact summaries, D24).
      if (c.room.alive[m] !== 1 || w.hot.room.freeSlots[m] === 0) continue;
      let queued = false;
      for (let k = 0; k < RACKS_PER_ROOM && !queued; k += 1) {
        const rack = c.room.racks[m * RACKS_PER_ROOM + k]!;
        if (rack >= 0 && rackQueued(w, rack)) queued = true;
      }
      if (!queued) continue;
      group.length = 0;
      for (let k = 0; k < RACKS_PER_ROOM; k += 1) {
        const rack = c.room.racks[m * RACKS_PER_ROOM + k]!;
        if (rack >= 0) collect(w, rack);
      }
      group.sort((a, b) => a - b);
      stealIn(w);
    }
    return;
  }
  for (let rack = 0; rack < c.rack.len; rack += 1) {
    if (c.rack.alive[rack] !== 1 || w.hot.rack.freeSlots[rack] === 0 || !rackQueued(w, rack)) continue;
    group.length = 0;
    collect(w, rack);
    group.sort((a, b) => a - b);
    stealIn(w);
  }
}

/** Some system of rack `rack` has a queued task (a possible victim). */
function rackQueued(w: World, rack: number): boolean {
  const servers = w.compiled.rack.servers, queueLen = w.hot.sys.queueLen;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = servers[rack * SERVERS_PER_RACK + k]!;
    if (s >= 0 && queueLen[s]! > 0) return true;
  }
  return false;
}

function collect(w: World, rack: number): void {
  const c = w.compiled;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
    if (s >= 0 && c.sys.alive[s] === 1 && c.sys.kind[s] === 0) group.push(s);
  }
}

/** Thieves in index order; each steals once from the highest-index system with a queued shard. */
function stealIn(w: World): void {
  const c = w.compiled, h = w.hot.sys, rec = w.hot.rec;
  let queued = false;
  for (const s of group) if (h.queueLen[s]! > 0) { queued = true; break; }
  if (!queued) return;
  // Victims are scanned from the highest index down. Queues only shrink here and a thief's own
  // queue is empty, so a system skipped once stays skipped: one cursor serves every thief.
  let at = group.length - 1;
  for (const s of group) {
    if (h.mode[s] !== MODE.onMarket || h.queueLen[s] !== 0) continue;
    if (h.running[s]! + h.reserved[s]! >= keffOf(w, s) || !canAdmit(w, s)) continue;
    let victim = -1, shard = -1;
    for (; at >= 0; at -= 1) {
      const v = group[at]!;
      if (h.queueLen[v] === 0) continue;
      const r = newestShard(w, v);
      if (r >= 0) { victim = v; shard = r; break; }
    }
    if (victim < 0) return;
    const before = canAdmit(w, victim);
    queueUnlink(w.hot, victim, shard);
    h.queueLen[victim] = h.queueLen[victim]! - 1;
    w.hot.g[G.queued] = w.hot.g[G.queued]! - 1;
    noteAdmitted(w, victim, -1, shard);
    noteAdmit(w, victim, before);
    rec.loc[shard] = LOC.free;
    reserve(w, s, 1, shard);
    rec.target[shard] = s;
    addTransit(w.hot, 1);
    // Below the lowest shared router: the thief's server port, or its rack uplink then port.
    forward(w, shard, c.sys.rack[victim] === c.sys.rack[s] ? LINK_KIND.rack : LINK_KIND.zone, hasRule(w, 'qos'));
  }
}
