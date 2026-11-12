// The offscreen world buffers: one canvas per level, sized to the level's world in art px. A level
// draws its whole world into its buffer; the renderer blits the part the camera sees.
import type { Camera, PixelRatio, WorldForm } from './camera';
import type { Rect } from './geom';
import { rect } from './geom';
import { P } from './palette';
import { brackets } from './px';
import { context2d } from './sprites';
import type { HitTarget, LevelId, LevelRenderer, LevelSnapshot } from './types';

/** The hover/press bracket's strength against the selection's. */
export const HOVER_ALPHA = 0.45;
export interface WorldBuffer { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; size: Rect }

export class WorldBuffers {
  private readonly buffers = new Map<LevelId, WorldBuffer>();
  constructor(private readonly doc: Document) {}
  get count(): number { return this.buffers.size; }
  clear(): void { this.buffers.clear(); }
  /** The buffer of `s`'s level, resized to the world `lv` reports. */
  of(s: LevelSnapshot, lv: LevelRenderer, form: WorldForm): WorldBuffer {
    let entry = this.buffers.get(s.level);
    if (!entry) {
      const c = this.doc.createElement('canvas');
      entry = { canvas: c, g: context2d(c), size: rect() }; this.buffers.set(s.level, entry);
    }
    lv.size(s as never, entry.size, form);
    if (entry.canvas.width !== entry.size.w || entry.canvas.height !== entry.size.h) {
      entry.canvas.width = entry.size.w; entry.canvas.height = entry.size.h; entry.g.imageSmoothingEnabled = false;
    }
    return entry;
  }
}

/** The selection's brackets on target `sel`, and what the pointer is over (`hov`) at reduced strength (every level alike). */
export function drawBrackets(bg: CanvasRenderingContext2D, targets: readonly HitTarget[], count: number, sel: string | null | undefined, hov: string | null): void {
  for (let i = 0; i < count; i++) {
    const id = targets[i]!.id, r = targets[i]!.rect;
    if (id === sel) brackets(bg, r.x - 1, r.y - 1, r.w + 2, r.h + 2, P.paper);
    else if (id === hov) { const a = bg.globalAlpha; bg.globalAlpha = a * HOVER_ALPHA; brackets(bg, r.x - 1, r.y - 1, r.w + 2, r.h + 2, P.paper); bg.globalAlpha = a; }
  }
}

/** Draw the part of `entry` that camera `c` sees into the viewport, at `alpha`, clipped to the viewport. */
export function blitBuffer(g: CanvasRenderingContext2D, entry: WorldBuffer, c: Camera, alpha: number, viewport: Rect, ratio: PixelRatio): void {
  const size = entry.size;
  const ox = (viewport.x + viewport.w / 2) * ratio.x + (size.x - c.cx) * c.s, oy = (viewport.y + viewport.h / 2) * ratio.y + (size.y - c.cy) * c.s;
  const x0 = viewport.x * ratio.x, y0 = viewport.y * ratio.y, x1 = x0 + viewport.w * ratio.x, y1 = y0 + viewport.h * ratio.y;
  const sx0 = Math.max(0, Math.floor((x0 - ox) / c.s)), sy0 = Math.max(0, Math.floor((y0 - oy) / c.s));
  const sx1 = Math.min(size.w, Math.ceil((x1 - ox) / c.s)), sy1 = Math.min(size.h, Math.ceil((y1 - oy) / c.s));
  if (sx1 <= sx0 || sy1 <= sy0) return;
  g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
  g.globalAlpha = alpha; g.imageSmoothingEnabled = false;
  g.drawImage(entry.canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, ox + sx0 * c.s, oy + sy0 * c.s, (sx1 - sx0) * c.s, (sy1 - sy0) * c.s);
  g.restore();
}
