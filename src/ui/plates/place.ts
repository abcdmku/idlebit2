// Where a part's detail sits (user, 26 Oct: never over the tapped part). Pure, so tests can sweep it.
import type { Rect } from '../../render/core';

export interface PlaceOptions {
  /** Desktop: dock in the world's right gutter level with the part, else beside it. */
  readonly beside?: boolean;
  /** Pin to the top of the safe area (the save prompt). */
  readonly pinTop?: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, Math.max(lo, hi)));

export interface Placed extends Rect {
  /** The most height the plate may take where it sits (its max-height); `h` is what its content uses of it. */
  readonly room: number;
}

/**
 * The plate's rect for a part at `a` (or none), `w` wide with `content` px of content, inside `safe`.
 * Beside (desktop): the right gutter dock when the part stays clear of it, else right of the part, else
 * left of it. Otherwise (phone, or no side room): below the part if it fits, else above, else the roomier
 * side with the height cut to that room (the plate scrolls), so it never covers the part.
 */
export function placePlate(a: Rect | null, w: number, content: number, safe: Rect, o: PlaceOptions = {}): Placed {
  const room0 = Math.max(0, safe.h - 8), full = Math.min(content, room0);
  if (o.pinTop || !a) {
    const x = clamp(safe.x + (safe.w - w) / 2, safe.x, safe.x + safe.w - w);
    return { x, y: o.pinTop ? safe.y + 4 : safe.y + (safe.h - full) / 2, w, h: full, room: room0 };
  }
  if (o.beside) {
    const right = safe.x + safe.w, dock = right - w;
    const x = a.x + a.w + 8 <= dock ? dock : a.x + a.w + 16 + w <= right ? a.x + a.w + 16 : a.x - w - 16 >= safe.x ? a.x - w - 16 : null;
    if (x !== null) return { x, y: clamp(a.y, safe.y, safe.y + safe.h - full), w, h: full, room: room0 };
  }
  const x = clamp(a.x + a.w / 2 - w / 2, safe.x, safe.x + safe.w - w);
  const below = safe.y + safe.h - (a.y + a.h + 8), above = a.y - 8 - safe.y;
  if (full <= below) return { x, y: a.y + a.h + 8, w, h: full, room: room0 };
  if (full <= above) return { x, y: a.y - 8 - full, w, h: full, room: room0 };
  const h = Math.max(0, Math.floor(Math.max(below, above)));
  return below >= above ? { x, y: a.y + a.h + 8, w, h, room: h } : { x, y: a.y - 8 - h, w, h, room: h };
}

export const intersects = (p: Rect, q: Rect) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
