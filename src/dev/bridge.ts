import {
  quote, type ActionOutcome, type AdvanceReport, type GameAction, type GameState, type QuoteRequest, type QuoteResult,
  type RenderSnapshot, type SnapshotScope,
} from '../game';
import type { CatchUpProgress, GameRuntime, Lifecycle, RuntimeStore } from '../platform';
import { installBootBridge, type BootBridge, type BridgeBootstrap } from './boot';

/**
 * DEV-only `window.__br` for QA scripts (scripts/qa). Everything goes through the real
 * store and runtime: no grants, no fixture loaders, no clock injection.
 *
 *   await __br.ready();                 // save read, catch-up done, shell mounted
 *   __br.pause();                       // stop realtime
 *   await __br.advance(60_000);         // real advanceGame through the store
 *   await __br.dispatch({ type: 'returnToMarket' });
 *   await __br.simulateOffline(2 * 3_600_000); // real offline runner, needs pause
 *   __br.resume();
 */
export interface LiveBridge {
  getState(): GameState;
  getSnapshot(): RenderSnapshot;
  getScope(): SnapshotScope;
  setScope(scope: SnapshotScope): void;
  getLifecycle(): Lifecycle;
  getCatchUp(): CatchUpProgress | null;
  getOfflineReport(): AdvanceReport | null;
  getNotice(): string | null;
  /** Resolves with the outcome, or null if it was queued behind hydration or catch-up. */
  dispatch(action: GameAction): Promise<ActionOutcome | null>;
  quote(request: QuoteRequest): QuoteResult;
  /** Advances sim time by a whole number of ms. Pause first for repeatable runs. */
  advance(elapsedMs: number): Promise<AdvanceReport>;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  simulateOffline(awayMs: number): Promise<void>;
  save(): void;
}
export type V3Bridge = BootBridge & Partial<LiveBridge>;

export function createLiveBridge(store: RuntimeStore, runtime: GameRuntime): LiveBridge {
  const hydrated = async () => {
    await runtime.ready;
    const life = store.getLifecycle();
    if (!life.hydrated || life.catchingUp) throw new Error('Runtime is catching up; await __br.ready()');
  };
  return {
    getState: store.getState,
    getSnapshot: store.getSnapshot,
    getScope: store.getScope,
    setScope: store.setScope,
    getLifecycle: store.getLifecycle,
    getCatchUp: store.getCatchUp,
    getOfflineReport: store.getOfflineReport,
    getNotice: store.getNotice,
    async dispatch(action) { await hydrated(); return store.dispatch(action); },
    quote: request => quote(store.getState(), request),
    async advance(elapsedMs) {
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0) throw new RangeError('advance needs whole non-negative ms');
      await hydrated();
      return store.advance(elapsedMs);
    },
    pause: runtime.pause,
    resume: runtime.resume,
    isPaused: runtime.isPaused,
    simulateOffline: runtime.simulateOffline,
    save: runtime.save,
  };
}

/** Call first thing in main.tsx (DEV), before importing the shell, so boot errors are visible. */
export function installEarlyBridge(): BridgeBootstrap<LiveBridge> {
  return installBootBridge<LiveBridge>();
}

/**
 * Attaches the live store and runtime once the shell has mounted. `isReady` defaults to the
 * runtime's ready; the shell can pass one that also waits for the first real draw.
 * Returns a detach for unmount and HMR. A no-op outside DEV.
 */
export function attachLiveBridge(store: RuntimeStore, runtime: GameRuntime,
  isReady: () => Promise<void> = () => runtime.ready): () => void {
  if (!import.meta.env.DEV) return () => {};
  return installBootBridge<LiveBridge>().attach(createLiveBridge(store, runtime), isReady);
}
