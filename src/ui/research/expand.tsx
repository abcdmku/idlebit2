// The research tile's motion: its details open and shut in place (height 0fr → 1fr, content fading in;
// research.css owns the timing), and the list follows an opening tile until all of it is in view.
// Under reduced motion both are instant.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** How long a shutting tile keeps its content: the CSS height transition (200 ms) and a little slack. */
const SHUT_MS = 260;

type Phase = 'shut' | 'opening' | 'open' | 'shutting';

/** A tile's details. Rendered only while open or shutting, so a closed tile holds no hidden keys. */
export function Expander({ open, id, children }: { open: boolean; id: string; children: () => ReactNode }) {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'shut');
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open && (phase === 'shut' || phase === 'shutting')) setPhase('opening');
    else if (!open && (phase === 'open' || phase === 'opening')) setPhase('shutting');
  }, [open, phase]);
  useLayoutEffect(() => {
    if (phase === 'opening') {
      // Lay out the shut height first, so the switch to open is a transition.
      void ref.current?.offsetHeight;
      setPhase('open');
    } else if (phase === 'shutting') {
      const t = setTimeout(() => setPhase('shut'), SHUT_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);
  if (phase === 'shut') return null;
  return <div ref={ref} id={id} className={`tx${phase === 'open' ? ' open' : ''}`} inert={phase === 'shutting' || undefined}>
    <div className="tx-in">{children()}</div>
  </div>;
}

/**
 * The scroll top that shows all of a tile (its top first when it is taller than the view), moving as
 * little as possible. Tile and view are in the list's scroll coordinates.
 */
export function scrollGoal(view: { top: number; height: number }, tile: { top: number; height: number }, pad = 8): number {
  const top = tile.top - pad, bottom = tile.top + tile.height + pad;
  if (bottom - top > view.height || top < view.top) return top;
  if (bottom > view.top + view.height) return bottom - view.height;
  return view.top;
}

export const reducedMotion = (el: Element): boolean =>
  !!el.closest('[data-reduced-motion="true"]') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** How long the list follows an opening tile at most, and at least (the height transition). */
const FOLLOW_MAX_MS = 700, FOLLOW_MIN_MS = 260;

/**
 * Scrolls `box` so `tile` ends fully in view. Each frame re-measures the tile while it (and any tile
 * shutting above it) animates, and eases toward the goal, so the list lands right after the layout
 * settles. A wheel, touch or press on the list hands control back to the player. Returns a stop.
 */
export function followTile(box: HTMLElement, tile: HTMLElement): () => void {
  const instant = reducedMotion(box);
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const start = now();
  let frame = 0, stopped = false;
  const stop = () => {
    stopped = true;
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    for (const e of ['wheel', 'touchstart', 'pointerdown'] as const) box.removeEventListener(e, stop);
  };
  const step = () => {
    if (stopped) return;
    const b = box.getBoundingClientRect(), t = tile.getBoundingClientRect();
    const max = Math.max(0, box.scrollHeight - box.clientHeight);
    const goal = Math.min(max, Math.max(0, scrollGoal({ top: box.scrollTop, height: box.clientHeight },
      { top: t.top - b.top + box.scrollTop, height: t.height })));
    const d = goal - box.scrollTop;
    box.scrollTop = instant || Math.abs(d) < 2 ? goal : box.scrollTop + Math.sign(d) * Math.max(1, Math.abs(d) * 0.3);
    const elapsed = now() - start;
    if (raf && elapsed < FOLLOW_MAX_MS && (elapsed < FOLLOW_MIN_MS || Math.abs(goal - box.scrollTop) >= 1)) frame = raf(step);
    else stop();
  };
  for (const e of ['wheel', 'touchstart', 'pointerdown'] as const) box.addEventListener(e, stop, { passive: true });
  step();
  return stop;
}
