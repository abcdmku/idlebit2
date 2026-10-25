// The shell context and the hooks every v3 component (U1 and U2) reads.
// React re-renders only on selected values; per-frame work goes through `surface.frameListeners`.
import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import { quote } from '../game';
import type { ActionOutcome, GameAction, QuoteRequest, QuoteResult, RenderSnapshot } from '../game';
import type { GameStore } from '../platform';
import type { CanvasRenderer, LevelRegistry, Rect } from '../render/core';
import type { ShellLayout } from './layout';
import type { ViewState, ViewStore } from './viewState';

/** Per frame, after the world draw: presentation sim ms (frozen while paused) and wall seconds. */
export type FrameListener = (timeMs: number, nowS: number) => void;

export interface ShellSurface {
  renderer: CanvasRenderer | null;
  /** Stage geometry, CSS px; replaced on resize. */
  layout: ShellLayout;
  /** Safe rect for plates (the free world inset by one lattice step), in stage px. */
  plateBounds: Rect;
  frameListeners: Set<FrameListener>;
  /** The visible level's build quotes the deck holds; the world prices ghosts with them. */
  buildQuotes: QuoteResult | null;
  /** Real canvas draws so far (QA). */
  drawCount: number;
}
export interface ShellContextValue {
  readonly store: GameStore;
  readonly view: ViewStore;
  readonly registry: LevelRegistry;
  readonly surface: ShellSurface;
  /** The sim re-quotes every action; presentation never grants a purchase. */
  dispatch(action: GameAction): ActionOutcome | null;
  /** Lazy quotes for the deck, the callout or the open plate. Never call per frame. */
  quote(request: QuoteRequest): QuoteResult;
}

export const ShellContext = createContext<ShellContextValue | null>(null);
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('idlebit2 shell provider is missing');
  return value;
}

export function createShellValue(store: GameStore, view: ViewStore, registry: LevelRegistry, surface: ShellSurface): ShellContextValue {
  return {
    store, view, registry, surface,
    dispatch: action => store.dispatch(action),
    quote: request => quote(store.getState(), request),
  };
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every(key => Object.is(a[key], b[key]));
}

/**
 * Select a value from the RenderSnapshot. `cadenceMs` throttles re-renders (the sim publishes at
 * 10 Hz); a new epoch or a round phase change always flushes at once.
 */
export function useGameSelector<T>(selector: (snapshot: RenderSnapshot) => T,
  equality: (a: T, b: T) => boolean = Object.is, cadenceMs = 0): T {
  const { store } = useShell();
  const refs = useRef<{ selector: typeof selector; equality: typeof equality; value: T; source: RenderSnapshot } | null>(null);
  if (!refs.current) { const source = store.getSnapshot(); refs.current = { selector, equality, value: selector(source), source }; }
  refs.current.selector = selector; refs.current.equality = equality;
  const read = useCallback(() => {
    const r = refs.current!, next = r.selector(r.source);
    if (!r.equality(r.value, next)) r.value = next;
    return r.value;
  }, []);
  const subscribe = useCallback((notify: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined, last = -Infinity;
    refs.current!.source = store.getSnapshot();
    const flush = () => { timer = undefined; last = performance.now(); refs.current!.source = store.getSnapshot(); notify(); };
    const stop = store.subscribe(() => {
      const prev = refs.current!.source, next = store.getSnapshot();
      const immediate = next.epoch !== prev.epoch || next.round.state !== prev.round.state || next.focus.level !== prev.focus.level;
      if (immediate || performance.now() - last >= cadenceMs) { if (timer) clearTimeout(timer); flush(); }
      else timer ??= setTimeout(flush, Math.max(0, cadenceMs - (performance.now() - last)));
    });
    return () => { stop(); if (timer) clearTimeout(timer); };
  }, [store, cadenceMs]);
  return useSyncExternalStore(subscribe, read, read);
}

export function useViewState(): ViewState {
  const { view } = useShell();
  return useSyncExternalStore(view.subscribe, view.getState, view.getState);
}

/** Quotes refresh for funds, round downtime and research unlocks, at most 2 Hz. */
export function useQuote(request: QuoteRequest | null): QuoteResult | null {
  const shell = useShell();
  const wallet = useGameSelector(s => `${s.hud.credits}|${s.hud.data}|${s.epoch}|${s.round.state}|${s.research.active}|${s.research.queued}|${s.bootMs}`, Object.is, 500);
  const key = request ? JSON.stringify(request) : '';
  return useMemo(() => (request ? shell.quote(request) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the request's value identity
    [shell, key, wallet]);
}

export interface PlatformStatus { readonly notice: string | null; readonly catchingUp: boolean; readonly progress: number | null }
export function usePlatformStatus(): PlatformStatus {
  const { store } = useShell();
  const cache = useRef<PlatformStatus>({ notice: null, catchingUp: false, progress: null });
  const read = useCallback(() => {
    const catchUp = store.getCatchUp(), life = store.getLifecycle();
    const next: PlatformStatus = { notice: store.getNotice(), catchingUp: life.catchingUp,
      progress: catchUp && catchUp.totalMs > 0 ? Math.floor(catchUp.simulatedMs / catchUp.totalMs * 100) : null };
    if (!shallowEqual(cache.current, next)) cache.current = next;
    return cache.current;
  }, [store]);
  return useSyncExternalStore(store.subscribe, read, read);
}
