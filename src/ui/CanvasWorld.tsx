import { useEffect, useRef } from 'react';
import { createCanvasRenderer, MAX_EXTRAPOLATION_MS } from '../render/core';
import type { CanvasRenderer, RenderSnapshot, RestFraming, ViewPresentation } from '../render/core';
import type { ShellLayout } from './layout';
import { rackRowScroll } from '../render/levels/rack';
import { activateTarget, zoomGesture } from './input/commands';
import { bindGestures, type PanHandler } from './input/gestures';
import { useLayout } from './shell/geometry';
import { useShell } from './storeHooks';
import type { ViewState } from './viewState';

/** L2 rest framing (D17): art at N, the free world below the band and strip, the pipe from the head slot. */
export function framingOf(L: ShellLayout): RestFraming {
  return { form: L.kind, scale: L.N, lattice: L.lat, top: L.view.y - L.world.y, pipe: { x: L.pipeSrc.x, y: L.pipeSrc.y, runY: L.pipeRunY } };
}

/**
 * The world canvas covers the stage; the renderer frames each level in the world under the band and
 * queue strip (rest framing). Display clock only: the runtime owns sim time. One rAF drives the
 * world and every frame listener.
 */
export function CanvasWorld() {
  const ref = useRef<HTMLCanvasElement>(null), shell = useShell(), layout = useLayout();
  const rendererRef = useRef<CanvasRenderer | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { store, view, registry, surface } = shell;
    const renderer = createCanvasRenderer(canvas, registry);
    surface.renderer = renderer; rendererRef.current = renderer;
    let disposed = false, frameId = 0, dpr = 0;
    const resize = () => {
      const L = surface.layout;
      dpr = window.devicePixelRatio || 1;
      renderer.resize(L.w, L.h, dpr, L.world, framingOf(L));
      rackRowScroll.setStep(L.lat / L.N);
    };
    resize();

    let published: RenderSnapshot | null = null, publishedAt = 0, pausedAt: number | null = null;
    let presentedFor: ViewState | null = null, presentedQuotes = surface.buildQuotes, presentation: ViewPresentation | null = null;
    const present = (v: ViewState): ViewPresentation => {
      if (v !== presentedFor || surface.buildQuotes !== presentedQuotes || !presentation) {
        presentedFor = v; presentedQuotes = surface.buildQuotes;
        presentation = { selectedId: v.selectedId, picked: null, quotes: surface.buildQuotes, reducedMotion: v.reducedMotion, zoomGoal: v.goal };
      }
      return presentation;
    };
    const frame = (now: number) => {
      if (disposed) return;
      frameId = requestAnimationFrame(frame);
      if (dpr !== (window.devicePixelRatio || 1)) resize();
      const snapshot = store.getSnapshot(), nowS = now / 1000;
      if (snapshot !== published) { published = snapshot; publishedAt = now; }
      const since = now - publishedAt, live = snapshot.simTimeMs + Math.max(0, Math.min(MAX_EXTRAPOLATION_MS, since));
      if (snapshot.round.state === 'running') pausedAt = null; else pausedAt ??= live;
      const drawable = registry.has(snapshot.focus.level) && (!snapshot.partner || registry.has(snapshot.partner.level));
      if (drawable) { renderer.draw(snapshot, present(view.getState()), { nowS, sincePublishMs: since }); surface.drawCount++; }
      view.settle(drawable && renderer.transition !== null);
      const timeMs = pausedAt ?? live;
      for (const listener of surface.frameListeners) listener(timeMs, nowS);
    };
    frameId = requestAnimationFrame(frame);
    // D17.2: the Rack level scrolls along its row: drag on phone and desktop, wheel on desktop.
    let s0 = 0, quiet: ReturnType<typeof setTimeout> | undefined;
    const pan: PanHandler = {
      active: () => store.getSnapshot().focus.level === 'rack' && !view.getState().partner,
      drag(dx, phase) {
        if (phase === 'start') { s0 = rackRowScroll.offset; rackRowScroll.setDragging(true); view.dispatch({ type: 'cancel' }); }
        else if (phase === 'move') rackRowScroll.scrollTo(s0 - dx / surface.layout.N);
        else rackRowScroll.setDragging(false);
      },
      wheel(d) {
        rackRowScroll.setDragging(true); rackRowScroll.scrollBy(d / surface.layout.N);
        clearTimeout(quiet); quiet = setTimeout(() => rackRowScroll.setDragging(false), 150);
      },
    };
    const stopInput = bindGestures(canvas, {
      renderer: () => renderer,
      pan,
      tap: hit => {
        // A darkened rack in the row becomes active where it stands; the camera does not move.
        if (hit?.drill && hit.drill.level === 'rack' && hit.owner.level === 'rack' && hit.drill.id !== view.getState().focus.id) {
          rackRowScroll.holdView(); view.dispatch({ type: 'drill', ref: hit.drill }); return;
        }
        activateTarget(shell, hit);
      },
      zoom: (direction, hit) => zoomGesture(shell, direction, hit),
    });
    return () => {
      disposed = true; cancelAnimationFrame(frameId); stopInput(); clearTimeout(quiet);
      renderer.dispose(); surface.renderer = null; rendererRef.current = null;
    };
  }, [shell]);
  // A new layout (resize, safe areas) re-frames the world.
  useEffect(() => { rendererRef.current?.resize(layout.w, layout.h, window.devicePixelRatio || 1, layout.world, framingOf(layout)); }, [layout]);
  return <canvas ref={ref} className="world" tabIndex={0} style={{ width: layout.w, height: layout.h }}
    aria-label="Compute world. Tap a part for its upgrade, pinch or scroll to zoom." />;
}
