// A level's free world at rest (A05): the view below the strip minus its gutters, at the shell's N.
// A level that spans the dock (World, desktop) rests under a framing whose right gutter is a lattice.
import { gutters } from './camera';
import type { RestFraming } from './camera';
import type { Rect } from './geom';
import type { RestArea } from './types';

interface Spans { readonly spansDock?: boolean }

export class RestAreas {
  private readonly area = { w: 0, h: 0, scale: 1 };
  private readonly spanArea = { w: 0, h: 0, scale: 1 };
  private span: RestFraming | null = null;
  private spanOf: RestFraming | null = null;
  /** The framing a level rests under: a level that spans the dock (World, desktop) also takes the callout dock's gutter. */
  framingOf(lv: Spans, framing: RestFraming | null, viewport: Rect): RestFraming | null {
    if (!framing || !lv.spansDock || framing.form === 'phone' || framing.gutters) return framing;
    if (this.spanOf !== framing) { this.spanOf = framing; this.span = { ...framing, gutters: { ...gutters(viewport, framing), right: framing.lattice } }; }
    return this.span;
  }
  /** The level's free world (CSS px and the shell's N), or undefined without a framing. The result is reused. */
  areaOf(lv: Spans, framing: RestFraming | null, viewport: Rect): RestArea | undefined {
    const f = this.framingOf(lv, framing, viewport);
    if (!f) return undefined;
    const gt = gutters(viewport, f), a = f === framing ? this.area : this.spanArea;
    a.w = viewport.w - gt.left - gt.right; a.h = viewport.h - f.top - gt.top - gt.bottom; a.scale = f.scale;
    return a;
  }
}
