// One-server preparation check. No maximum-fleet or two-hour timing run.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { advanceGame, deserializeSave, serializeSave } from '../../src/game';
import { gpuLoadedState } from '../../src/game/testkit/gpuLoaded';
import { validateState } from '../../src/game/save/validate';
import { FAMILIES, stageWork } from '../../src/game/market/families';
import { installedGpuStats } from '../../src/game/build/gpu';
import { gameOfflineEngine } from '../../src/platform/offline';
import { createOfflineRunner } from '../../src/platform/offlineRunner';
import { gpuActivity } from './gpu';

const source = gpuLoadedState(), original = structuredClone(source);
assert.equal(validateState(source).ok, true);
const warmed = advanceGame(source, 100).state;
assert.deepStrictEqual(source, original);
const direct = advanceGame(warmed, 1_300).state;
let partitioned = warmed;
for (const ms of [1, 49, 57, 93, 333, 67, 700]) partitioned = advanceGame(partitioned, ms).state;
assert.deepStrictEqual(partitioned, direct);
assert.deepStrictEqual(structuredClone(direct), direct);
const save = serializeSave(partitioned), loaded = deserializeSave(save);
assert.equal(loaded.ok, true);
assert.deepStrictEqual(loaded.state, direct);
assert.deepStrictEqual(advanceGame(loaded.state, 300).state, advanceGame(direct, 300).state);
const worker = new Worker(new URL('./offlineWorker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
const runner = createOfflineRunner({ engine: gameOfflineEngine, createWorker: () => ({
  postMessage: message => worker.postMessage(message),
  listen(onMessage, onError) { worker.on('message', onMessage); worker.on('error', onError); },
  terminate: () => { void worker.terminate(); },
}) });
try {
  await runner.run({ state: warmed, elapsedMs: 333, returnState: false });
  const result = await runner.run({ elapsedMs: 967, returnState: true });
  assert.equal(runner.mode, 'worker');
  assert.deepStrictEqual(result.state, direct);
} finally { runner.dispose(); }
const activity = [gpuActivity(warmed), gpuActivity(direct)];
for (const sample of activity) {
  assert.equal(sample.runningSystems, 1);
  assert.equal(sample.busyCards, 8);
  assert.equal(sample.gpuStageTasks, 8);
  assert.equal(sample.failed, 0);
  assert.equal(sample.round, 'running');
  assert.ok(Math.abs(sample.taskDuty - 8) < 1e-12);
}
const card = source.build.systems[0]!.spec.accels[0]!;
assert.equal(card.kind, 'gpu');
if (card.kind !== 'gpu') throw new Error('Expected GPU');
const stats = installedGpuStats(card, source.research.unlocks);
const family = FAMILIES.find(f => f.key === 'rayTrace')!;
const scale = source.hot.rec.units[source.hot.sys.queueHead[0]!]!;
const work = stageWork(family.stages[0]!, scale);
const c = source.compiled.sys;
const fullSystemW = c.coreIdleW[0]! + c.coreLoadW[0]! + c.clockIdleW[0]!
  + [0, 1, 2, 3].reduce((n, r) => n + c.idleW[r]! + c.loadW[r]!, 0);
const report = {
  preparedAt: new Date().toISOString(), scope: 'one-server smoke only',
  passed: ['input immutability', 'structural validation', 'uneven delta partitions including RNG/events/Amount',
    'structured clone equality', 'save round-trip and continuation', 'real worker session continuation equality'],
  profile: { model: card.model, scale, cores: stats.cores, clockHz: stats.clockHz,
    vramBits: stats.vramBits, opsPerS: stats.opsPerS, workOps: work, taskSecondsAtCatalogRate: work / stats.opsPerS,
    measuredSpanMs: 63_100, fullSystemW, psuCapW: c.psuCapW[0],
    psuHeadroomW: c.psuCapW[0]! - fullSystemW, rackCoolerQcW: source.compiled.rack.coolerQc[0],
    twelveSystemW: fullSystemW * 12, twelveSystemCoolerHeadroomW: source.compiled.rack.coolerQc[0]! - fullSystemW * 12 },
  activity, saveBytes: Buffer.byteLength(save),
  limits: 'Gifted research/wallet and pre-admitted actual tasks. No legal progression, max-fleet timing or two-hour evidence.',
};
mkdirSync('artifacts/gpu/performance', { recursive: true });
writeFileSync('artifacts/gpu/performance/smoke.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
