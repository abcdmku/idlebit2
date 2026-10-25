// The rack's room row (D17.2) and the horizontal scroll along it.
//
// Row data: contract request R36 adds `slot` and `row` to RackSnapshot.
// PLACEHOLDER until it lands: a snapshot without them is drawn alone at column 0.
//
// Scroll, for agent U (the UI owns pointer input; L2 README "Rack row"):
//   import { rackRowScroll } from 'src/render/levels/rack' (or this file)
//   - once per layout: rackRowScroll.setStep(lattice / N)   (desktop 24 / 3 = 8, phone 8 / 2 = 4 art px)
//   - pointerdown on the world while the Rack level rests: remember x0 and s0 = rackRowScroll.offset
//   - pointermove: once |dx| > 6 CSS px it is a scroll, not a tap: setDragging(true),
//     scrollTo(s0 - dxCss / N)                              (N = the art scale: 3 desktop, 2 phone)
//   - wheel (desktop): setDragging(true), scrollBy((deltaX || deltaY) / N), setDragging(false)
//     once the wheel goes quiet (about 150 ms)
//   - pointerup / cancel: setDragging(false)
//   - a tap on a darkened rack (HitTarget kind 'unit', `drill` = that rack): call holdView(), then
//     set the focus to `drill`. The new active rack stays where it stands; the camera does not move.
// Any other change of focus rack (Room → Rack, a jump) resets the offset to 0, the active rack
// centred. Offsets are whole steps, clamped from the first built rack to the last one centred.
import type { RackId, RackSlotView, RackSnapshot } from '../../../game';
import { ROW_COLS, ROW_PITCH } from './layout';

type WithRow = RackSnapshot & { readonly slot?: number; readonly row?: readonly RackSlotView[] };

/** The rack's room slot (row-major), or 0 without row data. */
export function rowSlot(s: RackSnapshot): number {
  const slot = (s as WithRow).slot;
  return typeof slot === 'number' && slot >= 0 ? slot : 0;
}
/** The rack's column in its row: where it stands, 0..ROW_COLS - 1. */
export const rackCol = (s: RackSnapshot): number => rowSlot(s) % ROW_COLS;
/** The row's slot views in column order, or null without row data. */
export function rowViews(s: RackSnapshot): readonly RackSlotView[] | null {
  const row = (s as WithRow).row;
  return row && row.length > 0 ? row : null;
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
/** Clamp a scroll offset (art px from the active rack) to whole `step`s, from the first built rack
 * to the last one centred. */
export function clampScroll(s: RackSnapshot, offset: number, step = 1): number {
  builtSpan(s, span);
  const col = rackCol(s), lo = (span.lo - col) * ROW_PITCH, hi = (span.hi - col) * ROW_PITCH;
  const v = Number.isFinite(offset) ? Math.round(offset / step) * step : 0;
  return Math.max(lo, Math.min(hi, v));
}

export interface RackRowScroll {
  /** Art px from the active rack's centred view; positive looks toward higher columns. */
  readonly offset: number;
  /** True while the UI reports a drag or wheel gesture (the camera should follow, not ease). */
  readonly dragging: boolean;
  /** Move the view by `dxArt` art px. Returns the clamped offset. */
  scrollBy(dxArt: number): number;
  /** Set the offset in art px. Returns the clamped offset. */
  scrollTo(offsetArt: number): number;
  /** Scroll steps in art px: the lattice over N (8 desktop, 4 phone). */
  setStep(artPx: number): void;
  setDragging(on: boolean): void;
  /** Call before focusing a tapped neighbour: it becomes active where it stands. */
  holdView(): void;
  /** Centre the active rack again. */
  reset(): void;
}

export interface ScrollState extends RackRowScroll {
  /** The renderer applies the offset to the focus snapshot: re-bases on a new rack, clamps to its row. */
  apply(s: RackSnapshot): number;
}
export function createRowScroll(): ScrollState {
  let offset = 0, step = 8, dragging = false, hold = false, rack: RackId | null = null, slot = -1, last: RackSnapshot | null = null;
  const clamp = (v: number): number => (last ? clampScroll(last, v, step) : 0);
  return {
    get offset() { return offset; },
    get dragging() { return dragging; },
    scrollBy(dx) { offset = clamp(offset + dx); return offset; },
    scrollTo(v) { offset = clamp(v); return offset; },
    setStep(v) { if (v > 0 && Number.isFinite(v)) step = Math.round(v); },
    setDragging(on) { dragging = on; },
    holdView() { hold = true; },
    reset() { offset = 0; hold = false; },
    apply(s) {
      if (s.rackId !== rack) {
        const next = rowSlot(s), sameRow = slot >= 0 && Math.floor(slot / ROW_COLS) === Math.floor(next / ROW_COLS);
        // In place: the camera stays where it is, so the offset absorbs the column change.
        offset = hold && sameRow ? offset + ((slot % ROW_COLS) - (next % ROW_COLS)) * ROW_PITCH : 0;
        rack = s.rackId; slot = next; dragging = false; hold = false;
      }
      last = s; offset = clampScroll(s, offset, step);
      return offset;
    },
  };
}
/** The one row scroll the game's rack renderer reads. */
export const rackRowScroll: ScrollState = createRowScroll();
