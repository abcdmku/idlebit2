import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { Rect } from '../../render/core/geom';
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
}

export interface PlateFrameProps extends PlatePosition {
  title: string;
  sub?: ReactNode;
  /** [filled, max] level pips in the header. */
  pips?: readonly [number, number];
  /** Extra header content after the subtitle (a total price). */
  head?: ReactNode;
  className?: string;
  /** The 48 px close key in the header (A21: one close everywhere); on by default. Plates also close on Escape or a world tap. */
  closeKey?: boolean;
  as?: 'section' | 'form';
  onSubmit?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

/** The plate body: a fixed-width dark slab with a paper rim. It never resizes while open. */
export function PlateFrame({ title, sub, pips, head, className = '', closeKey = true, as = 'section', onSubmit, initialFocus,
  onClose, children, readAnchor, bounds, subscribeFrame, pinTop }: PlateFrameProps) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose, initialFocus);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const target: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const position = () => {
      const parent = root.offsetParent as HTMLElement | null;
      const pw = parent?.clientWidth || innerWidth, ph = parent?.clientHeight || innerHeight;
      const safe = bounds ?? { x: 8, y: 142, w: pw - 16, h: ph - 142 - 160 };
      root.style.setProperty('--plate-safe-height', `${Math.max(0, safe.h - 8)}px`);
      root.style.setProperty('--plate-safe-width', `${Math.max(0, safe.w)}px`);
      const a = !pinTop && readAnchor?.(target) ? target : null;
      const width = root.offsetWidth, height = root.offsetHeight;
      const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, Math.max(lo, hi)));
      const x = a ? a.x + a.w / 2 - width / 2 : safe.x + (safe.w - width) / 2;
      const y = pinTop ? safe.y + 4
        : a ? (a.y + a.h + 8 + height <= safe.y + safe.h ? a.y + a.h + 8 : a.y - height - 8)
        : safe.y + (safe.h - height) / 2;
      root.style.left = `${Math.round(clamp(x, safe.x, safe.x + safe.w - width))}px`;
      root.style.top = `${Math.round(clamp(y, safe.y, safe.y + safe.h - height))}px`;
      root.dataset.anchored = String(Boolean(a));
    };
    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(root);
    window.addEventListener('resize', position);
    const stop = subscribeFrame?.(position);
    return () => { stop?.(); observer?.disconnect(); window.removeEventListener('resize', position); };
  }, [bounds, readAnchor, subscribeFrame, pinTop]);

  const body = <>
    <header className="p-head">
      <span className="p-title">{title}</span>
      {sub != null && <span className="p-sub">{sub}</span>}
      {head}
      {pips && <Pips filled={pips[0]} max={pips[1]} />}
      {closeKey && <button type="button" className="p-x" aria-label="Close" onClick={onClose}>
        <i className="x-glyph" aria-hidden="true" style={{ width: 12, height: 12, '--x-w': '1px' } as CSSProperties} /></button>}
    </header>
    {children}
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
