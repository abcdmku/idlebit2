import { LOC } from '../core/buffers';
import type { GameState } from '../types/state';
import { FAMILIES } from '../market/families';

type Fail = (path: string, what: string) => never;
const nonnegative = (n: number) => Number.isFinite(n) && n >= 0;

/** Validate cache ownership and physical loader assignment before resuming a saved work clock. */
export function validatePreload(state: GameState, fail: Fail): void {
  const h = state.hot.sys, rec = state.hot.rec, c = state.compiled.sys;
  for (let s = 0; s < c.len; s++) {
    const sched = state.build.systems[s]?.spec.scheduler;
    const budget = state.build.systems[s]?.spec.settings.queueLoaderLimit;
    if (budget !== undefined && budget !== 1 && budget !== 2 && budget !== 4)
      fail(`build.systems[${s}].spec.settings.queueLoaderLimit`, 'expected 1, 2, or 4 cores');
    if (sched?.optimization !== undefined && sched.optimization !== 'preload' && sched.optimization !== 'utilization')
      fail(`build.systems[${s}].spec.scheduler.optimization`, 'unknown queue optimization');
    if (sched?.batching !== undefined && typeof sched.batching !== 'boolean') fail(`build.systems[${s}].spec.scheduler.batching`, 'expected a boolean');
    if (c.queuePreload[s] !== (sched?.optimization === 'preload' ? 1 : 0) || c.queueBatching[s] !== (sched?.batching ? 1 : 0))
      fail(`compiled.sys.queuePreload[${s}]`, 'does not match queue settings');
    if (!nonnegative(h.batchSavedBits[s]!)) fail(`hot.sys.batchSavedBits[${s}]`, 'invalid reused bit count');
    const r = h.preloadRec[s]!, thread = h.preloadThread[s]!;
    if (r < 0) {
      if (r !== -1 || thread !== -1 || h.preloadFinish[s] !== Infinity) fail(`hot.sys.preloadRec[${s}]`, 'orphan loader');
      continue;
    }
    if (r >= rec.len || rec.loc[r] !== LOC.queue || rec.owner[r] !== s || rec.count[r] !== 1)
      fail(`hot.sys.preloadRec[${s}]`, 'loader must own one queued task');
    if (!sched || rec.preloadBits[r]! > c.cacheBits[s]! || rec.preloadBits[r]! > h.usedCache[s]! + 1e-8)
      fail(`hot.rec.preloadBits[${r}]`, 'cache reservation exceeds held cache');
    if (thread < -1 || thread >= c.threads[s]! || !Number.isFinite(h.preloadStart[s]!)) fail(`hot.sys.preloadThread[${s}]`, 'invalid physical core');
    if (thread >= 0 ? !Number.isFinite(h.preloadFinish[s]!) || h.preloadFinish[s]! < h.preloadStart[s]! : h.preloadFinish[s] !== Infinity)
      fail(`hot.sys.preloadFinish[${s}]`, 'invalid work-clock deadline');
  }
  for (let r = 0; r < rec.len; r++) {
    if (rec.loc[r] === LOC.free) continue;
    if (![rec.preloadBits[r]!, rec.preloadDone[r]!, rec.batchBits[r]!].every(nonnegative)) fail(`hot.rec.preloadDone[${r}]`, 'invalid loaded bits');
    const queued = rec.loc[r] === LOC.queue;
    if (!queued && rec.loaderThread[r] !== -1) fail(`hot.rec.loaderThread[${r}]`, 'only queued tasks hold loader cores');
    if (rec.loaderThread[r] === -1 && rec.loaderFinish[r] !== Infinity) fail(`hot.rec.loaderFinish[${r}]`, 'inactive loader has a deadline');
    if (queued && rec.preloadBits[r]! > 0 && rec.count[r] !== 1) fail(`hot.rec.preloadBits[${r}]`, 'preparation must own one task');
    if (!queued && rec.preloadBits[r] !== 0) fail(`hot.rec.preloadBits[${r}]`, 'only queued tasks reserve preload cache');
    const limit = queued ? rec.preloadBits[r]! : rec.loc[r] === LOC.running ? rec.memC[r]! : 0;
    if (rec.preloadDone[r]! > limit + 1e-8 || rec.batchBits[r]! > rec.preloadDone[r]! + 1e-8)
      fail(`hot.rec.preloadDone[${r}]`, 'loaded prefix exceeds cache');
  }
  for (let s = 0; s < c.len; s++) {
    const threads = new Set<number>();
    let prepared = 0, bits = 0;
    for (let r = h.queueHead[s]!; r >= 0; r = rec.next[r]!) {
      if (rec.preloadBits[r]! > 0) { prepared++; bits += rec.preloadBits[r]!; }
      if (rec.loaderThread[r]! < 0) continue;
      const thread = rec.loaderThread[r]!;
      if (!Number.isInteger(thread) || thread >= c.threads[s]! || threads.has(thread)) fail('hot.rec.loaderThread', 'duplicate or invalid loader core');
      threads.add(thread);
      if (!Number.isFinite(rec.loaderStart[r]!) || !Number.isFinite(rec.loaderFinish[r]!) || rec.loaderFinish[r]! < rec.loaderStart[r]!)
        fail('hot.rec.loaderFinish', 'invalid loader work clock');
    }
    if (prepared > c.preloadTargets[s]! || threads.size > c.preloadLoaders[s]!) fail('hot.sys.preloadRec', 'preparation exceeds researched limit');
    if (!nonnegative(h.residentBits[s]!) || h.residentBits[s]! > c.cacheBits[s]! || bits + h.residentBits[s]! > h.usedCache[s]! + 1e-6)
      fail('hot.sys.residentBits', 'invalid cache ownership');
    const family = FAMILIES[h.residentFamily[s]!];
    if (h.residentBits[s]! > 0 ? !family || c.residentWorkspace[s] !== 1 || h.residentBits[s]! > family.workingSet.fixed : h.residentFamily[s] !== -1)
      fail('hot.sys.residentFamily', 'invalid resident workspace');
  }
}
