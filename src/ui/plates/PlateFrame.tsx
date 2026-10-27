import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { Rect } from '../../render/core/geom';
import { placePlate } from './place';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Pips } from './widgets';
import '../styles/plates.css';

/** Where a plate sits. Every field is optional: with none, the plate centres in its parent. */
export interface PlatePosition {
  /** Reads the CSS rect of the world target the plate belongs to (renderer.anchor). */
  readAnchor?: ((out: Rect) => boolean) | null;
  /** Safe world rectangle in the shell's CSS coordinates (clear of HUD, fixtures and tray). */
  bounds?: Rect | null;
  /** Re-runs placement on camera frames without a React commit. */
  subscribeFrame?: ((update: () => void) => () => void) | null;
  /** Pin to the top of the safe area (the save prompt, clear of an on-screen keyboard). */
  pinTop?: boolean;
  /** Desktop: dock in the world's right gutter level with the part (as the callout did), else beside it, so the part stays in view. */
  beside?: boolean;
  /** A small pointer up to the anchor when the plate sits under it (the task detail under its card). */
  tip?: boolean;
  /**
   * Larger areas, in order, a plate may take to fit its content (phone: over the strip and deck, then over the HUD).
   * A plate that fits keeps `bounds`.
   */
  spill?: readonly Rect[] | null;
}

export interface PlateFrameProps extends PlatePosition {
  title: string;
  sub?: ReactNode;
  /** [filled, max] level pips in the header. */
  pips?: readonly [number, number];
  /** Extra header content after the subtitle (a total price). */
  head?: ReactNode;
  /** Primary actions that remain visible while a long body scrolls. */
  footer?: ReactNode;
  className?: string;
  /** The 48 px close key in the header (A21: one close everywhere); on by default. Plates also close on Escape or a world tap. */
  closeKey?: boolean;
  as?: 'section' | 'form';
  onSubmit?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/** The least scrolling body height that shows a row of choices and a line of what the picked one does. */
const CRAMPED_BODY = 120;

/** The plate body: a fixed-width dark slab with a paper rim. It never resizes while open. */
export function PlateFrame({ title, sub, pips, head, footer, className = '', closeKey = true, as = 'section', onSubmit, initialFocus,
  onClose, children, readAnchor, bounds, subscribeFrame, pinTop, beside, tip, spill }: PlateFrameProps) {
  const ref = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose, initialFocus);
  useLayoutEffect(() => {
    const root = ref.current, content = contentRef.current;
    if (!root || !content) return;
    const target: Rect = { x: 0, y: 0, w: 0, h: 0 };
    let natural = root.offsetWidth;
    // One layout (R16): the plate is a grid of explicit height, head, body, a real "More ↓" row and the footer. The
    // body is the only thing that scrolls and its own row clips it, so nothing paints under the cue or the footer.
    // Cramped (the head and the main option alone fill the room), the whole plate scrolls, main option first.
    const more = () => {
      const box = root.dataset.cramped === 'true' ? root : content;
      root.dataset.scrolls = String(content.scrollHeight - content.clientHeight > 2);
      // (A whole-plate scroll counts only real content below, not its few px of padding.)
      root.dataset.more = String(box.scrollHeight - box.scrollTop - box.clientHeight > (box === root ? 8 : 2));
    };
    content.addEventListener('scroll', more, { passive: true });
    root.addEventListener('scroll', more, { passive: true });
    // Held (user, 26 Oct: buttons never shift a popup): once its part stands still the frame keeps its place and size
    // for its life; a choice, a purchase, a quote, Details or a wallet change updates inside it (the body scrolls).
    // Only a new target (a new plate) or a window resize places it again.
    let held = false, stable = 0, lastAnchor = '';
    /**
     * The plate's own height with nothing limiting it: what it would take with room to spare. Its head, body and footer
     * are read in the same pass, so content the plate only reserves (R17: an empty site holds the room of the part its
     * Add installs, rendered only while measuring) counts the same way everywhere below.
     */
    let measured = { head: 40, footer: 0, content: 0 };
    const naturalHeight = () => {
      root.dataset.measure = 'true';
      const h = root.offsetHeight;
      measured = { head: root.querySelector<HTMLElement>('.p-head')?.offsetHeight ?? 40,
        footer: root.querySelector<HTMLElement>(':scope > .plate-footer')?.offsetHeight ?? 0, content: content.scrollHeight };
      delete root.dataset.measure;
      return h;
    };
    const position = () => {
      if (held) { more(); return; }
      const parent = root.offsetParent as HTMLElement | null;
      const pw = parent?.clientWidth || innerWidth, ph = parent?.clientHeight || innerHeight;
      const areas = [bounds ?? { x: 8, y: 142, w: pw - 16, h: ph - 142 - 160 }, ...(spill ?? [])];
      const a = !pinTop && readAnchor?.(target) ? target : null;
      // A plate beside its part may be narrower than its own width (place.ts); its natural width is read unset.
      if (!root.style.width) natural = root.offsetWidth;
      let best: { safe: Rect; full: number; at: ReturnType<typeof placePlate>; head: number; footer: number; content: number; width: string } | null = null;
      for (const area of areas) {
        root.style.setProperty('--plate-safe-width', `${Math.max(0, area.w)}px`);
        root.style.width = '';
        // Never over the tapped part (place.ts): the natural height is measured first, then the place and its room.
        let full = naturalHeight();
        let at = placePlate(a, natural, full, area, { beside, pinTop });
        if (at.w < natural) { root.style.width = `${at.w}px`; full = naturalHeight(); at = placePlate(a, natural, full, area, { beside, pinTop }); }
        const candidate = { safe: area, full, at, ...measured, width: root.style.width };
        if (!best || Math.min(full, at.room) > Math.min(best.full, best.at.room)) best = candidate;
        if (at.room >= full) { best = candidate; break; }
      }
      const { safe, full, at, head: headH, footer: footerH, content: contentH, width } = best!;
      root.style.setProperty('--plate-safe-width', `${Math.max(0, safe.w)}px`);
      root.style.width = width;
      const height = Math.max(0, Math.min(full, at.room));
      root.style.height = `${height}px`;
      root.style.setProperty('--plate-safe-height', `${Math.max(0, at.room)}px`);
      const pad = full - headH - footerH - contentH;
      // Cramped: the head, the main option and the plate's padding leave too little body for what it holds.
      const body = height - headH - footerH - Math.max(0, pad) - 24;
      root.dataset.cramped = String(footerH > 0 && body < Math.min(CRAMPED_BODY, contentH));
      root.style.left = `${Math.round(at.x)}px`;
      // Above its part, the plate's foot sits 8 px over the part.
      root.style.top = `${Math.round(a && at.y + at.h <= a.y ? Math.max(safe.y, a.y - 8 - height) : at.y)}px`;
      root.dataset.anchored = String(Boolean(a));
      const under = !!tip && !!a && at.y >= a.y + a.h;
      root.dataset.tip = under ? 'up' : 'none';
      if (under) root.style.setProperty('--tip-x', `${Math.round(Math.max(16, Math.min(at.w - 16, a!.x + a!.w / 2 - at.x)))}px`);
      more();
      // The part has stood still for two frames (or there is none to follow): this is the frame.
      const key = a ? `${Math.round(a.x)},${Math.round(a.y)},${Math.round(a.w)},${Math.round(a.h)}` : 'none';
      stable = key === lastAnchor ? stable + 1 : 0; lastAnchor = key;
      // A stationary anchor has no frame subscription to settle it. Hold its first layout, too,
      // so content resize measurements cannot reset a drilled tree's scroll position.
      if (stable >= 2 || !subscribeFrame) { held = true; root.dataset.held = 'true'; }
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(root);
    const resize = () => {
      held = false; stable = 0; lastAnchor = '';
      root.style.width = ''; root.style.height = ''; delete root.dataset.held;
      position();
    };
    window.addEventListener('resize', resize);
    const stop = subscribeFrame?.(position);
    observer?.observe(content);
    return () => { stop?.(); observer?.disconnect(); window.removeEventListener('resize', resize); content.removeEventListener('scroll', more); root.removeEventListener('scroll', more); };
  }, [bounds, readAnchor, subscribeFrame, pinTop, beside, tip, spill]);

  const body = <>
    <header className="p-head">
      <span className="p-title">{title}</span>
      {sub != null && <span className="p-sub">{sub}</span>}
      {head}
      {pips && <Pips filled={pips[0]} max={pips[1]} />}
      {closeKey && <button type="button" className="p-x" aria-label="Close" onClick={onClose}>
        <i className="x-glyph" aria-hidden="true" style={{ width: 12, height: 12, '--x-w': '1px' } as CSSProperties} /></button>}
    </header>
    <div ref={contentRef} className="plate-content">{children}</div>
    <div className="plate-more" aria-hidden="true">More ↓</div>
    {footer && <footer className="plate-footer">{footer}</footer>}
  </>;
  const common = {
    className: `v3-plate ${closeKey ? 'has-x ' : ''}${className}`, 'aria-label': title, tabIndex: -1,
    onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
    onWheel: (e: { stopPropagation(): void }) => e.stopPropagation(),
  };
  if (as === 'form') {
    return <form ref={ref as RefObject<HTMLFormElement>} {...common} role="dialog" aria-modal="true"
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>{body}</form>;
  }
  return <section ref={ref} {...common} role="dialog" aria-modal="true">{body}</section>;
}
