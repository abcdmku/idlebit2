// Payout pops: +Credits over +Data on the component that completed the work, at the completion's
// real sim time, rising and fading out with no backing plate. A level maps each completion to a
// component (LevelRenderer.payoutAnchor). The board sums completions that hit one component within
// MERGE_MS into one pop and keeps one live pop per component. It holds back a pop whose rising path
// would cross another component's live pop. So the screen never sprays, whatever the completion rate. Pay is per whole task: a multi-member or (D25)
// sharded task is one completion, located at the component that finished its last piece.
import { TICK_MS } from '../../game';
import type { CompletionView } from '../../game';
import { toScreen } from './camera';
import type { Camera, PixelRatio } from './camera';
import { payoutCount } from './format';
import type { Rect } from './geom';
import { TONE } from './labels';
import type { Typography } from './labels';
import { SPR } from './sprites';

/**
 * A completion as the renderer reads it. `seq`, `tick`, `rack`, `room` and `site` are optional until
 * the sim's CompletionView carries them. Without `seq` a snapshot's list is read once per snapshot;
 * without `tick` it is taken as the snapshot's last tick.
 */
export type Completion = CompletionView & {
  readonly seq?: number; readonly tick?: number;
  readonly rack?: number | null; readonly room?: number | null; readonly site?: number | null;
};
/** Sim ms. A pop fades out over the last POP_FADE_SHARE of its life. */
export const POP_LIFE_MS = 1000, POP_MERGE_MS = 250, POP_FADE_SHARE = 0.6;
/** Art px a pop rises over its life, eased out (fast start, slow end), one whole art px at a time. */
export const POP_RISE_ART = 14;
/** The pop's rise (art px) and opacity at `age` sim ms. */
export function popMotion(age: number, out: { rise: number; alpha: number }): { rise: number; alpha: number } {
  const u = Math.max(0, Math.min(1, age / POP_LIFE_MS));
  out.rise = Math.round(POP_RISE_ART * (1 - (1 - u) ** 3));
  out.alpha = Math.max(0, Math.min(1, (1 - u) / POP_FADE_SHARE));
  return out;
}
export const MAX_POPS = 24, MAX_PENDING = 64;
/** When a completion happened, in sim ms. */
export function completionMs(c: Completion, snapshotTick: number): number {
  return ((c.tick ?? snapshotTick - 1) + Math.max(0, Math.min(1, c.tau))) * TICK_MS;
}

interface Pending { key: number; at: number; credits: number; data: number; anchor: Rect; merge: number }
interface Pop {
  key: number; born: number; credits: number; data: number; anchor: Rect; merge: number;
  credText: string; dataText: string; credW: number; dataW: number;
}
const rect = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });
const at = { x: 0, y: 0 }, plate = rect(), other = rect(), motion = { rise: 0, alpha: 1 };
/** The HUD's currency icons, 8 art px: one line tall at N (24 CSS px desktop, 16 phone). */
const ICON = 8, GAP = 4, INK = '#0e0b1c';

export class PayoutPops {
  private readonly pending: Pending[] = Array.from({ length: MAX_PENDING }, () => ({ key: -1, at: 0, credits: 0, data: 0, anchor: rect(), merge: POP_MERGE_MS }));
  private pendingCount = 0;
  private readonly pops: Pop[] = Array.from({ length: MAX_POPS }, () => ({
    key: -1, born: 0, credits: 0, data: 0, anchor: rect(), merge: POP_MERGE_MS, credText: '', dataText: '', credW: 0, dataW: 0,
  }));
  private popCount = 0;
  get live(): number { return this.popCount; }
  get waiting(): number { return this.pendingCount; }
  clear(): void { this.pendingCount = 0; this.popCount = 0; }
  /**
   * One completion on component `key` at `anchor` (world art px), at sim time `atMs`. Completions within
   * `mergeMs` of the component's live pop join it (Room: 1 s, one pop per rack per second).
   */
  add(key: number, anchor: Rect, atMs: number, credits: number, data: number, mergeMs = POP_MERGE_MS): void {
    let p: Pending | null = null;
    for (let i = 0; i < this.pendingCount; i++) if (this.pending[i]!.key === key) { p = this.pending[i]!; break; }
    if (!p) {
      if (this.pendingCount >= MAX_PENDING) return;
      p = this.pending[this.pendingCount++]!;
      p.key = key; p.at = atMs; p.credits = 0; p.data = 0;
    }
    p.at = Math.min(p.at, atMs); p.credits += credits; p.data += data; p.merge = mergeMs;
    p.anchor.x = anchor.x; p.anchor.y = anchor.y; p.anchor.w = anchor.w; p.anchor.h = anchor.h;
  }
  /**
   * Turn pending sums into pops, retire old pops, and draw. `g` has any transform; text is drawn in
   * CSS px through `ratio`. `n` is the art scale; `clip` is the free world in CSS px.
   */
  draw(g: CanvasRenderingContext2D, nowMs: number, cam: Camera, vp: Rect, ratio: PixelRatio, type: Typography, n: number,
    clip: Rect, reducedMotion: boolean): void {
    g.save();
    g.setTransform(ratio.x, 0, 0, ratio.y, 0, 0);
    g.font = `700 ${type.body}px "Chakra Petch"`;
    for (let i = this.popCount - 1; i >= 0; i--) if (nowMs - this.pops[i]!.born >= POP_LIFE_MS) this.remove(i);
    this.flush(g, nowMs, cam, vp, ratio, type, n);
    if (this.popCount) {
      g.beginPath(); g.rect(clip.x, clip.y, clip.w, clip.h); g.clip();
      g.imageSmoothingEnabled = false; g.textBaseline = 'middle';
      for (let i = 0; i < this.popCount; i++) this.drawPop(g, this.pops[i]!, nowMs, cam, vp, ratio, type, n, reducedMotion);
    }
    g.restore();
  }
  private flush(g: CanvasRenderingContext2D, now: number, cam: Camera, vp: Rect, ratio: PixelRatio, type: Typography, n: number): void {
    for (let i = this.pendingCount - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (now - p.at >= POP_LIFE_MS) { this.dropPending(i); continue; }
      const own = this.find(p.key);
      if (own && p.at - own.born < own.merge) {
        own.credits += p.credits; own.data += p.data; this.texts(g, own); this.dropPending(i); continue;
      }
      if (p.credits < 1 && p.data < 1) { this.dropPending(i); continue; }
      if (this.blocked(g, p, now, cam, vp, ratio, type, n)) continue;
      const pop = own ?? (this.popCount < MAX_POPS ? this.pops[this.popCount++]! : null);
      if (!pop) continue;
      pop.key = p.key; pop.born = Math.min(now, Math.max(p.at, now - 150)); pop.credits = p.credits; pop.data = p.data; pop.merge = p.merge;
      pop.anchor.x = p.anchor.x; pop.anchor.y = p.anchor.y; pop.anchor.w = p.anchor.w; pop.anchor.h = p.anchor.h;
      this.texts(g, pop); this.dropPending(i);
    }
  }
  /**
   * True while the pop's whole path (its block from rest to full rise) would cross the path of another
   * component's live pop: rising pops are tall, so they are kept apart over their whole life.
   */
  private blocked(g: CanvasRenderingContext2D, p: Pending, now: number, cam: Camera, vp: Rect, ratio: PixelRatio, type: Typography, n: number): boolean {
    const cw = p.credits >= 1 ? g.measureText(`+${payoutCount(p.credits)}`).width : 0, dw = p.data >= 1 ? g.measureText(`+${payoutCount(p.data)}`).width : 0;
    pathRect(p.anchor, cw, dw, cam, vp, ratio, type, n, plate);
    for (let i = 0; i < this.popCount; i++) {
      const o = this.pops[i]!;
      if (o.key === p.key || now - o.born >= POP_LIFE_MS) continue;
      pathRect(o.anchor, o.credW, o.dataW, cam, vp, ratio, type, n, other);
      if (plate.x < other.x + other.w && other.x < plate.x + plate.w && plate.y < other.y + other.h && other.y < plate.y + plate.h) return true;
    }
    return false;
  }
  private texts(g: CanvasRenderingContext2D, pop: Pop): void {
    pop.credText = pop.credits >= 1 ? `+${payoutCount(pop.credits)}` : '';
    pop.dataText = pop.data >= 1 ? `+${payoutCount(pop.data)}` : '';
    pop.credW = pop.credText ? g.measureText(pop.credText).width : 0;
    pop.dataW = pop.dataText ? g.measureText(pop.dataText).width : 0;
  }
  private drawPop(g: CanvasRenderingContext2D, pop: Pop, now: number, cam: Camera, vp: Rect, ratio: PixelRatio, type: Typography,
    n: number, reduced: boolean): void {
    popMotion(Math.max(0, now - pop.born), motion);
    blockRect(pop.anchor, pop.credW, pop.dataW, reduced ? 0 : motion.rise, cam, vp, ratio, type, n, plate);
    g.globalAlpha = reduced ? 1 : motion.alpha;
    // No backing plate (user): each line is its icon, then the amount with a 1·N ink outline.
    const icon = ICON * n, line = Math.max(type.line, icon);
    g.lineWidth = 2 * n; g.lineJoin = 'round'; g.strokeStyle = INK;
    let y = plate.y;
    if (pop.credText) { this.line(g, SPR.coin8, pop.credText, TONE.gold, plate.x, y, icon, line, n); y += line; }
    if (pop.dataText) this.line(g, SPR.gem8, pop.dataText, TONE.data, plate.x, y, icon, line, n);
    g.globalAlpha = 1;
  }
  /** One line: the icon at the block's left edge, the amount beside it, outlined in ink. */
  private line(g: CanvasRenderingContext2D, img: CanvasImageSource, text: string, colour: string, x: number, y: number, icon: number, line: number, n: number): void {
    const iy = y + Math.round((line - icon) / 2 / n) * n, ty = y + line / 2, tx = x + icon + GAP;
    g.drawImage(img, x, iy, icon, icon);
    g.strokeText(text, tx, ty); g.fillStyle = colour; g.fillText(text, tx, ty);
  }
  private find(key: number): Pop | null {
    for (let i = 0; i < this.popCount; i++) if (this.pops[i]!.key === key) return this.pops[i]!;
    return null;
  }
  private remove(i: number): void {
    const last = --this.popCount, a = this.pops[i]!;
    this.pops[i] = this.pops[last]!; this.pops[last] = a;
  }
  private dropPending(i: number): void {
    const last = --this.pendingCount, a = this.pending[i]!;
    this.pending[i] = this.pending[last]!; this.pending[last] = a;
  }
}

/**
 * The pop's block in CSS px: the credits line over the data line (only the non-zero ones), left-aligned
 * on the icons, centred on the anchor and `rise` art px up. Every edge sits on the art grid (N CSS px
 * from the viewport origin) so the icons stay crisp.
 */
function blockRect(anchor: Rect, credW: number, dataW: number, rise: number, cam: Camera, vp: Rect, ratio: PixelRatio,
  type: Typography, n: number, out: Rect): Rect {
  toScreen(cam, vp, ratio, anchor.x + anchor.w / 2, anchor.y + anchor.h / 2, at);
  const icon = ICON * n, line = Math.max(type.line, icon), lines = (credW > 0 ? 1 : 0) + (dataW > 0 ? 1 : 0);
  out.w = Math.ceil((icon + GAP + Math.ceil(Math.max(credW, dataW))) / n) * n; out.h = Math.max(1, lines) * line;
  out.x = vp.x + Math.round((at.x - out.w / 2 - vp.x) / n) * n;
  out.y = vp.y + Math.round((at.y - out.h / 2 - vp.y) / n) * n - rise * n;
  return out;
}
/** The block's whole path: from rest up to its full rise. */
function pathRect(anchor: Rect, credW: number, dataW: number, cam: Camera, vp: Rect, ratio: PixelRatio, type: Typography, n: number, out: Rect): Rect {
  blockRect(anchor, credW, dataW, 0, cam, vp, ratio, type, n, out);
  out.y -= POP_RISE_ART * n; out.h += POP_RISE_ART * n;
  return out;
}
