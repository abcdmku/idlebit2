import type { CompletionView, ShardDoneView } from '../types/views';
import { familyType } from '../market/taskTypes';
import type { HotBuffers } from './buffers';
import { MAX_ACCELS, POOL_DOMAIN } from './constants';
import type { World } from './world';
import type { FailureLog } from './failures';

const CAPACITY = 2048;
const STRIDE = 16;
/** Finished non-final shards (D25.5): seq, tick, system, cpu, core, gpu, taskId, shard, tau. */
const SHARD_STRIDE = 9;
export interface ShardLog { values: Float64Array; next: number }
export interface CompletionLog { values: Float64Array; next: number; failures?: FailureLog; shards?: ShardLog }
/** Cosmetic history lives outside GameState, hot buffers and saves. */
const LOGS = new WeakMap<HotBuffers, CompletionLog>();
let nextSeq = 1;
let nextShardSeq = 1;

export function copyCompletionLog(from: HotBuffers, to: HotBuffers): void {
  const log = LOGS.get(from);
  // Pure advances fork the cosmetic ring with the hot buffers. Owned advances reuse it in place.
  if (log) LOGS.set(to, { values: log.values.slice(), next: log.next,
    failures: log.failures ? { values: log.failures.values.slice(), next: log.failures.next } : undefined,
    shards: log.shards ? { values: log.shards.values.slice(), next: log.shards.next } : undefined,
  });
}
export const completionCursor = (hot: HotBuffers): number => LOGS.get(hot)?.next ?? 0;
export const shardCursor = (hot: HotBuffers): number => LOGS.get(hot)?.shards?.next ?? 0;
export const completionLog = (hot: HotBuffers): CompletionLog | undefined => LOGS.get(hot);

/** One observer context for transient completion and failure histories. */
export function observeCompletionLog(hot: HotBuffers): CompletionLog {
  let log = LOGS.get(hot);
  if (!log) { log = { values: new Float64Array(CAPACITY * STRIDE), next: 0, failures: undefined, shards: undefined }; LOGS.set(hot, log); }
  return log;
}

/** Observation only: each snapshot owns its cursor, so reading one cannot consume another's pops. */
export function readCompletions(hot: HotBuffers, after = 0): readonly CompletionView[] {
  const log = LOGS.get(hot);
  if (!log) {
    // First view starts capture. Structured-cloned worker states have no observer, so offline
    // execution never allocates a ring or computes component attribution nobody will display.
    observeCompletionLog(hot);
    return [];
  }
  const out: CompletionView[] = [];
  const v = log.values, nullable = (n: number): number | null => n < 0 ? null : n;
  for (let seq = Math.max(after, log.next - CAPACITY); seq < log.next; seq += 1) {
    const p = (seq % CAPACITY) * STRIDE;
    out.push({
      seq: v[p]!, taskId: v[p + 13]!, shards: v[p + 14]!, work: v[p + 15]!, tick: v[p + 1]!, system: v[p + 2]!, rack: nullable(v[p + 3]!), room: nullable(v[p + 4]!), site: nullable(v[p + 5]!),
      cpu: nullable(v[p + 6]!), core: nullable(v[p + 7]!), gpu: nullable(v[p + 8]!), type: familyType(v[p + 9]!),
      credits: v[p + 10]!, data: v[p + 11]!, tau: v[p + 12]!,
    });
  }
  return out;
}

/** Same CPU-stage oldest-take packing as chipSnapshot; IO/RAM completions use that pooled projection. */
function cpuCore(w: World, s: number, r: number): number {
  const c = w.compiled.sys, rec = w.hot.rec;
  let before = 0;
  const tpc = Math.max(1, c.threads[s]! / Math.max(1, c.cores[s]!));
  for (let other = w.hot.sys.head[s * 4]!; other >= 0; other = rec.next[other]!) {
    if (rec.taken[other]! < rec.taken[r]! || rec.taken[other] === rec.taken[r] && rec.taskId[other]! < rec.taskId[r]!)
      before += Math.max(1, Math.ceil(rec.count[other]! * rec.threads[other]! / tpc));
  }
  return Math.min(Math.max(1, c.cores[s]!) - 1, before);
}

/** The GPU slot shown for an accelerator domain (the first card of a linked pool), or -1. */
function gpuSlot(w: World, s: number, domain: number): number {
  if (domain >= 0 && domain < POOL_DOMAIN) return domain;
  if (domain === POOL_DOMAIN) {
    for (let slot = 0; slot < MAX_ACCELS; slot += 1) if (w.compiled.sys.accelKind[s * MAX_ACCELS + slot] === 1) return slot;
  }
  return -1;
}

/**
 * Called once per met task (D25.5): an unsplit record, or the last shard of a split task, where
 * `credits` is the full payout W and `shards` the task's shard count. `domain` was captured before release.
 */
export function recordCompletion(w: World, s: number, r: number, count: number, credits: number, tau: number, domain: number, shards: number): void {
  const log = w.completions;
  if (!log) return;
  const family = w.hot.rec.family[r]!, taskId = w.hot.rec.taskId[r]!;
  const gpu = gpuSlot(w, s, domain);
  const core = domain < 0 ? cpuCore(w, s, r) : -1;
  const perCpu = Math.max(1, w.compiled.sys.cores[s]! / Math.max(1, w.compiled.sys.sockets[s]!));
  const ratio = w.hot.fam.dataRatio[family]!;
  const c = w.compiled, rack = c.sys.rack[s]!, room = c.sys.room[s]!, site = c.sys.site[s]!;
  // Cohorts represent several identical task completions. Keep one pop per task, bounded even offline.
  const retained = Math.min(count, CAPACITY);
  log.next += count - retained;
  const values = log.values;
  for (let i = 0; i < retained; i += 1) {
    const p = (log.next % CAPACITY) * STRIDE;
    values[p] = nextSeq++; values[p + 1] = w.tick; values[p + 2] = s;
    values[p + 3] = c.rack.opened[rack] === 1 ? rack : -1;
    values[p + 4] = c.room.opened[room] === 1 ? room : -1;
    values[p + 5] = c.site.opened[site] === 1 ? site : -1;
    values[p + 6] = core < 0 ? -1 : Math.floor(core / perCpu); values[p + 7] = core < 0 ? -1 : core % perCpu;
    values[p + 8] = gpu; values[p + 9] = family; values[p + 10] = credits;
    values[p + 11] = ratio > 0 ? credits / ratio : 0; values[p + 12] = tau;
    values[p + 13] = taskId + (count - retained) + i; values[p + 14] = shards; values[p + 15] = credits;
    log.next += 1;
  }
}

/** A finished non-final shard: a no-pay "slot freed" mark at its system and component (D25.5). */
export function recordShardDone(w: World, s: number, r: number, tau: number, domain: number): void {
  const log = w.completions;
  if (!log) return;
  const shards = log.shards ??= { values: new Float64Array(CAPACITY * SHARD_STRIDE), next: 0 };
  const gpu = gpuSlot(w, s, domain);
  const core = domain < 0 ? cpuCore(w, s, r) : -1;
  const perCpu = Math.max(1, w.compiled.sys.cores[s]! / Math.max(1, w.compiled.sys.sockets[s]!));
  const v = shards.values, p = (shards.next % CAPACITY) * SHARD_STRIDE;
  v[p] = nextShardSeq++; v[p + 1] = w.tick; v[p + 2] = s;
  v[p + 3] = core < 0 ? -1 : Math.floor(core / perCpu); v[p + 4] = core < 0 ? -1 : core % perCpu; v[p + 5] = gpu;
  v[p + 6] = w.hot.rec.taskId[r]!; v[p + 7] = w.hot.rec.shard[r]!; v[p + 8] = tau;
  shards.next += 1;
}

/** Finished non-final shards since cursor `after` (newest 2,048). Observation only. */
export function readShardsDone(hot: HotBuffers, after = 0): readonly ShardDoneView[] {
  const log = LOGS.get(hot)?.shards;
  if (!log) return [];
  const out: ShardDoneView[] = [];
  const v = log.values, nullable = (n: number): number | null => n < 0 ? null : n;
  for (let seq = Math.max(after, log.next - CAPACITY); seq < log.next; seq += 1) {
    const p = (seq % CAPACITY) * SHARD_STRIDE;
    out.push({ seq: v[p]!, tick: v[p + 1]!, system: v[p + 2]!, cpu: nullable(v[p + 3]!), core: nullable(v[p + 4]!),
      gpu: nullable(v[p + 5]!), taskId: v[p + 6]!, shard: v[p + 7]!, tau: v[p + 8]! });
  }
  return out;
}
