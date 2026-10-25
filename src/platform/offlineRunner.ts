import { advanceCooperatively, type OfflineAdvanceProgressListener } from './cooperativeAdvance';
import { advanceSession, OFFLINE_CHANNEL, type OfflineEngine, type OfflineResponse } from './offlineHandler';

/** Minimal worker surface, so tests and Node can provide their own. */
export interface OfflineWorkerPort {
  postMessage(message: unknown): void;
  listen(onMessage: (data: unknown) => void, onError: (error: unknown) => void): void;
  terminate(): void;
}

export interface OfflineChunk<S, A> {
  /** Starts a session from this state. Omit to continue the held session. */
  readonly state?: S;
  /** Applied before this chunk advances. */
  readonly actions?: readonly A[];
  readonly elapsedMs: number;
  /** Returns the session state (a checkpoint or the end). Otherwise only the report crosses back. */
  readonly returnState: boolean;
}

export interface OfflineRunner<S, R, A> {
  readonly mode: 'worker' | 'main';
  /** One chunk at a time. `state` is null unless `returnState` was asked. */
  run(chunk: OfflineChunk<S, A>, onProgress?: OfflineAdvanceProgressListener): Promise<{ state: S | null; report: R }>;
  /** Rejects the in-flight chunk with AbortError and drops the session. */
  cancel(): void;
  dispose(): void;
}

export interface OfflineRunnerOptions<S, R, A> {
  readonly engine: OfflineEngine<S, R, A>;
  readonly createWorker?: () => OfflineWorkerPort;
  /** Main-thread slice between yields. */
  readonly mainSliceMs?: number;
}

export function wrapBrowserWorker(worker: Worker): OfflineWorkerPort {
  return {
    postMessage: message => worker.postMessage(message),
    listen(onMessage, onError) {
      worker.addEventListener('message', event => onMessage(event.data));
      worker.addEventListener('error', event => { event.preventDefault(); onError(event.error ?? new Error(event.message)); });
      worker.addEventListener('messageerror', () => onError(new Error('Offline worker message could not be read')));
    },
    terminate: () => worker.terminate(),
  };
}

const abortError = () => Object.assign(new Error('Offline advance cancelled'), { name: 'AbortError' });
type Settle<S, R> = { resolve: (v: { state: S | null; report: R }) => void; reject: (e: unknown) => void };

export function createOfflineRunner<S, R, A>(options: OfflineRunnerOptions<S, R, A>): OfflineRunner<S, R, A> {
  const { engine } = options, mainSliceMs = options.mainSliceMs ?? 1000;
  let mode: 'worker' | 'main' = options.createWorker ? 'worker' : 'main';
  let worker: OfflineWorkerPort | null = null, nextId = 0, disposed = false, busy = false;
  /** Main-thread view of the session: the last state that crossed, plus chunks sent since. */
  let base: S | null = null, log: OfflineChunk<S, A>[] = [];
  let pending: (Settle<S, R> & { id: number; onProgress?: OfflineAdvanceProgressListener; chunk: OfflineChunk<S, A> }) | null = null;
  let mainAbort: AbortController | null = null;

  const done = () => { busy = false; };
  const onMessage = (data: unknown) => {
    const message = data as OfflineResponse<S, R>;
    if (!pending || message?.channel !== OFFLINE_CHANNEL || message.id !== pending.id) return;
    if (message.kind === 'progress') { pending.onProgress?.({ simulatedMs: message.simulatedMs, totalMs: message.totalMs }); return; }
    const settle = pending; pending = null; done();
    if (message.kind === 'error') { settle.reject(new Error(message.message)); return; }
    if (message.state !== null) { base = message.state; log = []; }
    settle.resolve({ state: message.state, report: message.report });
  };
  const onWorkerError = () => {
    // A broken worker cannot be trusted again. Rebuild the session from the last state that
    // crossed plus the chunks sent since, then run the failed chunk on the main thread.
    worker?.terminate(); worker = null; mode = 'main';
    const failed = pending; pending = null;
    if (!failed) return;
    try {
      if (base === null) throw new Error('Offline session lost');
      // `base` and logged chunk states were also handed to the caller: replay from copies.
      let state: S = engine.own(base);
      for (const chunk of log.slice(0, -1)) {
        const from = chunk.state !== undefined ? engine.own(chunk.state) : state;
        state = advanceSession(engine, from, chunk.actions ?? [], chunk.elapsedMs, chunk.elapsedMs).state;
      }
      base = state; log = [];
      runMain({ ...failed.chunk, state }, failed.onProgress).finally(done).then(failed.resolve, failed.reject);
    } catch (error) { done(); failed.reject(error); }
  };

  const runMain = (chunk: OfflineChunk<S, A>, onProgress?: OfflineAdvanceProgressListener) => {
    const controller = new AbortController(); mainAbort = controller;
    if (chunk.state === undefined && base === null) return Promise.reject(new Error('No offline session; send a state first'));
    // The session owns its state: a caller's state is copied in, and a returned state is copied out.
    let state = (chunk.state !== undefined ? engine.own(chunk.state) : base) as S, report: R | null = null, doneMs = 0;
    for (const action of chunk.actions ?? []) state = engine.apply(state, action);
    base = null; log = [];
    return advanceCooperatively(shouldYield => {
      do {
        const step = Math.min(mainSliceMs, chunk.elapsedMs - doneMs);
        const result = engine.advance(state, step);
        state = result.state; report = engine.merge(report, result.report); doneMs += step;
        if (doneMs >= chunk.elapsedMs) return true;
      } while (!shouldYield());
      return false;
    }, () => { base = state; return { state: chunk.returnState ? engine.own(state) : null, report: report as R }; },
    { signal: controller.signal, readProgress: () => ({ simulatedMs: doneMs, totalMs: chunk.elapsedMs }), onProgress })
      .finally(() => { if (mainAbort === controller) mainAbort = null; });
  };

  const runner: OfflineRunner<S, R, A> = {
    get mode() { return mode; },
    run(chunk, onProgress) {
      if (disposed) return Promise.reject(new Error('Offline runner is disposed'));
      if (busy) return Promise.reject(new Error('Offline runner is busy'));
      if (!Number.isSafeInteger(chunk.elapsedMs) || chunk.elapsedMs < 0) return Promise.reject(new RangeError('Invalid offline span'));
      busy = true;
      if (mode === 'main') return runMain(chunk, onProgress).finally(done);
      if (chunk.state !== undefined) { base = chunk.state; log = []; }
      else if (base === null && log.length === 0) { done(); return Promise.reject(new Error('No offline session; send a state first')); }
      log.push(chunk);
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending = { id, resolve, reject, onProgress, chunk };
        try {
          if (!worker) { worker = options.createWorker!(); worker.listen(onMessage, onWorkerError); }
          worker.postMessage({ channel: OFFLINE_CHANNEL, kind: 'advance', id, state: chunk.state ?? null,
            actions: chunk.actions ?? [], elapsedMs: chunk.elapsedMs, returnState: chunk.returnState });
        } catch { onWorkerError(); }
      });
    },
    cancel() {
      mainAbort?.abort();
      base = null; log = [];
      if (pending) { const settle = pending; pending = null; worker?.terminate(); worker = null; done(); settle.reject(abortError()); }
    },
    dispose() { if (disposed) return; runner.cancel(); disposed = true; worker?.terminate(); worker = null; },
  };
  return runner;
}
