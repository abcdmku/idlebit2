import { MAX_SCHED_Q } from '../core/constants';
import type { World } from '../core/world';
import { freeHierarchy } from '../exec/memory';
import { startable } from '../exec/est';
import { keffOf, runsTasks } from '../exec/slots';
import { strategyOf } from '../exec/schedulers';
import type { QueueHoldView } from '../types/snapshot';
import { shapeOf, wantThreads, workingSetOf } from '../exec/shape';
import { FAMILIES, payoutAt, payoutCreditsAt } from '../market/families';
import type { GameState } from '../types/state';
import type { SystemId } from '../types/ids';
import type { SystemQueueTaskView } from '../types/views';
import { QUEUE_STRATEGY_IDS } from '../types/catalog';
import { preloadForRecord } from './preload';
import { G } from '../core/buffers';
import { detailIndex } from '../market/fleet';
import { FAIL_DETAILS } from '../types/events';
import { fleetGates } from './capability';
import { pickupWait } from './pickup';

/**
 * Why system s starts no queued task although a core is free, read from the same checks the scheduler makes
 * (exec/est.ts startable). Names the oldest queued task's wait. Null when a task can start or nothing is held.
 */
export function selectQueueHold(state: GameState, s: number): QueueHoldView | null {
  const w = state as unknown as World, rec = state.hot.rec, h = state.hot.sys, c = state.compiled.sys;
  if (state.round.phase !== 'running' || !runsTasks(h.mode[s]!)) return null;
  const strategy = strategyOf(w, s), free = c.threads[s]! - h.busyThreads[s]!;
  // Every core (or run slot) is taken: queued tasks wait their turn.
  if (!strategy.timeSlice && free <= 0 || h.running[s]! >= keffOf(w, s) - (h.researchThreads[s]! > 0 ? 1 : 0))
    return h.queueLen[s]! > 0 ? { reason: 'busy', coresWanted: 0 } : null;
  // Nothing queued: the wait is upstream, at the market head.
  if (!(h.queueLen[s]! > 0)) return pickupHold(state, s);
  if (strategy.pickQueue(w, s) >= 0) return null;
  let r = h.queueHead[s]!;
  for (let q = rec.next[r]!; q >= 0; q = rec.next[q]!)
    if (rec.taken[q]! < rec.taken[r]! || rec.taken[q] === rec.taken[r] && rec.taskId[q]! < rec.taskId[r]!) r = q;
  const shape = shapeOf(rec.family[r]!), units = rec.units[r]!;
  const coresWanted = Math.min(c.threads[s]!, wantThreads(shape, units));
  const preload = !strategy.timeSlice && c.queuePreload[s] === 1;
  let reason: QueueHoldView['reason'] = 'device';
  if (preload && rec.loaderThread[r]! >= 0) reason = 'loading';
  else if (preload && free < coresWanted) reason = 'cores';
  else if (workingSetOf(shape, units) - rec.preloadBits[r]! > freeHierarchy(w, s))
    reason = c.ramCap[s]! + c.storageCap[s]! > 0 || c.diskNode[s]! >= 0 ? 'memory' : 'cache';
  return { reason, coresWanted };
}

/** Why the market head is not arriving at an idle system, or null when it is on its way or there is none. */
function pickupHold(state: GameState, s: number): QueueHoldView | null {
  const hot = state.hot, front = hot.g[G.frontHead] ?? -1, next = state.market.window[0];
  const family = front >= 0 ? hot.rec.family[front]! : next?.family, size = front >= 0 ? hot.rec.units[front]! : next?.size;
  const def = family === undefined ? undefined : FAMILIES[family];
  if (!def || size === undefined) return null;
  const hold = (reason: QueueHoldView['reason'], more: Partial<QueueHoldView> = {}): QueueHoldView => ({ reason, coresWanted: 0, ...more });
  const wait = pickupWait(state, def, size);
  if (wait === 'research') return hold('research');
  const gate = fleetGates(state)(def, size);
  if (gate !== 0) return hold('needs', { detail: FAIL_DETAILS[detailIndex(gate)] ?? null });
  if (wait === 'link') return hold('link');
  if (wait === 'routerQueue') return hold('router');
  // The lone system's pipe carries one transfer at a time; a second or more left is worth naming.
  const speed = state.compiled.sys.pipeSpeed[s] ?? 0, left = hot.sys.pipeRec[s]! >= 0 && speed > 0 ? hot.sys.pipeLeft[s]! / speed : 0;
  return wait === 'transfer' && left >= 1 ? hold('transfer', { seconds: left }) : null;
}

/** The hardware queue, in admission order. Market offers are a separate list. Pure, lazy reads. */
export function selectSystemQueue(state: GameState, system: SystemId): readonly SystemQueueTaskView[] {
  if (!state.build.systems[system]) return [];
  const w = state as unknown as World, rec = state.hot.rec, h = state.hot.sys, c = state.compiled.sys;
  const s = system, out: SystemQueueTaskView[] = [];
  const free = Math.max(0, c.threads[s]! - h.busyThreads[s]!);
  const sliced = QUEUE_STRATEGY_IDS[c.strategy[s]!] === 'timeSlice';
  for (let r = h.queueHead[s]!; r >= 0 && out.length < MAX_SCHED_Q; r = rec.next[r]!) {
    const def = FAMILIES[rec.family[r]!]!, shape = shapeOf(def.id), units = rec.units[r]!;
    const coresWanted = Math.min(c.threads[s]!, wantThreads(shape, units));
    const ws = workingSetOf(shape, units), own = rec.preloadBits[r]!;
    const prep = preloadForRecord(state, s, r), preloading = prep?.active ?? false;
    let waitingFor: SystemQueueTaskView['waitingFor'] = 'ready';
    if (preloading) waitingFor = 'preload';
    else if (!sliced && (free === 0 || c.queuePreload[s] === 1 && free < coresWanted)) waitingFor = 'cores';
    else if (ws - own > freeHierarchy(w, s)) waitingFor = 'memory';
    else if (h.running[s]! >= keffOf(w, s) - (h.researchThreads[s]! > 0 ? 1 : 0)) waitingFor = 'slots';
    else if (!startable(w, s, r, sliced)) waitingFor = 'device';
    const p = rec.parent[r]!, whole = p >= 0 ? state.hot.parent.units[p]! : units;
    out.push({
      key: `${state.epoch}:${rec.taskId[r]!}:${rec.shard[r]!}`, taskId: rec.taskId[r]!, family: def.id, label: def.name,
      credits: payoutCreditsAt(def, whole), dataReward: payoutAt(def, whole) / (state.hot.fam.dataRatio[def.id] || def.dataRatio),
      coresWanted, coresAvailable: free, workingSetBits: ws,
      cacheTargetBits: prep?.targetBits ?? Math.min(ws, c.cacheBits[s]!),
      loadedBits: prep?.loadedBits ?? rec.preloadDone[r]!, preloading, waitingFor,
    });
  }
  return out;
}
