// The rack's room row (D17.2) and the horizontal scroll along it.
//
// Row data: RackSnapshot's `slot` (room slot, row-major) and `row` (the row's slot views), R36.
//
// Scroll, for agent U (the UI owns pointer input; L2 README "Rack row"):
//   import { rackRowScroll } from 'src/render/levels/rack' (or this file)
//   - once per layout: rackRowScroll.setStep(lattice / N)   (desktop 24 / 3 = 8, phone 8 / 2 = 4 art px)
//   - pointerdown on the world while the Rack level rests: remember x0 and s0 = rackRowScroll.offset
//   - pointermove: once |dx| > 6 CSS px it is a scroll, not a tap: setDragging(true),
//     scrollTo(s0 - dxCss / rackRowScroll.scale)   (the rack's rest art scale; it can be below the shell's N)
//   - wheel (desktop): setDragging(true), scrollBy((deltaX || deltaY) / scale), setDragging(false)
//     once the wheel goes quiet (about 150 ms)
//   - pointerup / cancel: setDragging(false). Ending a gesture snaps the row to the rack pitch (A06):
//     a rack's left edge meets the view's left edge, and the camera eases there in 0.15 s.
//     release(velocity) does the same and first carries a flick (art px/s) 0.15 s on.
//   - a tap on a darkened rack (HitTarget kind 'unit', `drill` = that rack): call holdView(), then
//     set the focus to `drill`. It becomes active where it stands, then eases to the framed rest.
// Any other change of focus rack (Room → Rack, a jump) resets the offset to 0, the active rack
// framed. Offsets are whole steps, clamped so the row's first and last racks stop at the view edges.
import type { RackId, RackSlotView, RackSnapshot } from '../../../game';
import type { RestArea } from '../../core';
import { FOCUS, ROW_COLS, ROW_PITCH, colX } from './layout';

/** The rack's room slot (row-major). */
export function rowSlot(s: RackSnapshot): number {
  return s.slot >= 0 ? s.slot : 0;
}
/** The rack's column in its row: where it stands, 0..ROW_COLS - 1. */
export const rackCol = (s: RackSnapshot): number => rowSlot(s) % ROW_COLS;
/** The row's slot views in column order, or null for an empty row. */
export function rowViews(s: RackSnapshot): readonly RackSlotView[] | null {
  return s.row.length > 0 ? s.row : null;
}
/** True when column c holds a built rack other than the active one. */
export function isNeighbour(s: RackSnapshot, c: number): boolean {
  const v = rowViews(s)?.[c];
  return !!v && v.rackId !== null && c !== rackCol(s) && v.rackId !== s.rackId;
}

export interface Span { lo: number; hi: number }
/** First and last built columns of the row, the active rack included. */
export function builtSpan(s: RackSnapshot, out: Span): Span {
  const col = rackCol(s), row = rowViews(s);
  out.lo = col; out.hi = col;
  if (row) for (let c = 0; c < Math.min(ROW_COLS, row.length); c++) {
    if (row[c].rackId === null && c !== col) continue;
    if (c < out.lo) out.lo = c;
    if (c > out.hi) out.hi = c;
  }
  return out;
}
const span: Span = { lo: 0, hi: 0 };
/**
 * Clamp a scroll offset (art px from the active rack's centred view) to whole `step`s. Without a view
 * width: from the first built rack to the last one centred. With `viewW` (art px): the row's first
 * rack stops at the view's left edge and its last at the right edge (A06); a row narrower than the
 * view is centred.
 */
export function clampScroll(s: RackSnapshot, offset: number, step = 1, viewW = 0): number {
  builtSpan(s, span);
  const col = rackCol(s), v = Number.isFinite(offset) ? Math.round(offset / step) * step : 0;
  if (!(viewW > 0)) return Math.max((span.lo - col) * ROW_PITCH, Math.min((span.hi - col) * ROW_PITCH, v));
  const c0 = colX(col) + FOCUS.x + FOCUS.w / 2, left = colX(span.lo) + FOCUS.x, right = colX(span.hi) + FOCUS.x + FOCUS.w;
  if (right - left <= viewW) return Math.round(((left + right) / 2 - c0) / step) * step;
  const lo = Math.ceil((left + viewW / 2 - c0) / step) * step, hi = Math.floor((right - viewW / 2 - c0) / step) * step;
  return lo > hi ? Math.round((lo + hi) / 2 / step) * step : Math.max(lo, Math.min(hi, v));
}
/** The offset nearest `offset` at which a rack's left edge meets the view's left edge. */
export function snapScroll(offset: number, viewW: number): number {
  // Rack k's left edge sits at the view's left edge when offset = colX(k - col) + viewW / 2 - FOCUS.w / 2.
  const base = viewW > 0 ? viewW / 2 - FOCUS.w / 2 : 0;
  return base + Math.round((offset - base) / ROW_PITCH) * ROW_PITCH;
}
/**
 * The rack's rest art scale in `area`: the shell's N, or lower when the cabinet doesn't fit whole (A05), but
 * never below the core's fixed rest minimum of 2 (frameRest): where even 2 crops the cabinet (a 320 px phone,
 * a short landscape) the core pans the cabinet at 2, so the row's view width and drag scale must be read at 2.
 */
export function rackScale(area: RestArea): number {
  const min = Math.min(2, area.scale);
  let n = area.scale;
  while (n > min && (FOCUS.w * n > area.w || FOCUS.h * n > area.h)) n--;
  return n;
}

export interface RackRowScroll {
  /** Art px from the active rack's centred view; positive looks toward higher columns. */
  readonly offset: number;
  /** True while the UI reports a drag or wheel gesture (the camera follows, not eases). */
  readonly dragging: boolean;
  /** The rack's rest art scale, CSS px per art px: divide drag CSS px by it. */
  readonly scale: number;
  /** Move the view by `dxArt` art px. Returns the clamped offset. */
  scrollBy(dxArt: number): number;
  /** Set the offset in art px. Returns the clamped offset. */
  scrollTo(offsetArt: number): number;
  /** Scroll steps in art px: the lattice over N (8 desktop, 4 phone). */
  setStep(artPx: number): void;
  /** Turning it off ends the gesture: the row snaps to the rack pitch. */
  setDragging(on: boolean): void;
  /** End a gesture with a flick: carry `velocity` (art px/s) 0.15 s on, then snap. Returns the offset. */
  release(velocity?: number): number;
  /** Call before focusing a tapped neighbour: it becomes active where it stands, then settles. */
  holdView(): void;
  /** Frame the active rack again. */
  reset(): void;
}

export interface ScrollState extends RackRowScroll {
  /** The renderer applies the offset to the focus snapshot: re-bases on a new rack, clamps to its row. */
  apply(s: RackSnapshot, area?: RestArea): number;
}
export function createRowScroll(): ScrollState {
  let offset = 0, step = 8, dragging = false, hold = false, settle = false, rack: RackId | null = null, slot = -1;
  let last: RackSnapshot | null = null, viewW = 0, scale = 1;
  const clamp = (v: number): number => (last ? clampScroll(last, v, step, viewW) : 0);
  const snap = (v: number): number => (last ? clamp(snapScroll(v, viewW)) : 0);
  return {
    get offset() { return offset; },
    get dragging() { return dragging; },
    get scale() { return scale; },
    scrollBy(dx) { offset = clamp(offset + dx); return offset; },
    scrollTo(v) { offset = clamp(v); return offset; },
    setStep(v) { if (v > 0 && Number.isFinite(v)) step = Math.round(v); },
    setDragging(on) {
      if (dragging && !on) offset = snap(offset);
      if (on) settle = false;
      dragging = on;
    },
    release(velocity = 0) { dragging = false; offset = snap(offset + (Number.isFinite(velocity) ? velocity * 0.15 : 0)); return offset; },
    holdView() { hold = true; },
    reset() { offset = 0; hold = false; settle = false; },
    apply(s, area) {
      if (area) { scale = rackScale(area); viewW = area.w / scale; }
      if (s.rackId !== rack) {
        const next = rowSlot(s), sameRow = slot >= 0 && Math.floor(slot / ROW_COLS) === Math.floor(next / ROW_COLS);
        // A tapped neighbour: for one frame the offset absorbs the column change, so the camera
        // doesn't jump; the next frame settles it to the new active rack's framed rest, and the camera eases.
        settle = hold && sameRow;
        offset = settle ? offset + ((slot % ROW_COLS) - (next % ROW_COLS)) * ROW_PITCH : 0;
        rack = s.rackId; slot = next; dragging = false; hold = false;
      } else if (settle && !dragging) { settle = false; offset = 0; }
      last = s; offset = clampScroll(s, offset, step, viewW);
      return offset;
    },
  };
}
/** The one row scroll the game's rack renderer reads. */
export const rackRowScroll: ScrollState = createRowScroll();
