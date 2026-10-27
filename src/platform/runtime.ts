import { createInitialState, offlineCapMs, type AdvanceReport } from '../game';
import { accrue, chunkSpan, startCadence, take, type Cadence } from './cadence';
import { createGameOfflineRunner, type GameOfflineRunner } from './offline';
import { bitRougePersistence, type PersistenceAdapter } from './persistence';
import { mergeReports } from './reports';
import { DURABILITY_NOTICE, loadGame, saveGame } from './saveGame';
import type { RuntimeStore } from './store';

export interface RuntimeOptions {
  readonly persistence?: PersistenceAdapter;
  readonly now?: () => number;
  readonly monoNow?: () => number;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
  readonly document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  readonly window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly createRunner?: () => GameOfflineRunner;
  readonly saveIntervalMs?: number;
  /** Simulated span per worker request; queued actions apply between chunks. */
  readonly chunkMs?: number;
  /** Ignore the stored save and start a new game (QA `?fresh`). The next save overwrites it. */
  readonly fresh?: boolean;
  readonly seed?: number;
}

export interface GameRuntime {
  /** Resolves when the save is read and the first catch-up has finished. */
  readonly ready: Promise<void>;
  save(): void;
  /** Stops sim time (QA). Hidden time while paused is not time away. */
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /** DEV: catch up `awayMs` of absence through the real offline runner. Requires pause. */
  simulateOffline(awayMs: number): Promise<void>;
  dispose(): void;
}

/** Time owed after a catch-up below this runs inline; above it, another worker pass runs. */
const INLINE_MS = 2_000;
/** Wall time between state round trips during a catch-up. Each costs a structured clone each way. */
const CHECKPOINT_WALL_MS = 5_000;

/** Owns sim time. The canvas draws at display rate on its own. */
export function createRuntime(store: RuntimeStore, options: RuntimeOptions = {}): GameRuntime {
  const persistence = options.persistence ?? bitRougePersistence;
  const wallNow = options.now ?? Date.now, monoNow = options.monoNow ?? (() => performance.now());
  const doc = options.document ?? document, win = options.window ?? window;
  const requestFrame = options.requestFrame ?? ((cb: FrameRequestCallback) => window.requestAnimationFrame(cb));
  const cancelFrame = options.cancelFrame ?? ((id: number) => window.cancelAnimationFrame(id));
  const saveInterval = options.saveIntervalMs ?? 10_000, chunkMs = options.chunkMs ?? 60_000;
  const runner = (options.createRunner ?? createGameOfflineRunner)();

  let disposed = false, hydrated = false, paused = false, catching = false;
  let visible = doc.visibilityState !== 'hidden', frame: number | null = null;
  let cadence: Cadence = startCadence(monoNow());
  /** Wall time the store's state stands for. Saves record it; time away is measured from it. */
  let representedAt = wallNow(), lastSave = monoNow();
  let resolveReady = () => {};
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });

  const notice = (reason: string | null) => {
    store.setLifecycle({ saveDriver: persistence.driver });
    store.setNotice([reason, persistence.driver === 'memory' ? DURABILITY_NOTICE : null].filter(Boolean).join(' ') || null);
  };
  const write = () => {
    if (disposed || !hydrated) return;
    lastSave = monoNow();
    if (paused) representedAt = wallNow();
    try { if (!saveGame(store.getState(), representedAt, persistence)) notice(null); }
    catch { store.setNotice('Save failed. Progress remains in this tab.'); }
  };
  const advanceBy = (elapsedMs: number) => {
    if (elapsedMs <= 0) return;
    store.advance(elapsedMs); representedAt += elapsedMs;
  };
  /** Passes owed foreground time; `whole` also passes the sub-cadence part. */
  const pump = (whole: boolean) => {
    if (!hydrated || catching || paused || !visible || disposed) return;
    cadence = accrue(cadence, monoNow());
    const next = take(cadence, whole); cadence = next.cadence; advanceBy(next.elapsedMs);
  };
  const stopFrames = () => { if (frame !== null) cancelFrame(frame); frame = null; };
  const loop = () => {
    if (disposed || !hydrated || catching || paused || !visible || frame !== null) return;
    frame = requestFrame(() => {
      frame = null; pump(false);
      if (monoNow() - lastSave >= saveInterval) write();
      loop();
    });
  };

  /**
   * Advances `spanMs` through the worker in chunks, then skips `skipMs` (time away past the cap).
   * The state crosses to the worker once and stays there; it comes back at the end and at wall
   * checkpoints, which are the only points saved and shown. Actions queued meanwhile ride along
   * with the next chunk and apply at its start.
   */
  const catchUp = async (spanMs: number, awayMs: number, skipMs: number) => {
    catching = true; stopFrames();
    const epoch = store.getState().epoch;
    let report: AdvanceReport | null = null, unconfirmed: AdvanceReport | null = null;
    let done = 0, sinceCheckpoint = 0, lastCheckpoint = monoNow(), interrupted = false;
    store.batch(() => {
      store.flushQueued();
      store.setLifecycle({ catchingUp: true }); store.setCatchUp({ simulatedMs: 0, totalMs: spanMs, awayMs });
    });
    try {
      const chunks = chunkSpan(spanMs, chunkMs);
      for (let i = 0; i < chunks.length; i++) {
        const actions = i === 0 ? [] : store.takeQueued();
        const returnState = i === chunks.length - 1 || actions.some(a => a.type === 'reset')
          || monoNow() - lastCheckpoint >= CHECKPOINT_WALL_MS;
        const result = await runner.run({ state: i === 0 ? store.getState() : undefined, actions, elapsedMs: chunks[i], returnState },
          p => store.setCatchUp({ simulatedMs: done + p.simulatedMs, totalMs: spanMs, awayMs }));
        if (disposed) return;
        done += chunks[i]; sinceCheckpoint += chunks[i]; unconfirmed = mergeReports(unconfirmed, result.report);
        store.setCatchUp({ simulatedMs: done, totalMs: spanMs, awayMs });
        if (result.state) {
          store.replaceState(result.state); representedAt += sinceCheckpoint; sinceCheckpoint = 0;
          report = report && unconfirmed ? mergeReports(report, unconfirmed) : unconfirmed; unconfirmed = null;
          // A reset ends the absence: the new game starts now, not at departure.
          const reset = result.state.epoch !== epoch;
          if (reset) { representedAt = wallNow(); report = null; }
          write(); lastCheckpoint = monoNow();
          if (reset) { interrupted = true; break; }
        }
        if (!visible) { interrupted = true; break; }
      }
      if (!interrupted && sinceCheckpoint === 0) representedAt += skipMs;
    } catch (error) {
      if (disposed) return;
      if ((error as Error)?.name !== 'AbortError') {
        // A terminal runner error must not retry the same failing absence in
        // returnFromAway's visible-lag loop. Keep the last confirmed state.
        representedAt = wallNow();
        store.setNotice('Offline recovery stopped. Unprocessed time skipped.');
      }
      interrupted = true;
    }
    catching = false;
    store.batch(() => {
      if (report && report.ticks > 0) store.setOfflineReport(report);
      store.setCatchUp(null); store.setLifecycle({ catchingUp: false });
      store.flushQueued();
    });
    write();
  };
  /** Catches up from `representedAt` to now, then hands over to the frame loop. */
  const returnFromAway = async () => {
    const awayMs = Math.max(0, Math.floor(wallNow() - representedAt));
    const spanMs = Math.min(awayMs, Math.floor(offlineCapMs(store.getState())));
    if (awayMs > INLINE_MS) await catchUp(spanMs, awayMs, awayMs - spanMs);
    else advanceBy(awayMs);
    // Time spent catching up while visible is play time, not away time: no cap.
    for (let lag = Math.floor(wallNow() - representedAt); visible && !disposed && !paused && lag > INLINE_MS;
      lag = Math.floor(wallNow() - representedAt)) await catchUp(lag, lag, 0);
    if (disposed || !visible || paused) return;
    store.batch(() => advanceBy(Math.max(0, Math.floor(wallNow() - representedAt))));
    cadence = startCadence(monoNow()); loop();
  };

  const depart = () => {
    if (disposed || !visible) return;
    pump(true); visible = false; stopFrames();
    if (catching) runner.cancel();
    write();
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') { depart(); return; }
    if (visible || disposed) return;
    visible = true;
    if (!hydrated || catching) return;
    if (paused) { representedAt = wallNow(); return; }
    void returnFromAway();
  };
  store.setActionBoundary(() => pump(true));
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', depart);
  win.addEventListener('pageshow', onVisibility);

  void (async () => {
    const loaded = options.fresh ? null : await loadGame(persistence, options.seed);
    if (disposed) return;
    store.batch(() => {
      store.replaceState(loaded ? loaded.state : createInitialState(options.seed));
      notice(loaded?.resetReason ?? null);
    });
    representedAt = loaded?.savedAtMs ?? wallNow();
    hydrated = true;
    store.setLifecycle({ hydrated: true });
    store.flushQueued();
    if (visible) await returnFromAway();
    write();
  })().catch(() => {
    if (disposed) return;
    hydrated = true;
    store.batch(() => { store.setLifecycle({ hydrated: true, catchingUp: false }); store.setNotice('Save could not be read. Progress remains in this tab.'); });
    representedAt = wallNow(); cadence = startCadence(monoNow()); loop();
  }).finally(() => resolveReady());

  return {
    ready,
    save: () => { pump(true); write(); },
    pause() {
      if (paused || disposed) return;
      pump(true); paused = true; stopFrames(); write();
    },
    resume() {
      if (!paused || disposed) return;
      paused = false; representedAt = wallNow(); cadence = startCadence(monoNow()); write(); loop();
    },
    isPaused: () => paused,
    async simulateOffline(awayMs) {
      if (!Number.isSafeInteger(awayMs) || awayMs < 0) throw new RangeError('Invalid simulated absence');
      await ready;
      if (!paused || catching || disposed) throw new Error('simulateOffline needs a paused, idle runtime');
      const spanMs = Math.min(awayMs, Math.floor(offlineCapMs(store.getState())));
      await catchUp(spanMs, awayMs, 0);
      representedAt = wallNow();
      write();
    },
    dispose() {
      if (disposed) return;
      if (hydrated && !catching) { pump(true); write(); }
      disposed = true; stopFrames(); runner.dispose(); store.setActionBoundary(null);
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pagehide', depart); win.removeEventListener('pageshow', onVisibility);
      resolveReady();
    },
  };
}
