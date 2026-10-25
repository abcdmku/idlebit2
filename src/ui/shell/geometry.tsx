// The stage geometry in React: one layout per viewport size, shared by every shell piece.
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { Rect } from '../../render/core';
import type { ShellLayout } from '../layout';

export const LayoutContext = createContext<ShellLayout | null>(null);
export function useLayout(): ShellLayout {
  const layout = useContext(LayoutContext);
  if (!layout) throw new Error('idlebit2 layout provider is missing');
  return layout;
}

/** A rect as absolute CSS, relative to its positioned parent (offset by `origin`). */
export function box(r: Rect, origin?: { x: number; y: number }): CSSProperties {
  return { left: r.x - (origin?.x ?? 0), top: r.y - (origin?.y ?? 0), width: r.w, height: r.h };
}

/**
 * A text run at (x, y) inside its box, on the 8 px grid. `right` anchors the right edge instead;
 * `tall` sets the line height to `h` (one line centred in the row).
 */
export function T({ x, y, right, h, w, className, children, label }: {
  x?: number; y: number; right?: number; h?: number; className?: string; children: ReactNode; label?: string;
  /** A width cap: a value longer than this ends in an ellipsis (class `clip`; the audit reports it). */
  w?: number;
}) {
  const style: CSSProperties = { top: y };
  if (right !== undefined) style.right = right; else style.left = x ?? 0;
  if (h) style.lineHeight = `${h}px`;
  if (w !== undefined) style.maxWidth = Math.max(0, w);
  const cls = `t${w !== undefined ? ' clip' : ''}${className ? ` ${className}` : ''}`;
  return <span className={cls} style={style} aria-label={label}>{children}</span>;
}
