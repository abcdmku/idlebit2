import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { Rect } from '../../render/core/geom';
import { placePlate } from './place';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Pips } from './widgets';
import { useComponentActions } from './ComponentActions';
import '../styles/plates.css';
import '../styles/component-popups.css';

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
  /** The live usage figure ("0 b used"), inline on the title line. It wraps inside the title block when it cannot fit. */
  usage?: ReactNode;
  usageTone?: string;
  /** [filled, max] level pips in the header. */
  pips?: readonly [number, number];
  /** Extra header content after the subtitle (a total price). */
  head?: ReactNode;
  actions?: ReactNode;
  /** Primary actions that remain visible while a long body scrolls. */
  footer?: ReactNode;
  /** The next-generation key. It sits in the bottom action row, right of Downgrade and Remove. */
  generation?: ReactNode;
  className?: string;
  /** The 48 px close key in the header (A21: one close everywhere); on by default. Plates also close on Escape or a world tap. */
  closeKey?: boolean;
  as?: 'section' | 'form';
  onSubmit?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/** The narrowest a plate is laid out: its width on a 320px phone. Squeezed further, keys start to truncate. */
const NARROWEST = 288;

/** Runtime values retain geometry. Explicit menus can resize without rearranging the controls. */
export function PlateFrame({ title, sub, usage, usageTone = '', pips, head, actions, footer, generation, className = '', closeKey = true, as = 'section', onSubmit, initialFocus,
  onClose, children, readAnchor, bounds, subscribeFrame, pinTop, beside, tip, spill }: PlateFrameProps) {
  const ref = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const maintenance = useComponentActions();
  useDialogFocus(ref, onClose, initialFocus);
  useLayoutEffect(() => {
    const root = ref.current, content = contentRef.current;
    if (!root || !content) return;
    const target: Rect = { x: 0, y: 0, w: 0, h: 0 };
    let natural = root.offsetWidth;
    // One layout (R16): the plate is a grid of explicit height, head, body, a real "More ↓" row and the footer. The
    // body is the only thing that scrolls and its own row clips it, so nothing paints under the cue or the footer.
    const more = () => {
      const cramped = root.dataset.cramped === 'true';
      const box = cramped ? root : content;
      // A visible cue takes space from the body. Include that space when deciding whether the cue is still needed,
      // otherwise it can keep itself and the scrollbar visible after the content shrinks.
      const cue = root.querySelector<HTMLElement>(':scope > .plate-more');
      const reclaimed = root.dataset.scrolls === 'true' ? cue?.offsetHeight ?? 0 : 0;
      root.dataset.scrolls = String(!cramped && content.scrollHeight > content.clientHeight + reclaimed + 1);
      // (A whole-plate scroll counts only real content below, not its few px of padding.)
      root.dataset.more = String(box.scrollHeight - box.scrollTop - box.clientHeight > (box === root ? 8 : 2));
      // A local list marks the edges it can still scroll past (its cut edge). Written only on change: the body's
      // mutation observer calls this again.
      for (const list of content.querySelectorAll<HTMLElement>('.scroll-list')) {
        const above = String(list.scrollTop > 1), below = String(list.scrollHeight - list.scrollTop - list.clientHeight > 1);
        if (list.dataset.above !== above) list.dataset.above = above;
        if (list.dataset.below !== below) list.dataset.below = below;
      }
    };
    // Scroll events do not bubble: the capture listener also hears the lists inside the body.
    content.addEventListener('scroll', more, { passive: true, capture: true });
    root.addEventListener('scroll', more, { passive: true });
    // Hold placement for runtime changes. Menu toggles change height within the current area.
    let held = false, stable = 0, lastAnchor = '';
    let placedArea: Rect | null = null;
    const naturalHeight = () => {
      root.dataset.measure = 'true';
      // Inline glyphs can extend a few pixels beyond their grid row. Include that real overflow
      // before placing the panel; otherwise a 2px difference creates an unnecessary scroll cue.
      const h = root.offsetHeight + Math.max(0, content.scrollHeight - content.clientHeight);
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
      let best: { safe: Rect; full: number; at: ReturnType<typeof placePlate>; width: string; covers: boolean } | null = null;
      // Keep the part visible when possible. If that would force scrolling, try the same areas centered over it.
      const placements = a && !pinTop ? [false, true] : [false];
      search: for (const covers of placements) for (const area of areas) {
        root.style.setProperty('--plate-safe-width', `${Math.max(0, area.w)}px`);
        root.style.width = '';
        // The plate's own width in this area (an area narrower than the plate caps it).
        natural = root.offsetWidth;
        let full = naturalHeight();
        let at = placePlate(covers ? null : a, natural, full, area, { beside, pinTop });
        // Wide control grids need their measured width. Try centering before squeezing their columns.
        if (!covers && natural >= 560 && at.w < natural * 0.9) continue;
        // Beside its part a plate is never squeezed under the narrowest width its layout is built for (a 320px phone).
        if (!covers && at.w < Math.min(natural, NARROWEST)) continue;
        if (at.w < natural) { root.style.width = `${at.w}px`; full = naturalHeight(); at = placePlate(covers ? null : a, natural, full, area, { beside, pinTop }); }
        const candidate = { safe: area, full, at, width: root.style.width, covers };
        if (!best || Math.min(full, at.room) > Math.min(best.full, best.at.room)) best = candidate;
        if (at.room >= full) { best = candidate; break search; }
      }
      const { safe, full, at, width, covers } = best!;
      placedArea = safe;
      root.style.setProperty('--plate-safe-width', `${Math.max(0, safe.w)}px`);
      root.style.width = width;
      const height = Math.max(0, Math.min(full, at.room));
      root.style.height = `${height}px`;
      root.style.setProperty('--plate-safe-height', `${Math.max(0, at.room)}px`);
      root.dataset.cramped = 'false';
      root.style.left = `${Math.round(at.x)}px`;
      // Above its part, the plate's foot sits 8 px over the part.
      const top = !covers && a && at.y + at.h <= a.y ? a.y - 8 - height : at.y;
      root.style.top = `${Math.round(Math.max(safe.y, Math.min(safe.y + safe.h - height, top)))}px`;
      root.dataset.anchored = String(Boolean(a));
      const under = !covers && !!tip && !!a && at.y >= a.y + a.h;
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
    // The body keeps its size while open, so changes inside it need their own overflow check.
    const changes = new MutationObserver(more);
    changes.observe(content, { childList: true, subtree: true, characterData: true, attributes: true });
    const resize = () => {
      held = false; stable = 0; lastAnchor = '';
      root.style.width = ''; root.style.height = ''; delete root.dataset.held;
      position();
    };
    window.addEventListener('resize', resize);
    let toggleFrame = 0;
    const toggle = (event: Event) => {
      const section = event.target;
      if (!(section instanceof HTMLElement)) return;
      cancelAnimationFrame(toggleFrame);
      toggleFrame = requestAnimationFrame(() => {
        if (!placedArea) return;
        const full = naturalHeight(), height = Math.min(full, Math.max(0, placedArea.h - 8));
        // A click that changed no height (a setting, a choice) leaves the frame exactly where it is.
        if (Math.abs(height - root.offsetHeight) < 1) { more(); return; }
        if (full > placedArea.h - 8) { resize(); return; }
        const previousTop = parseFloat(root.style.top) || placedArea.y;
        // Grow down from the same top; move up only by the amount needed to stay in the current area.
        const top = Math.max(placedArea.y, Math.min(previousTop, placedArea.y + placedArea.h - height));
        root.style.height = `${height}px`;
        root.style.top = `${Math.round(top)}px`;
        root.dataset.tip = 'none';
        held = true; root.dataset.held = 'true';
        more();
      });
    };
    content.addEventListener('plate-layout', toggle, true);
    root.addEventListener('click', toggle);
    const stop = subscribeFrame?.(position);
    observer?.observe(content);
    return () => { cancelAnimationFrame(toggleFrame); stop?.(); observer?.disconnect(); changes.disconnect(); window.removeEventListener('resize', resize); content.removeEventListener('plate-layout', toggle, true); root.removeEventListener('click', toggle); content.removeEventListener('scroll', more, { capture: true }); root.removeEventListener('scroll', more); };
  }, [bounds, readAnchor, subscribeFrame, pinTop, beside, tip, spill]);

  const body = <>
    <header className="p-head">
      <span className="p-head-text">
        <span className="p-title">{title}</span>
        {sub != null && sub !== '' && <span className="p-sub">{sub}</span>}
        {usage != null && usage !== '' && <span className={`p-usage ${usageTone}`}>{usage}</span>}
      </span>
      {head}
      {pips && <Pips filled={pips[0]} max={pips[1]} />}
      <span className="p-head-actions">{actions}{closeKey && <button type="button" className="p-x" aria-label="Close" onClick={onClose}>
        <i className="x-glyph" aria-hidden="true" style={{ width: 12, height: 12, '--x-w': '1px' } as CSSProperties} /></button>}</span>
    </header>
    <div ref={contentRef} className="plate-content">{children}</div>
    <div className="plate-more" aria-hidden="true">More ↓</div>
    {(footer || maintenance || generation) && <footer className="plate-footer">
      {footer}
      {/* One row of fixed height: Downgrade and Remove at the left, the next generation at the right. */}
      {(maintenance || generation) && <div className="plate-actions">{maintenance}{generation}</div>}
    </footer>}
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
