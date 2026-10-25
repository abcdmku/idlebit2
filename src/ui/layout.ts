// L2 "Control deck" geometry (the approved L2 mockup's layout.js, D15–D17).
// Every rect is CSS px relative to the stage. Two grids, one rule: text and boxes sit on the 8 px
// grid; art sits on N (one art px). Boxes the art fills snap to lcm(8, N). Geometry depends only on
// the viewport, never on game state, so controls never move.
//
// Desktop (N = 3, cell 24; N = 2, cell 16, below 1440 × 888):
//   band (HUD, ladder) and queue strip (head + next 4) overlay the world's top edge;
//   deck: bay 1 = the "now" card (head task, Dismiss) over Buy; bay 2 = build rows over Research.
// Phone (N = 2, 8 px): world (band + strip on top) / now card + Dismiss / Build · Research · Buy.
// The bottom-right thumb zone holds Buy, Research and Dismiss.
import type { Rect } from '../render/core';

export interface SafeInsets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
export const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

interface Common {
  /** Art scale: CSS px per art px. */
  readonly N: 2 | 3;
  /** The lattice lcm(8, N) and the gutter. */
  readonly lat: number;
  readonly gutter: number;
  /** Stage origin in the viewport (centred inside the safe area) and its size. */
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  /** One body text size and its line height (D2.1); `big` is Credits, `mid` is Data. */
  readonly body: number; readonly lh: number; readonly big: number; readonly mid: number;
  /** The world: the band and strip overlay its top edge. */
  readonly world: Rect;
  /** The free world below the strip: the renderer frames its focus here. */
  readonly view: Rect;
  readonly band: Rect;
  readonly strip: Rect;
  readonly headSlot: Rect;
  /** Second to fifth in line. */
  readonly cards: readonly [Rect, Rect, Rect, Rect];
  /** The "now" card: the head task and its Dismiss. */
  readonly now: Rect;
  readonly dismiss: Rect;
  readonly buy: Rect;
  readonly research: Rect;
  /** The research drawer (desktop) or sheet (phone), over the world. */
  readonly drawer: Rect;
  /** Ladder rungs: the 16 × 16 art icon at N, centred; phone rungs are 48 px tap targets. */
  readonly rungs: readonly [Rect, Rect, Rect, Rect, Rect];
  /** The ladder row's height (the band's first row). */
  readonly rungRow: number;
  /** The level name, right of the ladder. */
  readonly rungLabel: Rect;
  /** Data and Credits share a row; the coin sits at `creditX`. */
  readonly creditsRow: Rect;
  readonly creditX: number;
  readonly slaRight: number;
  /** The pipe leaves the strip under the head's icon, drops to `pipeRunY`, then runs to the level's entry. */
  readonly pipeSrc: { readonly x: number; readonly y: number };
  readonly pipeRunY: number;
  /** Where a callout may sit: the free world inset by one lattice step. */
  readonly calloutBounds: Rect;
  /** Callout size. */
  readonly callout: { readonly w: number; readonly h: number };
}
export interface DesktopLayout extends Common {
  readonly kind: 'desktop';
  readonly rows: readonly [Rect, Rect, Rect, Rect, Rect];
}
export interface PhoneLayout extends Common {
  readonly kind: 'phone';
  /** Opens the build sheet. */
  readonly build: Rect;
}
export type ShellLayout = DesktopLayout | PhoneLayout;

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const inset = (a: Rect, d: number): Rect => r(a.x + d, a.y + d, a.w - 2 * d, a.h - 2 * d);

/** Desktop needs 60 cells across (margin, bays 29 | 28, gutter, margin) and 37 down. */
const DESKTOP_COLS = 60, DESKTOP_ROWS = 37;

export function shellLayout(vw: number, vh: number, safe: SafeInsets = NO_INSETS): ShellLayout {
  const aw = Math.max(0, vw - safe.left - safe.right), ah = Math.max(0, vh - safe.top - safe.bottom);
  for (const N of [3, 2] as const) {
    const cell = 8 * N;
    if (Math.floor(aw / cell) >= DESKTOP_COLS && Math.floor(ah / cell) >= DESKTOP_ROWS) return desktop(N, aw, ah, safe);
  }
  return phone(aw, ah, safe);
}

function rungs(band: Rect, rz: number, step: number): ShellLayout['rungs'] {
  const at = (i: number) => r(band.x + step + i * rz, band.y, rz, rz);
  return [at(0), at(1), at(2), at(3), at(4)];
}

function desktop(N: 2 | 3, aw: number, ah: number, safe: SafeInsets): DesktopLayout {
  const U = 8 * N, lat = U;
  const W = Math.floor(aw / U) * U, H = Math.floor(ah / U) * U;
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top + Math.floor((ah - H) / 2);
  const body = N === 3 ? 16 : 13, lh = N === 3 ? 24 : 16;
  const deckY = H - U - 7 * U;
  const world = r(U, U, W - 2 * U, deckY - 2 * U);
  const band = r(U, U, world.w, 2 * U);
  const strip = r(U, band.y + band.h, world.w, 2 * U);
  const headSlot = r(U, strip.y, 10 * U, 2 * U);
  const card = (i: number) => r(headSlot.x + headSlot.w + i * 12 * U, strip.y, 12 * U, 2 * U);
  const top = strip.y + strip.h;
  const b1 = r(U, deckY, 29 * U, 7 * U), b2 = r(b1.x + b1.w + U, deckY, world.w - b1.w - U, 7 * U);
  const now = r(b1.x, b1.y, b1.w, 5 * U);
  const row = (i: number) => r(b2.x, b2.y + i * U, b2.w, U);
  const view = r(world.x, top, world.w, world.y + world.h - top);
  const band0 = rungs(band, 16 * N, U);
  return {
    kind: 'desktop', N, lat, gutter: U, x, y, w: W, h: H, body, lh, big: N === 3 ? 32 : 24, mid: N === 3 ? 24 : 16,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w - U - 4 * U, now.y + U, 4 * U, 2 * U),
    buy: r(b1.x, b1.y + 5 * U, b1.w, 2 * U),
    rows: [row(0), row(1), row(2), row(3), row(4)],
    research: r(b2.x, b2.y + 5 * U, b2.w, 2 * U),
    drawer: r(b2.x, top, b2.w, view.h),
    rungs: band0, rungRow: band.h, rungLabel: r(band0[4].x + band0[4].w + 16, band.y, 8 * U, band.h),
    creditsRow: r(band.x, band.y, band.w, band.h), creditX: W / 2, slaRight: band.x + band.w - U,
    pipeSrc: { x: headSlot.x + U + 8 * N, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: N === 3 ? { w: 288, h: 96 } : { w: 200, h: 104 },
  };
}

function phone(aw: number, ah: number, safe: SafeInsets): PhoneLayout {
  const N = 2, U = 8, lat = 8;
  const W = Math.floor(Math.min(aw, 440) / U) * U, H = Math.max(480, Math.floor(ah / U) * U);
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top;
  const ctrlH = 64, nowH = 80, ctrlY = H - U - ctrlH, nowY = ctrlY - U - nowH;
  const world = r(U, U, W - 2 * U, nowY - 2 * U);
  // The band: the ladder row (48 px rungs, a primary tap) over the Data · Credits row.
  const rungRow = 48, band = r(U, U, world.w, rungRow + 32);
  const strip = r(U, band.y + band.h, world.w, 64);
  const headSlot = r(U, strip.y, 112, 64);
  const card = (i: number) => r(headSlot.x + headSlot.w + i * 64, strip.y, 64, 64);
  const top = strip.y + strip.h;
  const now = r(U, nowY, world.w, nowH);
  const build = r(U, ctrlY, 80, ctrlH), research = r(build.x + build.w + U, ctrlY, 112, ctrlH);
  const buyX = research.x + research.w + U;
  const view = r(world.x, top, world.w, world.y + world.h - top);
  const band0 = rungs(band, rungRow, 0);
  const sheetY = top + 64;
  return {
    kind: 'phone', N, lat, gutter: U, x, y, w: W, h: H, body: 13, lh: 16, big: 24, mid: 16,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w - 16 - 96, now.y + 16, 96, 48),
    build, research, buy: r(buyX, ctrlY, W - U - buyX, ctrlH),
    drawer: r(U, sheetY, world.w, world.y + world.h - sheetY),
    rungs: band0, rungRow, rungLabel: r(band0[4].x + band0[4].w + 8, band.y, 64, rungRow),
    creditsRow: r(band.x, band.y + rungRow, band.w, 32), creditX: W / 2, slaRight: band.x + band.w - U,
    pipeSrc: { x: headSlot.x + 8 + 16, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 200, h: 104 },
  };
}
