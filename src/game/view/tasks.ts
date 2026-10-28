import { LOC, type HotBuffers } from '../core/buffers';
import { ACCEL_CLOCKS, DT_S, RES_CLOCKS } from '../core/constants';
import { isEAxis } from '../exec/clocks';
import { isLoadingPart } from '../exec/memory';
import { FAMILIES } from '../market/families';
import type { Resource } from '../types/catalog';
import { familyId } from '../types/ids';
import type { GameState } from '../types/state';
import { shardKey, shardOf } from './flows';
import { taskRequirements } from './taskRequirements';
import { placementOf } from './memory';
import type { TaskView } from '../types/views';

const R = RES_CLOCKS;
/** Clock index (exec/shape CPU, RAM, GPU, IO) → the stage resource it serves (D26.2: RAM and disk parts are mem). */
const RES_NAME: readonly Resource[] = ['compute', 'mem', 'gpu', 'mem'];

/**
 * CPU clock on the rack efficiency axis; RAM and IO clocks on plain time.
 * Accelerator stages read their assigned clock in stageProgress.
 */
export function workClock(hot: HotBuffers, tick: number, rack: number, s: number, res: number): number {
  const i = s * R + res;
  const x = isEAxis(res) ? (hot.rack.effClock[rack] ?? 0) : tick * DT_S;
  return (hot.sys.wAnchor[i] ?? 0) + (hot.sys.rate[i] ?? 0) * (x - (hot.sys.eAnchor[i] ?? 0));
}

/** Fraction of the record's current stage done, 0..1: (W − start) / (finish − start). */
export function stageProgress(hot: HotBuffers, tick: number, r: number, rack: number, s: number, res: number): number {
  const start = hot.rec.start[r] ?? 0, finish = hot.rec.finish[r] ?? 0;
  if (!(finish > start) || !Number.isFinite(finish)) return 0;
  const domain = hot.rec.accelDomain[r] ?? -1;
  let clock: number;
  if (res === 2) {
    if (domain < 0) return 0;
    const tensor = FAMILIES[hot.rec.family[r] ?? 0]?.tensor ? 1 : 0;
    const i = s * ACCEL_CLOCKS + 2 * domain + tensor;
    clock = (hot.sys.accelWAnchor[i] ?? 0) + (hot.sys.accelRate[i] ?? 0)
      * ((hot.rack.effClock[rack] ?? 0) - (hot.sys.accelEAnchor[i] ?? 0));
  } else clock = workClock(hot, tick, rack, s, res);
  return Math.max(0, Math.min(1, (clock - start) / (finish - start)));
}

export function taskView(hot: HotBuffers, r: number, res: number, progress: number): TaskView {
  const domain = hot.rec.accelDomain[r] ?? -1;
  const taskId = hot.rec.taskId[r] ?? 0, { shard, shards } = shardOf(hot, r);
  const p = hot.rec.parent[r] ?? -1;
  const deadline = (hot.rec.deadline[r] ?? -1) >= 0 ? hot.rec.deadline[r]! : null;
  const taken = hot.rec.taken[r] ?? 0;
  // Requirements are the whole task's (its size); `units` is this shard's share.
  return {
    ...taskRequirements(familyId(hot.rec.family[r] ?? 0), p >= 0 ? (hot.parent.units[p] ?? 0) : (hot.rec.units[r] ?? 0), deadline),
    accelDomain: domain >= 0 ? domain : null,
    taskId, shard, shards, units: hot.rec.units[r] ?? 0,
    threads: hot.rec.loc[r] === LOC.running ? (hot.rec.threads[r] ?? 0) * (hot.rec.count[r] ?? 1) : 0,
    key: shardKey(taskId, shard), family: familyId(hot.rec.family[r] ?? 0), count: hot.rec.count[r] ?? 0,
    stage: hot.rec.stage[r] ?? 0,
    resource: hot.rec.loc[r] === LOC.running && (isLoadingPart(hot.rec.part[r] ?? 0)
      || res === 0 && FAMILIES[hot.rec.family[r] ?? 0]?.stages[hot.rec.stage[r] ?? 0]?.resource === 'mem')
      ? 'mem' : RES_NAME[res] ?? 'compute',
    progress,
    ...placementOf(hot, r, res),
    windowEndTick: deadline === null ? null : taken + deadline - 1,
  };
}

/**
 * Visits CPU, RAM, ordinary/tensor accelerator clocks, then IO, each list front to back.
 * Stops when `visit` returns false.
 */
export function forEachRunning(state: GameState, s: number, visit: (r: number, res: number) => boolean | void): void {
  const hot = state.hot;
  for (let res = 0; res < R; res += 1) {
    const clocks = res === 2 ? ACCEL_CLOCKS : 1;
    for (let clock = 0; clock < clocks; clock += 1) {
      let r = res === 2 ? (hot.sys.accelHead[s * ACCEL_CLOCKS + clock] ?? -1) : (hot.sys.head[s * R + res] ?? -1);
      while (r >= 0) {
        if (visit(r, res) === false) return;
        r = hot.rec.next[r] ?? -1;
      }
    }
  }
}

/** Up to `limit` running tasks of system `s`. */
export function runningTasks(state: GameState, s: number, limit: number): TaskView[] {
  const out: TaskView[] = [];
  if (limit <= 0) return out;
  const rack = state.compiled.sys.rack[s] ?? 0;
  forEachRunning(state, s, (r, res) => {
    const threadsPerCpu = (state.compiled.sys.threads[s] ?? 0) / Math.max(1, state.build.systems[s]?.spec.cpuCount ?? 1);
    const firstThread = state.hot.rec.thread0[r] ?? -1;
    out.push({ ...taskView(state.hot, r, res, stageProgress(state.hot, state.clock.tick, r, rack, s, res)),
      ...(firstThread >= 0 && threadsPerCpu > 0 ? { socket: Math.floor(firstThread / threadsPerCpu) } : {}) });
    return out.length < limit;
  });
  return out;
}

/** Queued tasks of system `s` from position `offset`, at most `limit`. Queued tasks wait on their first stage. */
export function queuedTasks(state: GameState, s: number, offset: number, limit: number): TaskView[] {
  const hot = state.hot;
  const out: TaskView[] = [];
  let r = hot.sys.queueHead[s] ?? -1;
  for (let i = 0; r >= 0 && out.length < limit; i += 1) {
    if (i >= offset) out.push(taskView(hot, r, resourceOfStage(state, r), 0));
    r = hot.rec.next[r] ?? -1;
  }
  return out;
}

/** Resource of the record's current stage, from the family catalog; cpu while the catalog is empty. */
export function resourceOfStage(state: GameState, r: number): number {
  const fam = FAMILIES[state.hot.rec.family[r] ?? 0];
  const stage = fam?.stages[state.hot.rec.stage[r] ?? 0];
  return stage ? RES_NAME.indexOf(stage.resource) : 0;
}
