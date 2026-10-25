/** Catch-up progress in simulated milliseconds of the requested span. */
export interface OfflineAdvanceProgress { readonly simulatedMs: number; readonly totalMs: number }
export type OfflineAdvanceProgressListener = (progress: OfflineAdvanceProgress) => void;

export interface CooperativeAdvanceOptions {
  maxWallMs?: number;
  now?: () => number;
  yieldTask?: () => Promise<void>;
  signal?: AbortSignal;
  readProgress?: () => OfflineAdvanceProgress;
  onProgress?: OfflineAdvanceProgressListener;
}
/** step stops only after whole ticks. Wall deadlines
 * decide when to yield the task, never how much simulation time to advance. */
export async function advanceCooperatively<T>(step: (shouldYield: () => boolean) => boolean,
  materialize: () => T, options: CooperativeAdvanceOptions = {}): Promise<T> {
  const budget = options.maxWallMs ?? 8, now = options.now ?? (() => performance.now());
  const yieldTask = options.yieldTask ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  if (!Number.isFinite(budget) || budget <= 0) throw new RangeError('Invalid cooperative wall budget');
  for (;;) {
    if (options.signal?.aborted) { const error = new Error('Offline advance cancelled'); error.name = 'AbortError'; throw error; }
    const deadline = now() + budget;
    const done = step(() => options.signal?.aborted === true || now() >= deadline);
    if (options.readProgress && options.onProgress) options.onProgress(options.readProgress());
    if (options.signal?.aborted) continue;
    if (done) return materialize();
    await yieldTask();
  }
}
