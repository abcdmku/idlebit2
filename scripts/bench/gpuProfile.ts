// Focused CPU profile and clone timings, separate from the binding frame benchmark.
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector/promises';
import { advanceGame, advanceGameOwned, deriveRenderSnapshot } from '../../src/game';
import { cloneHot } from '../../src/game/core/buffers';
import { tableBytes } from '../../src/game/core/table';
import { gpuLoadedState } from '../../src/game/testkit/gpuLoaded';
import { gpuActivity } from './gpu';
import { sampleLoop } from './stats';

let state = advanceGame(gpuLoadedState(true), 100).state;
let snapshot: ReturnType<typeof deriveRenderSnapshot> | undefined;
// The platform path (D9); `--pure` profiles the pure reference.
const step = process.argv.includes('--pure') ? advanceGame : advanceGameOwned;
const frame = () => {
  state = step(state, 50).state;
  snapshot = deriveRenderSnapshot(state, { focus: { level: 'global', id: 0 }, partner: null }, snapshot);
};
for (let n = 0; n < 60; n++) frame();
const session = new Session(); session.connect();
await session.post('Profiler.enable');
await session.post('Profiler.setSamplingInterval', { interval: 100 });
await session.post('Profiler.start');
const frames = sampleLoop(300, 0, frame);
const { profile } = await session.post('Profiler.stop'); session.disconnect();
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parents = new Map<number, number>();
for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
const self = new Map<number, number>(), inclusive = new Map<number, number>();
for (let n = 0; n < (profile.samples?.length ?? 0); n++) {
  let id: number | undefined = profile.samples![n]!;
  const us = profile.timeDeltas?.[n] ?? 0;
  self.set(id, (self.get(id) ?? 0) + us);
  while (id !== undefined) { inclusive.set(id, (inclusive.get(id) ?? 0) + us); id = parents.get(id); }
}
const top = (times: Map<number, number>) => [...times].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .map(([id, us]) => ({ fn: nodes.get(id)!.callFrame.functionName,
    file: nodes.get(id)!.callFrame.url.split('/').slice(-2).join('/'), ms: us / 1000 }));
const cloneHotMs = sampleLoop(100, 10, () => { cloneHot(state.hot); });
let cloneFrame = 0;
// Match the benchmark's alternating carry-only/ticking allocation cadence, retaining each result.
const cloneOnlyFramesMs = sampleLoop(1_200, 60, () => {
  if (++cloneFrame % 2 === 0) state = { ...state, hot: cloneHot(state.hot) };
});
const structuredCloneMs = sampleLoop(30, 3, () => { structuredClone(state); });
const hotBytes = Object.fromEntries(Object.entries(state.hot).map(([key, value]) => [key,
  ArrayBuffer.isView(value) ? value.byteLength : tableBytes(value)]));
console.log(JSON.stringify({ frames, self: top(self), inclusive: top(inclusive), cloneHotMs, cloneOnlyFramesMs, structuredCloneMs,
  hotBytes, totalHotBytes: Object.values(hotBytes).reduce((sum, bytes) => sum + bytes, 0),
  stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex'), activity: gpuActivity(state) }, null, 2));
