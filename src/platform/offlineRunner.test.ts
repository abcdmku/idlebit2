import { describe, expect, it } from 'vitest';
import { createOfflineMessageHandler, type OfflineEngine } from './offlineHandler';
import { advanceGame, createInitialState, serializeSave } from '../game';
import { gameOfflineEngine } from './offline';
import { createOfflineRunner, type OfflineWorkerPort } from './offlineRunner';

interface FakeState { readonly carry: number; readonly ticks: number; readonly bumps: number }
const engine: OfflineEngine<FakeState, number, 'bump'> = {
  advance(state, elapsedMs) {
    const carry = state.carry + elapsedMs, ticks = Math.floor(carry / 100);
    return { state: { ...state, carry: carry % 100, ticks: state.ticks + ticks }, report: ticks };
  },
  own: state => ({ ...state }),
  merge: (total, next) => (total ?? 0) + next,
  apply: state => ({ ...state, bumps: state.bumps + 1 }),
};
const zero: FakeState = { carry: 0, ticks: 0, bumps: 0 };

/** Runs the real handler asynchronously with structured clones, the way a worker would. */
function fakeWorker(options: { failOnCall?: number } = {}) {
  const handle = createOfflineMessageHandler(engine, 10_000);
  let onMessage: (data: unknown) => void = () => {}, onError: (error: unknown) => void = () => {}, calls = 0;
  const port: OfflineWorkerPort & { terminated: boolean; posted: unknown[] } = {
    terminated: false, posted: [],
    postMessage(message) {
      port.posted.push(message);
      const call = ++calls;
      setTimeout(() => {
        if (port.terminated) return;
        if (call === options.failOnCall) onError(new Error('worker crashed'));
        else handle(structuredClone(message), response => onMessage(structuredClone(response)));
      }, 0);
    },
    listen(message, error) { onMessage = message; onError = error; },
    terminate() { port.terminated = true; },
  };
  return port;
}

describe('offline runner', () => {
  it('sends the state once and keeps the session in the worker', async () => {
    const worker = fakeWorker();
    const runner = createOfflineRunner({ engine, createWorker: () => worker });
    const progress: number[] = [];
    const first = await runner.run({ state: zero, elapsedMs: 35_000, returnState: false }, p => progress.push(p.simulatedMs));
    expect(first).toEqual({ state: null, report: 350 });
    expect(progress).toEqual([10_000, 20_000, 30_000]);
    const last = await runner.run({ actions: ['bump'], elapsedMs: 5_000, returnState: true });
    expect(last).toEqual({ state: { carry: 0, ticks: 400, bumps: 1 }, report: 50 });
    expect(worker.posted.map(m => (m as { state: unknown }).state === null)).toEqual([false, true]);
  });

  it('replays the session on the main thread when the worker fails mid-session', async () => {
    const runner = createOfflineRunner({ engine, createWorker: () => fakeWorker({ failOnCall: 3 }), mainSliceMs: 3_000 });
    await runner.run({ state: zero, elapsedMs: 10_000, returnState: false });
    await runner.run({ actions: ['bump'], elapsedMs: 10_000, returnState: false });
    const result = await runner.run({ actions: ['bump'], elapsedMs: 15_050, returnState: true });
    expect(runner.mode).toBe('main');
    expect(result).toEqual({ state: { carry: 50, ticks: 350, bumps: 2 }, report: 150 });
    expect(await runner.run({ elapsedMs: 50, returnState: true })).toEqual({ state: { carry: 0, ticks: 351, bumps: 2 }, report: 1 });
  });

  it('cancels an in-flight chunk, drops the session and accepts a new one', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const runner = createOfflineRunner({ engine, createWorker: () => { const w = fakeWorker(); workers.push(w); return w; } });
    const first = runner.run({ state: zero, elapsedMs: 1_000, returnState: false });
    runner.cancel();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0].terminated).toBe(true);
    await expect(runner.run({ elapsedMs: 1_000, returnState: true })).rejects.toThrow('No offline session');
    await expect(runner.run({ state: zero, elapsedMs: 1_000, returnState: true })).resolves.toEqual({ state: { ...zero, ticks: 10 }, report: 10 });
    expect(workers).toHaveLength(2);
  });

  it('runs sessions on the main thread without a worker and rejects overlap', async () => {
    const runner = createOfflineRunner({ engine });
    const first = runner.run({ state: zero, elapsedMs: 1_000, returnState: false });
    await expect(runner.run({ elapsedMs: 1_000, returnState: true })).rejects.toThrow('busy');
    await first;
    expect(await runner.run({ actions: ['bump'], elapsedMs: 1_000, returnState: true })).toEqual({ state: { ...zero, ticks: 20, bumps: 1 }, report: 10 });
    await expect(runner.run({ elapsedMs: 1.5, returnState: true })).rejects.toThrow(RangeError);
  });

  it('never advances the caller state or a returned checkpoint in place on the main thread (D9)', async () => {
    const runner = createOfflineRunner({ engine: gameOfflineEngine, mainSliceMs: 10_000 });
    const start = advanceGame(createInitialState(42), 5_000).state, saved = serializeSave(start);
    const first = await runner.run({ state: start, elapsedMs: 60_000, returnState: true });
    const checkpoint = serializeSave(first.state!);
    const second = await runner.run({ elapsedMs: 60_000, returnState: true });
    expect(serializeSave(start)).toBe(saved);
    expect(serializeSave(first.state!)).toBe(checkpoint);
    expect(second.state).toEqual(advanceGame(start, 120_000).state);
  });
});
