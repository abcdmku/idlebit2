// L2 "Control deck" geometry (the approved L2 mockup's layout.js, D15–D17), with the user's 25 Oct
// return to the first release: the queue strip on top (5 cards, head first), the head task's big
// card at the bottom above the deck, SLA in the HUD's centre and the currencies stacked top right.
// Every rect is CSS px relative to the stage. Two grids, one rule: text and boxes sit on the 8 px
// grid; art sits on N (one art px). Boxes the art fills snap to lcm(8, N). Geometry depends only on
// the viewport, never on game state, so controls never move.
//
// Desktop (N = 3, cell 24, from 1200 × 760; N = 2, cell 16, below that):
//   band: ladder | SLA (centre) | Data over Credits (right); the strip; the world;
//   deck: bay 1 = the head card (Dismiss) over Buy; bay 2 = build rows over Research.
// Phone (N = 2, 8 px): band (ladder and the stacked currencies, then SLA), the strip, the world,
//   the head card full width, then Build · Research · Buy. Buy and Research keep the thumb zone.
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
  /** One body text size and its line height (D2.1); `big` is the SLA figure, `mid` the stacked currencies. */
  readonly body: number; readonly lh: number; readonly big: number; readonly mid: number;
  /** The world: the band and strip overlay its top edge. */
  readonly world: Rect;
  /** The free world below the strip: the renderer frames its focus here. */
  readonly view: Rect;
  readonly band: Rect;
  /** The whole queue strip: tasks slide inside it. */
  readonly strip: Rect;
  /** The head's place in the strip (first of five). */
  readonly headSlot: Rect;
  /** Second to fifth in line, front first. */
  readonly cards: readonly [Rect, Rect, Rect, Rect];
  /** The head task's big card above the deck, and its Dismiss (Return to market between rounds). */
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
  /** The level name, right of the ladder (desktop). */
  readonly rungLabel: Rect;
  /** SLA, its 80% meter and the round clock: the HUD's centre. */
  readonly sla: Rect;
  /** Data over Credits, right-aligned. */
  readonly wallet: Rect;
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
  /** The build list: five rows, one cell each and never under 24 px. */
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
const snap8 = (v: number) => Math.floor(v / 8) * 8;
/** Keys are at least 44 px tall (touch) on every layout. */
const KEY_W = 96, KEY_H = 48;

/**
 * The N = 3 desktop from 1200 × 760 (50 × 31 cells of 24); the N = 2 desktop from 960 × 592
 * (60 × 37 cells of 16); below that, the phone.
 */
const DESKTOP3 = { cols: 50, rows: 31 }, DESKTOP2 = { cols: 60, rows: 37 };
/** Build rows are never shorter than this (a mouse target), at any size. */
const ROW_MIN = 24;

export function shellLayout(vw: number, vh: number, safe: SafeInsets = NO_INSETS): ShellLayout {
  const aw = Math.max(0, vw - safe.left - safe.right), ah = Math.max(0, vh - safe.top - safe.bottom);
  for (const [N, min] of [[3, DESKTOP3], [2, DESKTOP2]] as const) {
    const cell = 8 * N;
    if (Math.floor(aw / cell) >= min.cols && Math.floor(ah / cell) >= min.rows) return desktop(N, aw, ah, safe);
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
  const rowH = Math.max(U, ROW_MIN), rowsH = 5 * rowH, deckH = rowsH + KEY_H, deckY = H - U - deckH;
  const world = r(U, U, W - 2 * U, deckY - 2 * U);
  const band = r(U, U, world.w, 2 * U);
  const strip = r(U, band.y + band.h, world.w, 2 * U);
  // Five cards, head first: the next 4 share the width on the lattice and the head takes the rest.
  const cardW = Math.floor((world.w - 10 * U) / 4 / U) * U, headW = world.w - 4 * cardW;
  const headSlot = r(U, strip.y, headW, strip.h);
  const card = (i: number) => r(headSlot.x + headW + i * cardW, strip.y, cardW, strip.h);
  const top = strip.y + strip.h;
  // The deck: bay 1 = the head card over Buy; bay 2 = the build rows over Research.
  const b1w = Math.floor((world.w - U) / 2 / U) * U, b2x = world.x + b1w + U, b2w = world.w - b1w - U;
  const now = r(world.x, deckY, b1w, rowsH);
  const row = (i: number) => r(b2x, deckY + i * rowH, b2w, rowH);
  const view = r(world.x, top, world.w, world.y + world.h - top);
  // The band: the ladder at the left, the currencies stacked at the right, SLA centred between them.
  const band0 = rungs(band, 16 * N, U), rungLabel = r(band0[4].x + band0[4].w + 16, band.y, N === 3 ? 128 : 96, band.h);
  const walletW = N === 3 ? 264 : 200, wallet = r(band.x + band.w - U - walletW, band.y, walletW, band.h);
  const free0 = rungLabel.x + rungLabel.w + 8, free1 = wallet.x - 8, slaW = snap8(Math.min(N === 3 ? 480 : 368, free1 - free0));
  const sla = r(snap8(free0 + (free1 - free0 - slaW) / 2), band.y, slaW, band.h);
  return {
    kind: 'desktop', N, lat, gutter: U, x, y, w: W, h: H, body, lh, big: N === 3 ? 32 : 24, mid: N === 3 ? 20 : 16,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    // The head card's key is wide enough for "Return to market" on one line; Dismiss keeps the same box.
    now, dismiss: r(now.x + now.w - lat - 144, now.y + lat, 144, KEY_H),
    buy: r(world.x, deckY + rowsH, b1w, KEY_H), research: r(b2x, deckY + rowsH, b2w, KEY_H),
    rows: [row(0), row(1), row(2), row(3), row(4)],
    drawer: r(b2x, top, b2w, view.h),
    rungs: band0, rungRow: band.h, rungLabel, sla, wallet,
    pipeSrc: { x: headSlot.x + lat + 8 * N, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 288, h: N === 3 ? 144 : 112 },
  };
}

function phone(aw: number, ah: number, safe: SafeInsets): PhoneLayout {
  const N = 2, U = 8, lat = 8;
  const W = Math.floor(Math.min(aw, 440) / U) * U, H = Math.max(480, Math.floor(ah / U) * U);
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top;
  const ctrlH = 64, nowH = 80, ctrlY = H - U - ctrlH, nowY = ctrlY - U - nowH;
  const world = r(U, U, W - 2 * U, nowY - 2 * U);
  // The band: the ladder row (48 px rungs, a primary tap) with Data over Credits at its right, then SLA.
  const rungRow = 48, band = r(U, U, world.w, rungRow + 32);
  const band0 = rungs(band, rungRow, 0), walletX = band0[4].x + band0[4].w + 8;
  // The strip: the head first, then the next 4.
  const strip = r(U, band.y + band.h, world.w, 64);
  const headSlot = r(U, strip.y, 112, 64);
  const cardW = Math.floor((world.w - headSlot.w) / 4 / U) * U;
  const card = (i: number) => r(headSlot.x + headSlot.w + i * cardW, strip.y, i === 3 ? world.w - headSlot.w - 3 * cardW : cardW, 64);
  const top = strip.y + strip.h;
  const now = r(U, nowY, world.w, nowH);
  const build = r(U, ctrlY, 80, ctrlH), research = r(build.x + build.w + U, ctrlY, 112, ctrlH);
  const buyX = research.x + research.w + U;
  const view = r(world.x, top, world.w, world.y + world.h - top);
  const sheetY = top + 64;
  return {
    kind: 'phone', N, lat, gutter: U, x, y, w: W, h: H, body: 13, lh: 16, big: 24, mid: 18,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w - 16 - KEY_W, now.y + 16, KEY_W, KEY_H),
    build, research, buy: r(buyX, ctrlY, W - U - buyX, ctrlH),
    drawer: r(U, sheetY, world.w, world.y + world.h - sheetY),
    rungs: band0, rungRow, rungLabel: r(walletX, band.y, 0, rungRow),
    sla: r(band.x, band.y + rungRow, band.w, 32), wallet: r(walletX, band.y, band.x + band.w - U - walletX, rungRow),
    pipeSrc: { x: headSlot.x + 8 + 16, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 200, h: 104 },
  };
}
