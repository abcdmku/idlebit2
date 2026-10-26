// The rest pan (lead ruling on A05/A09/A20): a level rests at 2 or more (N = 1 is too small to read).
// When its focus doesn't fit whole at that scale, the rest frames a view-sized window of it instead,
// centred on the level's rest centre (Room: the active rack's row; World: the owned sites), and the
// player pans the window with the rack row's clamped drag and snap. The System board is never
// panned: it stays whole (D15.2), so `wholeAtRest` levels may still drop below 2 on phone.
//
// For agent U: while a level rests with `restPan.active`, route the world drag to it:
// setDragging(true) on start; scrollTo(x0 - dxCss / restPan.scale, y0 - dyCss / restPan.scale) on
// move, from x0 = restPan.x and y0 = restPan.y at the start; setDragging(false) (or release(vx, vy))
// on end, which snaps. The wheel: scrollBy(dx / scale, dy / scale), then setDragging(false) when quiet.
import { fitScale } from './camera';
import type { RestFraming } from './camera';
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
  private loX = 0; private hiX = 0; private loY = 0; private hiY = 0;
  private snap: PanSnap = { x: 0, y: 0 };
  private snapBase: Point = { x: 0, y: 0 };
  private clampAll(): void { this.x = Math.round(clamp(this.x, this.loX, this.hiX)); this.y = Math.round(clamp(this.y, this.loY, this.hiY)); }
  scrollBy(dx: number, dy = 0): void { this.x += Number.isFinite(dx) ? dx : 0; this.y += Number.isFinite(dy) ? dy : 0; this.clampAll(); }
  scrollTo(x: number, y = this.y): void { this.x = Number.isFinite(x) ? x : 0; this.y = Number.isFinite(y) ? y : 0; this.clampAll(); }
  setDragging(on: boolean): void { if (this.dragging && !on) this.snapNow(); this.dragging = on; }
  release(vx = 0, vy = 0): void { this.dragging = false; this.scrollBy(vx * 0.15, vy * 0.15); this.snapNow(); }
  reset(): void { this.x = 0; this.y = 0; this.dragging = false; this.active = false; }
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
    const x0 = clamp(Math.round(centre.x - w / 2), focus.x, focus.x + focus.w - w), y0 = clamp(Math.round(centre.y - h / 2), focus.y, focus.y + focus.h - h);
    this.loX = focus.x - x0; this.hiX = focus.x + focus.w - w - x0; this.loY = focus.y - y0; this.hiY = focus.y + focus.h - h - y0;
    // Snap stops: a window edge on the focus's pitch grid.
    this.snapBase = { x: focus.x - x0, y: focus.y - y0 };
    this.clampAll();
    focus.x = x0 + this.x; focus.y = y0 + this.y; focus.w = w; focus.h = h;
  }
  /** The focus fits: no pan. */
  idle(): void { this.active = false; this.x = 0; this.y = 0; }
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
  if (lv.wholeAtRest) {
    restPan.idle();
    if (f.form !== 'phone') report(`${s.level} rest`, new Error(`does not fit whole at 2 (${focus.w}×${focus.h} art px in ${area.w}×${area.h} CSS px)`));
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
