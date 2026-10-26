// World labels (D2.1, D11): crisp Chakra Petch at the one body size, drawn by the core on the
// device-resolution canvas over the level art, at rest only. A level writes labels anchored in its
// own art px through `LabelWriter`; the core projects them, snaps them to the 8 px text grid and
// draws them. Levels never set a font, a size or a colour value.
import { toScreen } from './camera';
import type { Camera, PixelRatio } from './camera';
import type { Point, Rect } from './geom';

export type LabelTone = 'name' | 'silk' | 'value' | 'mute' | 'dim' | 'net' | 'cyan' | 'gold' | 'data' | 'warn' | 'ok' | 'rnd';
export type LabelAlign = 'left' | 'right' | 'center';
export const TONE: Readonly<Record<LabelTone, string>> = {
  name: '#efeaff', silk: '#a99be6', value: '#e6dcff', mute: '#a99be6', dim: '#6e6698', net: '#7be38f',
  cyan: '#a6f6ff', gold: '#ffcc3d', data: '#27d9a0', warn: '#ffb03b', ok: '#7dff9a', rnd: '#ff6bd6',
};
export const TAG_FILL = 'rgba(14, 11, 28, 0.85)';
/** CSS px. One body size and one line height per layout (L2: 16/24 desktop, 13/16 phone). */
export interface Typography { readonly body: number; readonly line: number; readonly grid: number }
export const DESKTOP_TYPE: Typography = { body: 16, line: 24, grid: 8 };
export const PHONE_TYPE: Typography = { body: 13, line: 16, grid: 8 };
/** World labels follow the world's rest scale (A01): the desktop type at 3 and up, the phone type at 2 and below. */
export const typeForScale = (scale: number): Typography => (scale >= 3 ? DESKTOP_TYPE : PHONE_TYPE);

export interface LabelWriter {
  /** Start a label. (x, y) is in the level's art px: the top of its first line, at its left, right or centre edge. */
  label(id: string, x: number, y: number, align?: LabelAlign, tag?: boolean): LabelWriter;
  /** Append a run to the current line. `bold` is the name weight (700); body text is 500. */
  text(text: string, tone?: LabelTone, bold?: boolean): LabelWriter;
  /** Continue on the next line, one line height down. */
  br(): LabelWriter;
  /** A 1·N leader from the label's first line to (x, y) in art px: across, then up or down. */
  leader(x: number, y: number): LabelWriter;
}
interface Run { text: string; tone: LabelTone; bold: boolean; line: number }
interface Label { id: string; x: number; y: number; align: LabelAlign; tag: boolean; first: number; end: number; lines: number; lead: boolean; lx: number; ly: number }
export const MAX_LABELS = 64, MAX_RUNS = 192;

/** A reusable label list. Never allocates after warm-up except the strings levels pass in. */
export class LabelBuffer implements LabelWriter {
  readonly labels: Label[] = Array.from({ length: MAX_LABELS }, () => ({ id: '', x: 0, y: 0, align: 'left' as LabelAlign, tag: false, first: 0, end: 0, lines: 1, lead: false, lx: 0, ly: 0 }));
  readonly runs: Run[] = Array.from({ length: MAX_RUNS }, () => ({ text: '', tone: 'name' as LabelTone, bold: false, line: 0 }));
  count = 0;
  private runCount = 0;
  private current: Label | null = null;
  clear(): void { this.count = 0; this.runCount = 0; this.current = null; }
  label(id: string, x: number, y: number, align: LabelAlign = 'left', tag = false): LabelWriter {
    if (this.count >= MAX_LABELS) { this.current = null; return this; }
    const l = this.labels[this.count++];
    l.id = id; l.x = x; l.y = y; l.align = align; l.tag = tag; l.first = this.runCount; l.end = this.runCount; l.lines = 1; l.lead = false;
    this.current = l;
    return this;
  }
  text(text: string, tone: LabelTone = 'name', bold = false): LabelWriter {
    const l = this.current;
    if (!l || this.runCount >= MAX_RUNS || !text) return this;
    const r = this.runs[this.runCount++];
    r.text = text; r.tone = tone; r.bold = bold; r.line = l.lines - 1; l.end = this.runCount;
    return this;
  }
  br(): LabelWriter { if (this.current) this.current.lines++; return this; }
  leader(x: number, y: number): LabelWriter {
    const l = this.current;
    if (l) { l.lead = true; l.lx = x; l.ly = y; }
    return this;
  }
  find(id: string): Label | null {
    for (let i = 0; i < this.count; i++) if (this.labels[i].id === id) return this.labels[i];
    return null;
  }
}

const at: Point = { x: 0, y: 0 }, end: Point = { x: 0, y: 0 };
const LEADER = '#a99be6';
const GAP = ' ';
function font(t: Typography, bold: boolean): string { return `${bold ? 700 : 500} ${t.body}px "Chakra Petch"`; }
function lineWidth(g: CanvasRenderingContext2D, b: LabelBuffer, l: Label, line: number, t: Typography): number {
  let w = 0, any = false;
  for (let i = l.first; i < l.end; i++) {
    const r = b.runs[i];
    if (r.line !== line) continue;
    g.font = font(t, r.bold);
    w += g.measureText(any ? GAP + r.text : r.text).width; any = true;
  }
  return w;
}
const snap = (v: number, origin: number, grid: number) => origin + Math.round((v - origin) / grid) * grid;
/**
 * Draw every label, projected through `cam`. `g` has an identity transform; text is drawn in CSS px.
 * `alpha` fades them through a zoom (A27).
 */
export function drawLabels(g: CanvasRenderingContext2D, b: LabelBuffer, cam: Camera, vp: Rect, ratio: PixelRatio, t: Typography, alpha = 1): void {
  if (!b.count || alpha <= 0) return;
  g.save();
  g.setTransform(ratio.x, 0, 0, ratio.y, 0, 0);
  g.beginPath(); g.rect(vp.x, vp.y, vp.w, vp.h); g.clip();
  g.textBaseline = 'middle'; g.globalAlpha = alpha;
  const n = Math.max(1, Math.round(cam.s / ratio.x));
  for (let i = 0; i < b.count; i++) {
    const l = b.labels[i];
    toScreen(cam, vp, ratio, l.x, l.y, at);
    const top = snap(at.y, vp.y, t.grid);
    for (let line = 0; line < l.lines; line++) {
      const w = lineWidth(g, b, l, line, t);
      if (w <= 0) continue;
      const left = l.align === 'left' ? snap(at.x, vp.x, t.grid) : l.align === 'right' ? snap(at.x, vp.x, t.grid) - w : snap(at.x - w / 2, vp.x, t.grid);
      const y = top + line * t.line;
      if (line === 0 && l.lead) leader(g, l, left, w, y, t.line, cam, vp, ratio, n);
      if (l.tag) { g.fillStyle = TAG_FILL; g.fillRect(left - 6, y, Math.ceil(w) + 12, t.line); }
      let x = left, any = false;
      for (let k = l.first; k < l.end; k++) {
        const r = b.runs[k];
        if (r.line !== line) continue;
        g.font = font(t, r.bold); g.fillStyle = TONE[r.tone];
        const s = any ? GAP + r.text : r.text;
        g.fillText(s, x, y + t.line / 2);
        x += g.measureText(s).width; any = true;
      }
    }
  }
  g.restore();
}
/**
 * The leader: from the label's side facing the point, across to the point's x, then to its y; or,
 * when the point is under or over the label, straight from its bottom or top edge.
 */
function leader(g: CanvasRenderingContext2D, l: Label, left: number, w: number, top: number, lineH: number, cam: Camera, vp: Rect,
  ratio: PixelRatio, n: number): void {
  toScreen(cam, vp, ratio, l.lx, l.ly, end);
  const ex = Math.round(end.x), ey = Math.round(end.y), my = Math.round(top + lineH / 2 - n / 2);
  g.fillStyle = LEADER;
  if (ex >= left && ex <= left + w) {
    const y0 = ey > top ? Math.round(top + lineH) : Math.round(top);
    g.fillRect(ex, Math.min(y0, ey), n, Math.abs(ey - y0) + n);
    return;
  }
  const x0 = ex >= left + w ? Math.ceil(left + w) + 8 : Math.floor(left) - 8;
  g.fillRect(Math.min(x0, ex), my, Math.abs(ex - x0) + n, n);
  g.fillRect(ex, Math.min(my, ey), n, Math.abs(ey - my) + n);
}
