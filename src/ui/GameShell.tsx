// The v3 shell: layout L2, Control deck (D15–D17). A stage on the 8 px grid holds the world canvas,
// the band (HUD and ladder) and the queue strip over the world's top edge, the deck below, the
// upgrade callout, the research drawer, plates and the round plate. Geometry comes from layout.ts
// and depends only on the viewport, so controls never move.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LevelId } from '../game';
import type { GameStore } from '../platform';
import type { LevelRegistry } from '../render/core';
import { Callout } from './callout/Callout';
import { CanvasWorld } from './CanvasWorld';
import { Deck } from './deck/Deck';
import { OffersScope } from './deck/useOffers';
import { Hud } from './Hud';
import { useHotkeys } from './hooks/useHotkeys';
import { closeTopmost, LeaveDialog, useBackGuard } from './shell/backGuard';
import { IS_SANDBOX } from './shell/sandbox';
import { TaskDetail } from './queue/TaskDetail';
import { useMediaQuery } from './hooks/useMediaQuery';
import { NO_INSETS, shellLayout, type SafeInsets, type ShellLayout } from './layout';
import { PlateLayer } from './plates';
import { QueueStrip } from './QueueStrip';
import { ResearchScreen } from './research';
import { RoundPlate } from './RoundPlate';
import { box, LayoutContext } from './shell/geometry';
import { ShellContext, createShellValue, type ShellContextValue, type ShellSurface } from './storeHooks';
import { PlatformLine } from './shell/PlatformLine';
import { createViewStore, initialView, type ViewStore } from './viewState';
import { openingLevel, writeLastLevel } from './prefs';
import { SupplyToast } from './shell/supplyToast';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/plates.css';

export interface GameShellProps {
  store: GameStore;
  registry: LevelRegistry;
  /** First level to show (QA `?level=`), if opened. */
  level?: LevelId;
  view?: ViewStore;
  /** Saves the game now (the runtime's save): the new-version Reload saves before it reloads. */
  saveNow?: () => void;
  /** Viewport size for tests; the live shell measures itself. */
  size?: { width: number; height: number };
  children?: ReactNode;
}

function readInsets(el: HTMLElement): SafeInsets {
  const style = getComputedStyle(el), v = (name: string) => parseFloat(style.getPropertyValue(`--safe-${name}`)) || 0;
  return { top: v('top'), right: v('right'), bottom: v('bottom'), left: v('left') };
}

/** The layout for the shell element's size, recomputed on resize. */
function useShellLayout(size?: { width: number; height: number }) {
  const ref = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<ShellLayout>(() => shellLayout(size?.width ?? (typeof window === 'undefined' ? 390 : window.innerWidth),
    size?.height ?? (typeof window === 'undefined' ? 780 : window.innerHeight)));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || size) return;
    let key = '';
    const measure = () => {
      const r = el.getBoundingClientRect(), insets = el.isConnected ? readInsets(el) : NO_INSETS;
      const next = `${r.width}x${r.height}:${insets.top},${insets.right},${insets.bottom},${insets.left}`;
      if (next === key || !r.width || !r.height) return;
      key = next; setLayout(shellLayout(r.width, r.height, insets));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el); window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [size]);
  return { ref, layout };
}

export function GameShell({ store, registry, level, view, size, saveNow, children }: GameShellProps) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const { ref, layout } = useShellLayout(size);
  const shell = useMemo<ShellContextValue>(() => {
    const views = view ?? createViewStore(store.getSnapshot, initialView(store.getSnapshot(), level));
    const first = shellLayout(390, 780);
    const surface: ShellSurface = { renderer: null, layout: first, plateBounds: { ...first.calloutBounds }, frameListeners: new Set(), buildQuotes: null, drawCount: 0 };
    return createShellValue(store, views, registry, surface);
  }, [store, registry, view, level]);
  // Plates and the renderer read the current geometry from the surface.
  shell.surface.layout = layout;
  Object.assign(shell.surface.plateBounds, layout.calloutBounds);

  // The snapshot covers what the view shows: focus, and the zoom partner while it lasts.
  useEffect(() => {
    store.setScope(shell.view.getScope());
    return shell.view.subscribe(() => store.setScope(shell.view.getScope()));
  }, [shell, store]);
  useEffect(() => { shell.view.setReducedMotion(reducedMotion); }, [shell, reducedMotion]);
  // DEV: QA scripts (scripts/qa) select world targets and read the stage through the live shell.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __brShell?: ShellContextValue };
    w.__brShell = shell;
    return () => { if (w.__brShell === shell) delete w.__brShell; };
  }, [shell]);
  // A29: once the save is read, open at the last level the player looked at (UI prefs), else the
  // highest unlocked one; from then on remember each level they settle on.
  useEffect(() => {
    let opened = false, stopView: (() => void) | null = null;
    const open = () => {
      const life = store.getLifecycle();
      if (opened || !life.hydrated || life.catchingUp) return;
      opened = true;
      const s = store.getSnapshot(), v = shell.view.getState();
      const want = level ?? openingLevel(s);
      if (!level && want !== v.focus.level && v.focus.level === 'chip' && !v.goal) shell.view.reset(initialView(s, want, v.reducedMotion));
      stopView = shell.view.subscribe(() => { const f = shell.view.getState(); if (!f.goal && !f.partner) writeLastLevel(f.focus.level); });
    };
    open();
    const stop = store.subscribe(open);
    return () => { stop(); stopView?.(); };
  }, [shell, store, level]);
  // A reset (new epoch) starts over at the home CPU.
  useEffect(() => {
    let epoch = store.getSnapshot().epoch;
    return store.subscribe(() => {
      const next = store.getSnapshot().epoch;
      if (next === epoch) return;
      epoch = next;
      shell.view.reset(initialView(store.getSnapshot(), 'chip', shell.view.getState().reducedMotion));
    });
  }, [shell, store]);

  const guard = useBackGuard(shell, saveNow);
  useHotkeys({
    // One menu per press, innermost first, as the phone's back does; with nothing open, nothing happens.
    escape: () => { closeTopmost(shell); },
    '+': () => shell.view.dispatch({ type: 'zoomStep', direction: 'in' }),
    '=': () => shell.view.dispatch({ type: 'zoomStep', direction: 'in' }),
    '-': () => shell.view.dispatch({ type: 'zoomStep', direction: 'out' }),
    r: () => shell.view.dispatch({ type: 'toggleSheet', sheet: 'research' }),
  });

  const vars = { '--body': `${layout.body}px`, '--lh': `${layout.lh}px`, '--big': `${layout.big}px`, '--mid': `${layout.mid}px`,
    '--head': `${layout.body + 2}px`, '--n': `${layout.N}px` } as CSSProperties;
  return <ShellContext.Provider value={shell}>
    <LayoutContext.Provider value={layout}>
      <main ref={ref} className={`br-shell scr l-${layout.kind}${IS_SANDBOX ? ' sandbox' : ''}`} aria-label="idlebit2" data-reduced-motion={reducedMotion}>
        <div className="stage" style={{ ...box({ x: layout.x, y: layout.y, w: layout.w, h: layout.h }), ...vars }} data-testid="stage"
          data-n={layout.N} data-lat={layout.lat} data-kind={layout.kind}>
          <CanvasWorld />
          <Hud />
          <QueueStrip />
          <PlatformLine saveNow={saveNow} />
          <SupplyToast />
          <OffersScope>
            <Deck />
            <Callout />
            <PlateLayer />
            <ResearchScreen />
            <RoundPlate />
            <TaskDetail />
          </OffersScope>
          <LeaveDialog guard={guard} />
          {children}
        </div>
      </main>
    </LayoutContext.Provider>
  </ShellContext.Provider>;
}
