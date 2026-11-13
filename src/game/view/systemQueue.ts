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

/**
 * Why system s starts no queued task although a core is free, read from the same checks the scheduler makes
 * (exec/est.ts startable). Names the oldest queued task's wait. Null when a task can start or nothing is held.
 */
export function selectQueueHold(state: GameState, s: number): QueueHoldView | null {
  const w = state as unknown as World, rec = state.hot.rec, h = state.hot.sys, c = state.compiled.sys;
  if (state.round.phase !== 'running' || !runsTasks(h.mode[s]!) || !(h.queueLen[s]! > 0)) return null;
  const strategy = strategyOf(w, s), free = c.threads[s]! - h.busyThreads[s]!;
  if (!strategy.timeSlice && free <= 0) return null;
  if (h.running[s]! >= keffOf(w, s) - (h.researchThreads[s]! > 0 ? 1 : 0) || strategy.pickQueue(w, s) >= 0) return null;
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
