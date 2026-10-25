// L2 "Control deck" geometry (the approved L2 mockup's layout.js, D15–D17), with the head task at
// the top of the queue strip (user, 25 Oct). Every rect is CSS px relative to the stage. Two grids,
// one rule: text and boxes sit on the 8 px grid; art sits on N (one art px). Boxes the art fills
// snap to lcm(8, N). Geometry depends only on the viewport, never on game state, so controls never move.
//
// Desktop (N = 3, cell 24, from 1200 × 760; N = 2, cell 16, below that):
//   band (HUD, ladder) and the queue strip (the head with its clock and Dismiss, then the next 4)
//   overlay the world's top edge; the deck is one row: build list | Research | Buy.
// Phone (N = 2, 8 px): band, then the strip (the head, then the next 4 under it), the world, and
//   Build · Research · Buy. Buy and Research keep the bottom-right thumb zone.
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
  /** One body text size and its line height (D2.1); `big` is the Credits and Data figures. */
  readonly body: number; readonly lh: number; readonly big: number;
  /** The world: the band and strip overlay its top edge. */
  readonly world: Rect;
  /** The free world below the strip: the renderer frames its focus here. */
  readonly view: Rect;
  readonly band: Rect;
  /** The whole queue strip: tasks slide inside it and leave through its bottom edge. */
  readonly strip: Rect;
  /** The head task: its clock, values and Dismiss. */
  readonly headSlot: Rect;
  /** Second to fifth in line, front first. */
  readonly cards: readonly [Rect, Rect, Rect, Rect];
  /** The head's Dismiss (Return to market between rounds). */
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
/** Keys are at least 44 px tall (touch) on every layout. */
const KEY_W = 96, KEY_H = 48;

/**
 * The N = 3 desktop from 1200 × 760 (50 × 31 cells of 24: band 2, strip 4, deck 5, margins, world);
 * the N = 2 desktop from 960 × 592 (60 × 37 cells of 16); below that, the phone.
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
  const rowH = Math.max(U, ROW_MIN), deckH = 5 * rowH, deckY = H - U - deckH;
  const world = r(U, U, W - 2 * U, deckY - 2 * U);
  const band = r(U, U, world.w, 2 * U);
  const strip = r(U, band.y + band.h, world.w, 4 * U);
  // The head is the widest card; the next 4 share the rest on the lattice and the remainder goes to the head.
  const cardW = Math.floor((world.w - (N === 3 ? 16 : 21) * U) / 4 / U) * U, headW = world.w - 4 * cardW;
  const headSlot = r(U, strip.y, headW, strip.h);
  const card = (i: number) => r(headSlot.x + headW + i * cardW, strip.y, cardW, strip.h);
  const top = strip.y + strip.h;
  // The deck, one row: the build list, then Research and Buy (Buy bottom right, as on phone).
  const keyW = Math.ceil(Math.max(288, (world.w - 2 * U) / 4.5) / U) * U;
  const buy = r(world.x + world.w - keyW, deckY, keyW, deckH), research = r(buy.x - U - keyW, deckY, keyW, deckH);
  const listW = research.x - U - world.x;
  const row = (i: number) => r(world.x, deckY + i * rowH, listW, rowH);
  const view = r(world.x, top, world.w, world.y + world.h - top);
  const drawerW = world.w - 30 * U;
  const band0 = rungs(band, 16 * N, U);
  return {
    kind: 'desktop', N, lat, gutter: U, x, y, w: W, h: H, body, lh, big: N === 3 ? 32 : 24,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    dismiss: r(headSlot.x + headW - lat - KEY_W, strip.y + (strip.h - KEY_H) / 2, KEY_W, KEY_H),
    buy, research, rows: [row(0), row(1), row(2), row(3), row(4)],
    drawer: r(world.x + world.w - drawerW, top, drawerW, view.h),
    rungs: band0, rungRow: band.h, rungLabel: r(band0[4].x + band0[4].w + 16, band.y, 8 * U, band.h),
    creditsRow: r(band.x, band.y, band.w, band.h), creditX: Math.round(W / 16) * 8, slaRight: band.x + band.w - U,
    pipeSrc: { x: headSlot.x + lat + 8 * N, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 288, h: N === 3 ? 144 : 112 },
  };
}

function phone(aw: number, ah: number, safe: SafeInsets): PhoneLayout {
  const N = 2, U = 8, lat = 8;
  const W = Math.floor(Math.min(aw, 440) / U) * U, H = Math.max(480, Math.floor(ah / U) * U);
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top;
  const ctrlH = 64, ctrlY = H - U - ctrlH;
  const world = r(U, U, W - 2 * U, ctrlY - 2 * U);
  // The band: the ladder row (48 px rungs, a primary tap) over the Data · Credits row.
  const rungRow = 48, band = r(U, U, world.w, rungRow + 32);
  // The strip: the head first, under the band, then the next 4 (front card first), which rise into it.
  // The pipe leaves from the left gutter under the strip.
  const cardsH = 48, headH = 64, strip = r(U, band.y + band.h, world.w, headH + cardsH);
  const cardW = Math.floor(world.w / 4 / U) * U, front = world.w - 3 * cardW;
  const card = (i: number) => r(U + (i ? front + (i - 1) * cardW : 0), strip.y + headH, i ? cardW : front, cardsH);
  const headSlot = r(U, strip.y, world.w, headH);
  const top = strip.y + strip.h;
  const build = r(U, ctrlY, 80, ctrlH), research = r(build.x + build.w + U, ctrlY, 112, ctrlH);
  const buyX = research.x + research.w + U;
  const view = r(world.x, top, world.w, world.y + world.h - top);
  const band0 = rungs(band, rungRow, 0);
  const sheetY = top + 64;
  return {
    kind: 'phone', N, lat, gutter: U, x, y, w: W, h: H, body: 13, lh: 16, big: 24,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    dismiss: r(headSlot.x + headSlot.w - U - KEY_W, headSlot.y + U, KEY_W, KEY_H),
    build, research, buy: r(buyX, ctrlY, W - U - buyX, ctrlH),
    drawer: r(U, sheetY, world.w, world.y + world.h - sheetY),
    rungs: band0, rungRow, rungLabel: r(band0[4].x + band0[4].w + 8, band.y, 64, rungRow),
    creditsRow: r(band.x, band.y + rungRow, band.w, 32), creditX: W / 2, slaRight: band.x + band.w - U,
    pipeSrc: { x: headSlot.x + 8 + 16, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 200, h: 104 },
  };
}
