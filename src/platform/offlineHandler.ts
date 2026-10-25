/**
 * Offline catch-up handler. The same function runs in the browser worker and in the bench's
 * worker_threads worker. It holds the state across requests (a session), so a long catch-up
 * crosses the thread boundary once each way instead of once per chunk: at the largest fleet a
 * structured clone of the state costs about 250 ms. Delta invariance makes slicing free.
 */
export const OFFLINE_CHANNEL = 'bitrouge-v3-offline';
/** Simulated time between progress posts inside one request. */
export const PROGRESS_SLICE_MS = 10_000;

export interface OfflineRequest<S, A> {
  readonly channel: typeof OFFLINE_CHANNEL;
  readonly kind: 'advance';
  readonly id: number;
  /** Starts a session from this state; null continues the held state. */
  readonly state: S | null;
  /** Applied in order before advancing: the chunk boundary. */
  readonly actions: readonly A[];
  readonly elapsedMs: number;
  /** Send the held state back (a checkpoint or the end). */
  readonly returnState: boolean;
}
export type OfflineResponse<S, R> =
  | { readonly channel: typeof OFFLINE_CHANNEL; readonly kind: 'progress'; readonly id: number; readonly simulatedMs: number; readonly totalMs: number }
  | { readonly channel: typeof OFFLINE_CHANNEL; readonly kind: 'result'; readonly id: number; readonly state: S | null; readonly report: R }
  | { readonly channel: typeof OFFLINE_CHANNEL; readonly kind: 'error'; readonly id: number; readonly message: string };

/**
 * The sim functions the handler needs. `advance` takes ownership of its state and may update it in
 * place (decisions D9); `own` returns a copy a session may own while the original stays live.
 * `merge` folds slice reports; `apply` returns the state unchanged on rejection.
 */
export interface OfflineEngine<S, R, A> {
  advance(state: S, elapsedMs: number): { readonly state: S; readonly report: R };
  own(state: S): S;
  merge(total: R | null, next: R): R;
  apply(state: S, action: A): S;
}

export function isOfflineRequest(value: unknown): value is OfflineRequest<unknown, unknown> {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.channel === OFFLINE_CHANNEL && m.kind === 'advance' && Number.isSafeInteger(m.id)
    && Number.isSafeInteger(m.elapsedMs) && (m.elapsedMs as number) >= 0 && 'state' in m
    && Array.isArray(m.actions) && typeof m.returnState === 'boolean';
}

/** Applies `actions`, then advances `elapsedMs` in slices. Takes ownership of `start`. `onSlice` sees the running total. */
export function advanceSession<S, R, A>(engine: OfflineEngine<S, R, A>, start: S, actions: readonly A[], elapsedMs: number,
  sliceMs: number, onSlice?: (doneMs: number) => void): { state: S; report: R } {
  let state = start, report: R | null = null, done = 0;
  for (const action of actions) state = engine.apply(state, action);
  do {
    const step = Math.min(sliceMs, elapsedMs - done);
    const result = engine.advance(state, step);
    state = result.state; report = engine.merge(report, result.report); done += step;
    if (done < elapsedMs) onSlice?.(done);
  } while (done < elapsedMs);
  return { state, report: report as R };
}

/** Message entry for any worker scope. Malformed messages are ignored. */
export function createOfflineMessageHandler<S, R, A>(engine: OfflineEngine<S, R, A>, sliceMs = PROGRESS_SLICE_MS) {
  let held: S | null = null;
  return (data: unknown, post: (response: OfflineResponse<S, R>) => void): void => {
    if (!isOfflineRequest(data)) return;
    const request = data as OfflineRequest<S, A>, { id, elapsedMs } = request;
    try {
      // The sender may keep its state (tests, a main-thread port); the session advances its own copy.
      const start = request.state !== null ? engine.own(request.state) : held;
      if (start === null) throw new Error('No offline session; send a state first');
      held = null;
      const result = advanceSession(engine, start, request.actions, elapsedMs, sliceMs, done =>
        post({ channel: OFFLINE_CHANNEL, kind: 'progress', id, simulatedMs: done, totalMs: elapsedMs }));
      held = result.state;
      post({ channel: OFFLINE_CHANNEL, kind: 'result', id, state: request.returnState ? held : null, report: result.report });
    } catch (error) {
      post({ channel: OFFLINE_CHANNEL, kind: 'error', id, message: error instanceof Error ? error.message : String(error) });
    }
  };
}
