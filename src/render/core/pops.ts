// Payout pops: +Credits / +Data on the component that completed the work, at the completion's
// real sim time. A level maps each completion to a component (LevelRenderer.payoutAnchor). The board
// sums completions that hit one component within MERGE_MS into one pop and keeps one live pop per
// component. It holds back a pop whose plate would cover another component's young pop. So the
// screen never sprays, whatever the completion rate. Pay is per whole task: a multi-member or (D25)
// sharded task is one completion, located at the component that finished its last piece.
import { TICK_MS } from '../../game';
import type { CompletionView } from '../../game';
import { toScreen } from './camera';
import type { Camera, PixelRatio } from './camera';
import { whole } from './format';
import type { Rect } from './geom';
import { TAG_FILL, TONE } from './labels';
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
/** Sim ms. */
export const POP_LIFE_MS = 1000, POP_RISE_MS = 300, POP_FADE_MS = 300, POP_MERGE_MS = 250;
/** Art px the plate rises over POP_RISE_MS, one art px at a time. */
export const POP_RISE_ART = 3;
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
const at = { x: 0, y: 0 }, plate = rect(), other = rect();
/** The HUD's currency icons, 8 art px: one line tall at N (24 CSS px desktop, 16 phone). */
const ICON = 8, PAD = 4, GAP = 4, SEP = 8;

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
  /** True while the plate would cover another component's pop that is still in its first half. */
  private blocked(g: CanvasRenderingContext2D, p: Pending, now: number, cam: Camera, vp: Rect, ratio: PixelRatio, type: Typography, n: number): boolean {
    const cw = g.measureText(`+${whole(p.credits)}`).width, dw = p.data >= 1 ? g.measureText(`+${whole(p.data)}`).width : 0;
    plateRect(p.anchor, cw, dw, 0, cam, vp, ratio, type, n, plate);
    for (let i = 0; i < this.popCount; i++) {
      const o = this.pops[i]!;
      if (o.key === p.key || now - o.born >= POP_LIFE_MS / 2) continue;
      plateRect(o.anchor, o.credW, o.dataW, 0, cam, vp, ratio, type, n, other);
      if (plate.x < other.x + other.w && other.x < plate.x + plate.w && plate.y < other.y + other.h && other.y < plate.y + plate.h) return true;
    }
    return false;
  }
  private texts(g: CanvasRenderingContext2D, pop: Pop): void {
    pop.credText = pop.credits >= 1 ? `+${whole(pop.credits)}` : '';
    pop.dataText = pop.data >= 1 ? `+${whole(pop.data)}` : '';
    pop.credW = pop.credText ? g.measureText(pop.credText).width : 0;
    pop.dataW = pop.dataText ? g.measureText(pop.dataText).width : 0;
  }
  private drawPop(g: CanvasRenderingContext2D, pop: Pop, now: number, cam: Camera, vp: Rect, ratio: PixelRatio, type: Typography,
    n: number, reduced: boolean): void {
    const age = Math.max(0, now - pop.born);
    const rise = reduced ? 0 : Math.round(Math.min(1, age / POP_RISE_MS) * POP_RISE_ART);
    plateRect(pop.anchor, pop.credW, pop.dataW, rise, cam, vp, ratio, type, n, plate);
    g.globalAlpha = reduced ? 1 : Math.min(1, (POP_LIFE_MS - age) / POP_FADE_MS);
    g.fillStyle = TAG_FILL; g.fillRect(plate.x, plate.y, plate.w, plate.h);
    const icon = ICON * n, iy = plate.y + Math.round((plate.h - icon) / 2 / n) * n, ty = plate.y + plate.h / 2;
    let x = plate.x + PAD;
    if (pop.credText) {
      g.drawImage(SPR.coin8, x, iy, icon, icon); x += icon + GAP;
      g.fillStyle = TONE.gold; g.fillText(pop.credText, x, ty); x += Math.ceil(pop.credW) + SEP;
    }
    if (pop.dataText) {
      g.drawImage(SPR.gem8, x, iy, icon, icon); x += icon + GAP;
      g.fillStyle = TONE.data; g.fillText(pop.dataText, x, ty);
    }
    g.globalAlpha = 1;
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
 * The plate in CSS px: centred on the anchor, one line tall, `rise` art px up, every edge on the
 * art grid (N CSS px from the viewport origin) so the icons stay crisp.
 */
function plateRect(anchor: Rect, credW: number, dataW: number, rise: number, cam: Camera, vp: Rect, ratio: PixelRatio,
  type: Typography, n: number, out: Rect): Rect {
  toScreen(cam, vp, ratio, anchor.x + anchor.w / 2, anchor.y + anchor.h / 2, at);
  const icon = ICON * n;
  let w = PAD * 2;
  if (credW > 0) w += icon + GAP + Math.ceil(credW);
  if (dataW > 0) w += (credW > 0 ? SEP : 0) + icon + GAP + Math.ceil(dataW);
  out.w = Math.ceil(w / n) * n; out.h = Math.max(type.line, icon);
  out.x = vp.x + Math.round((at.x - out.w / 2 - vp.x) / n) * n;
  out.y = vp.y + Math.round((at.y - out.h / 2 - vp.y) / n) * n - rise * n;
  return out;
}
