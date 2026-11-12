// The rest pan (lead ruling on A05/A09/A20): a level rests at 2 or more (N = 1 is too small to read).
// When its focus doesn't fit whole at that scale, the rest frames a view-sized window of it instead,
// centred on the level's rest centre (Room: the active rack's row; World: the owned sites), and the
// player pans the window with the rack row's clamped drag and snap. The System board stays whole
// (D15.2): a `wholeAtRest` level is never panned on desktop; on a phone too small for it at 2 it
// pans, because N = 1 is too small to read there too.
//
// For agent U: while a level rests with `restPan.active`, route the world drag to it:
// setDragging(true) on start; scrollTo(x0 - dxCss / restPan.scale, y0 - dyCss / restPan.scale) on
// move, from x0 = restPan.x and y0 = restPan.y at the start; setDragging(false) (or release(vx, vy))
// on end, which snaps. The wheel: scrollBy(dx / scale, dy / scale), then setDragging(false) when quiet.
import { fitScale } from './camera';
import type { PixelRatio, RestFraming } from './camera';
import { P } from './palette';
import type { Point, Rect } from './geom';
import type { LevelRenderer, LevelSnapshot, NodeRef, RenderSnapshot, RestArea } from './types';

export interface RestPanControl {
  /** True while the focus world is larger than the view at its rest scale. */
  readonly active: boolean;
  /** Art px the window is panned from its rest centre. */
  readonly x: number; readonly y: number;
  readonly dragging: boolean;
  /** The rest scale, CSS px per art px: divide drag px by it. */
  readonly scale: number;
  scrollBy(dx: number, dy?: number): void;
  scrollTo(x: number, y?: number): void;
  setDragging(on: boolean): void;
  /** End a gesture: carry the velocity (art px/s) 0.15 s on, then snap. */
  release(vx?: number, vy?: number): void;
  reset(): void;
}
/** A level's pan snap pitch in art px (0 = no snap on that axis). */
export interface PanSnap { readonly x: number; readonly y: number }

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const snapTo = (v: number, base: number, pitch: number): number => (pitch > 0 ? base + Math.round((v - base) / pitch) * pitch : v);

export class RestPan implements RestPanControl {
  active = false; x = 0; y = 0; dragging = false; scale = 2;
  /** The panned window's and the whole focus's height in art px (0 when the rest doesn't pan). */
  viewH = 0; fullH = 0;
  /** How far down the focus the window is, 0 (its top) to 1 (its foot). */
  get shareY(): number { return this.hiY > this.loY ? (this.y - this.loY) / (this.hiY - this.loY) : 0; }
  private loX = 0; private hiX = 0; private loY = 0; private hiY = 0;
  private snap: PanSnap = { x: 0, y: 0 };
  private snapBase: Point = { x: 0, y: 0 };
  private clampAll(): void { this.x = Math.round(clamp(this.x, this.loX, this.hiX)); this.y = Math.round(clamp(this.y, this.loY, this.hiY)); }
  scrollBy(dx: number, dy = 0): void { this.x += Number.isFinite(dx) ? dx : 0; this.y += Number.isFinite(dy) ? dy : 0; this.clampAll(); }
  scrollTo(x: number, y = this.y): void { this.x = Number.isFinite(x) ? x : 0; this.y = Number.isFinite(y) ? y : 0; this.clampAll(); }
  setDragging(on: boolean): void { if (this.dragging && !on) this.snapNow(); this.dragging = on; }
  release(vx = 0, vy = 0): void { this.dragging = false; this.scrollBy(vx * 0.15, vy * 0.15); this.snapNow(); }
  reset(): void { this.x = 0; this.y = 0; this.dragging = false; this.active = false; this.fullH = 0; }
  private snapNow(): void {
    this.x = snapTo(this.x, this.snapBase.x, this.snap.x); this.y = snapTo(this.y, this.snapBase.y, this.snap.y); this.clampAll();
  }
  /**
   * Write into `focus` the window of it the rest frames at `scale`: `viewW × viewH` art px, centred on
   * `centre` plus the pan, clamped inside the focus. An axis that fits is not panned.
   */
  window(focus: Rect, viewW: number, viewH: number, centre: Point, scale: number, snap: PanSnap | null): void {
    this.active = true; this.scale = scale; this.snap = snap ?? { x: 0, y: 0 };
    const w = Math.min(focus.w, Math.floor(viewW)), h = Math.min(focus.h, Math.floor(viewH));
    this.viewH = h; this.fullH = focus.h;
    const x0 = clamp(Math.round(centre.x - w / 2), focus.x, focus.x + focus.w - w), y0 = clamp(Math.round(centre.y - h / 2), focus.y, focus.y + focus.h - h);
    this.loX = focus.x - x0; this.hiX = focus.x + focus.w - w - x0; this.loY = focus.y - y0; this.hiY = focus.y + focus.h - h - y0;
    // Snap stops: a window edge on the focus's pitch grid.
    this.snapBase = { x: focus.x - x0, y: focus.y - y0 };
    this.clampAll();
    focus.x = x0 + this.x; focus.y = y0 + this.y; focus.w = w; focus.h = h;
  }
  /** The focus fits: no pan. */
  idle(): void { this.active = false; this.x = 0; this.y = 0; this.fullH = 0; }
}
/**
 * The pan cue (a level with `panCue`): a 1·N bar on the view's right edge, as long as the share of the
 * focus in the window and at the window's place in it. It moves only with the pan.
 */
export function drawPanCue(g: CanvasRenderingContext2D, pan: RestPan, vp: Rect, top: number, ratio: PixelRatio, n: number): void {
  if (!pan.active || pan.fullH <= pan.viewH) return;
  const y0 = vp.y + top + 2 * n, room = vp.h - top - 4 * n, len = Math.max(8 * n, Math.round(room * pan.viewH / pan.fullH / n) * n);
  const x = vp.x + vp.w - 2 * n, y = y0 + Math.round((room - len) * pan.shareY / n) * n;
  g.save(); g.setTransform(ratio.x, 0, 0, ratio.y, 0, 0);
  g.fillStyle = P.ink; g.fillRect(x - n, y - n, 3 * n, len + 2 * n);
  g.fillStyle = P.mute; g.fillRect(x, y, n, len);
  g.restore();
}
/** The one rest pan the game's renderer drives. */
export const restPan = new RestPan();

/**
 * Decide the rest window for the focus level (called by the core at rest, after `focus()`): the
 * level's focus fits at 2 or more, or it is `wholeAtRest` (System), or it rests at 2 and pans.
 * `hint` is the node the player came from (the rack a Room zoomed out of), or the home node.
 */
export function frameRest(lv: LevelRenderer, s: LevelSnapshot, focus: Rect, vp: Rect, f: RestFraming, area: RestArea, hint: NodeRef | null,
  report: (where: string, error: unknown) => void): void {
  const min = lv.panAtRestScale ? f.scale : Math.min(2, f.scale), n = fitScale(focus, vp, f);
  if (n >= min) { restPan.idle(); return; }
  // A whole-at-rest level (System) never pans on desktop. A phone too small for it at 2 pans it rather than rest at 1.
  if (lv.wholeAtRest && f.form !== 'phone') {
    restPan.idle();
    report(`${s.level} rest`, new Error(`does not fit whole at 2 (${focus.w}×${focus.h} art px in ${area.w}×${area.h} CSS px)`));
    return;
  }
  const centre = { x: focus.x + focus.w / 2, y: focus.y + focus.h / 2 };
  try { lv.restCentre?.(s as never, centre, hint); } catch (error) { report(`${s.level} restCentre`, error); }
  restPan.window(focus, area.w / min, area.h / min, centre, min, lv.panSnap?.(s as never) ?? null);
}
/** The home node one level below `s` (the rack a Room centres on when the player didn't come from one). */
export function homeBelow(snapshot: RenderSnapshot, s: LevelSnapshot): NodeRef | null {
  const below = s.level === 'room' ? 'rack' : s.level === 'rack' ? 'system' : null;
  return below ? snapshot.home[below] ?? null : null;
}
