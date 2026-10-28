import {
  advanceGame, advanceGameOwned, applyAction, createInitialState, deriveRenderSnapshot, systemId,
  type ActionOutcome, type AdvanceReport, type GameAction, type GameState, type RenderSnapshot, type SnapshotScope,
} from '../game';
import type { PersistenceDriver } from './persistence';

export interface Lifecycle {
  /** False until the save is read and any catch-up has finished. */
  readonly hydrated: boolean;
  readonly catchingUp: boolean;
  readonly saveDriver: PersistenceDriver;
}

/** Catch-up of time away. `simulatedMs` of `totalMs` are done; `awayMs` is the full gap before the cap. */
export interface CatchUpProgress {
  readonly simulatedMs: number;
  readonly totalMs: number;
  readonly awayMs: number;
}

/** What UI and render read. Everything else on RuntimeStore belongs to the runtime. */
export interface GameStore {
  getState(): GameState;
  /** Rebuilt after an advance that ticked, after an action and after a scope change. */
  getSnapshot(): RenderSnapshot;
  getScope(): SnapshotScope;
  /** The UI view store reports what is on screen; the snapshot covers only that. */
  setScope(scope: SnapshotScope): void;
  getLifecycle(): Lifecycle;
  getCatchUp(): CatchUpProgress | null;
  /** Totals of the last catch-up, until dismissed. */
  getOfflineReport(): AdvanceReport | null;
  dismissOfflineReport(): void;
  getNotice(): string | null;
  /** Applies at once, or queues while hydrating or catching up (returns null) and applies at the next chunk boundary. */
  dispatch(action: GameAction): ActionOutcome | null;
  subscribe(listener: () => void): () => void;
}

export interface RuntimeStore extends GameStore {
  advance(elapsedMs: number): AdvanceReport;
  replaceState(state: GameState, ticked?: boolean): void;
  /** Applies queued actions in order. Returns how many ran. */
  flushQueued(): number;
  queuedCount(): number;
  /** Removes and returns queued actions, for a catch-up that applies them in the worker. */
  takeQueued(): GameAction[];
  setLifecycle(update: Partial<Lifecycle>): void;
  setCatchUp(progress: CatchUpProgress | null): void;
  setOfflineReport(report: AdvanceReport | null): void;
  setNotice(notice: string | null): void;
  /** Settles a live dispatch before applying it; may start catch-up or return false after a fatal error. Queued replay skips it. */
  setActionBoundary(callback: (() => boolean | void) | null): void;
  /** Notifies once, after the outermost batch. */
  batch<T>(operation: () => T): T;
  dispose(): void;
}

export interface StoreOptions {
  readonly initialState?: GameState;
  readonly scope?: SnapshotScope;
}

export const DEFAULT_SCOPE: SnapshotScope = { focus: { level: 'chip', id: systemId(0) }, partner: null };

const sameNode = (a: SnapshotScope['focus'] | null, b: SnapshotScope['focus'] | null) =>
  a === b || (a !== null && b !== null && a.level === b.level && a.id === b.id
    && (a.level !== 'chip' || b.level !== 'chip' || (a.socket ?? 0) === (b.socket ?? 0)));
const sameScope = (a: SnapshotScope, b: SnapshotScope) => sameNode(a.focus, b.focus) && sameNode(a.partner, b.partner);

export function createGameStore(options: StoreOptions = {}): RuntimeStore {
  let state = options.initialState ?? createInitialState();
  let scope = options.scope ?? DEFAULT_SCOPE;
  let snapshot: RenderSnapshot | null = null, stale = true;
  let lifecycle: Lifecycle = { hydrated: false, catchingUp: false, saveDriver: 'memory' };
  let catchUp: CatchUpProgress | null = null, offlineReport: AdvanceReport | null = null, notice: string | null = null;
  let depth = 0, dirty = false, disposed = false, boundary: (() => boolean | void) | null = null;
  /**
   * True once `state` came from the store's own ticking advance, so no one else can hold its hot
   * buffers and the next advance may update them in place (decisions D9). A state handed in, or
   * made by an action (which may share buffers with the state before it), is advanced purely once.
   */
  let owned = false;
  const queued: GameAction[] = [], listeners = new Set<() => void>();

  const publish = () => {
    if (disposed || depth > 0 || !dirty) return;
    dirty = false;
    for (const listener of [...listeners]) listener();
  };
  const changed = (rebuild: boolean) => { if (rebuild) stale = true; dirty = true; publish(); };
  const apply = (action: GameAction): ActionOutcome => {
    const outcome = applyAction(state, action);
    if (outcome.ok) {
      state = outcome.state; owned = false;
      if (action.type === 'reset') offlineReport = null;
      changed(true);
    }
    return outcome;
  };

  const store: RuntimeStore = {
    getState: () => state,
    getSnapshot() {
      if (stale || !snapshot) { snapshot = deriveRenderSnapshot(state, scope, snapshot ?? undefined); stale = false; }
      return snapshot;
    },
    getScope: () => scope,
    setScope(next) { if (!disposed && !sameScope(scope, next)) { scope = next; changed(true); } },
    getLifecycle: () => lifecycle,
    getCatchUp: () => catchUp,
    getOfflineReport: () => offlineReport,
    dismissOfflineReport() { store.setOfflineReport(null); },
    getNotice: () => notice,
    dispatch(action) {
      if (disposed) return null;
      return store.batch(() => {
        if (lifecycle.hydrated && !lifecycle.catchingUp && boundary?.() === false) return null;
        // The boundary may start catch-up. Queue the action against its confirmed result.
        if (!lifecycle.hydrated || lifecycle.catchingUp) { queued.push(action); return null; }
        return apply(action);
      });
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    advance(elapsedMs) {
      if (disposed) return advanceGame(state, 0).report;
      const result = owned ? advanceGameOwned(state, elapsedMs) : advanceGame(state, elapsedMs);
      state = result.state;
      if (result.report.ticks > 0) owned = true;
      // A zero-tick advance only moves the carry; the renderer extrapolates from the last publish.
      if (result.report.ticks > 0) changed(true);
      return result.report;
    },
    replaceState(next, ticked = true) {
      if (disposed || next === state) return;
      state = next; owned = false; changed(ticked);
    },
    flushQueued() {
      if (!queued.length) return 0;
      return store.batch(() => {
        const actions = queued.splice(0);
        for (const action of actions) apply(action);
        return actions.length;
      });
    },
    queuedCount: () => queued.length,
    takeQueued: () => queued.splice(0),
    setLifecycle(update) {
      const next = { ...lifecycle, ...update };
      if (next.hydrated === lifecycle.hydrated && next.catchingUp === lifecycle.catchingUp && next.saveDriver === lifecycle.saveDriver) return;
      lifecycle = next; changed(false);
    },
    setCatchUp(progress) {
      if (progress === catchUp || (progress && catchUp && progress.simulatedMs === catchUp.simulatedMs
        && progress.totalMs === catchUp.totalMs && progress.awayMs === catchUp.awayMs)) return;
      catchUp = progress; changed(false);
    },
    setOfflineReport(report) { if (report !== offlineReport) { offlineReport = report; changed(false); } },
    setNotice(next) { if (next !== notice) { notice = next; changed(false); } },
    setActionBoundary(callback) { boundary = callback; },
    batch(operation) {
      depth++;
      try { return operation(); } finally { depth--; publish(); }
    },
    dispose() { disposed = true; queued.length = 0; listeners.clear(); boundary = null; },
  };
  return store;
}
