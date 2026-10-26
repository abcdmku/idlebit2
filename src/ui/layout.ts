// L2 "Control deck" geometry (the approved L2 mockup's layout.js, D15–D17), with the user's 25 Oct
// return to the first release: the queue strip on top (5 cards, head first), the head task's big
// card at the bottom above the deck, SLA in the HUD's centre and the currencies stacked top right.
// Every rect is CSS px relative to the stage. Two grids, one rule: text and boxes sit on the 8 px
// grid; art sits on N (one art px). Boxes the art fills snap to lcm(8, N). Geometry depends only on
// the viewport, never on game state, so controls never move.
//
// Desktop (N = 3, cell 24, from 1200 × 760; N = 2, cell 16, below that):
//   band: ladder | SLA (centre) | Data over Credits (right); the strip; the world;
//   deck: one row, Research at the left beside the head card (Dismiss).
// Phone (N = 2, 8 px): band (ladder and the stacked currencies, then SLA), the strip, the world, then the
//   same one row: Research beside the head card. Buying is done on the world's parts (user, 26 Oct).
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
  /** The Research tile, left of the head card at its height. */
  readonly research: Rect;
  /** The research screen: below the strip, over the world and the deck (the strip keeps showing the line). */
  readonly lab: Rect;
  /** Ladder rungs: the 16 × 16 art icon at N, centred; phone rungs are 48 px tap targets. */
  readonly rungs: readonly [Rect, Rect, Rect, Rect, Rect];
  /** The ladder row's height (the band's first row). */
  readonly rungRow: number;
  /** The level name, right of the ladder (desktop). */
  readonly rungLabel: Rect;
  /** SLA, its 80% meter and the round clock: the HUD's centre. */
  readonly sla: Rect;
  /** End round, right of the round clock: reserved in every phase, so nothing moves. */
  readonly endKey: Rect;
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
export interface DesktopLayout extends Common { readonly kind: 'desktop' }
export interface PhoneLayout extends Common { readonly kind: 'phone' }
export type ShellLayout = DesktopLayout | PhoneLayout;

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const inset = (a: Rect, d: number): Rect => r(a.x + d, a.y + d, a.w - 2 * d, a.h - 2 * d);
const snap8 = (v: number) => Math.floor(v / 8) * 8;
/** Keys are at least 44 px tall (touch) on every layout. */
const KEY_H = 48;

/**
 * The N = 3 desktop from 1200 × 760 (50 × 31 cells of 24); the N = 2 desktop from 960 × 592
 * (60 × 37 cells of 16); below that, the phone.
 */
const DESKTOP3 = { cols: 50, rows: 31 }, DESKTOP2 = { cols: 60, rows: 37 };
/** The deck row is five text lines of at least 24 px: the head card's three lines, its notice line and padding. */
const LINE_MIN = 24;

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
  const deckH = 5 * Math.max(U, LINE_MIN), deckY = H - U - deckH;
  const world = r(U, U, W - 2 * U, deckY - 2 * U);
  const band = r(U, U, world.w, 2 * U);
  const strip = r(U, band.y + band.h, world.w, 2 * U);
  // Five cards, head first: the head keeps room for the longest name and its state on one line ("Replicated
  // Write restarting"); the next 4 share the rest on the lattice and the head takes what is left over.
  const headMin = N === 3 ? 14 * U : 16 * U, cardW = Math.floor((world.w - headMin) / 4 / U) * U, headW = world.w - 4 * cardW;
  const headSlot = r(U, strip.y, headW, strip.h);
  const card = (i: number) => r(headSlot.x + headW + i * cardW, strip.y, cardW, strip.h);
  const top = strip.y + strip.h;
  // The deck: one row, Research at the left, then the head card.
  const research = r(world.x, deckY, 10 * U, deckH), now = r(research.x + research.w + U, deckY, world.w - research.w - U, deckH);
  const view = r(world.x, top, world.w, world.y + world.h - top);
  // The band: the ladder at the left, the currencies stacked at the right, SLA centred between them.
  const band0 = rungs(band, 16 * N, U), rungLabel = r(band0[4].x + band0[4].w + 16, band.y, N === 3 ? 128 : 96, band.h);
  const walletW = 200, wallet = r(band.x + band.w - U - walletW, band.y, walletW, band.h);
  // SLA and End round as one block, centred between the level name and the wallet.
  const keyW = N === 3 ? 112 : 96, free0 = rungLabel.x + rungLabel.w + 8, free1 = wallet.x - 8;
  const slaW = snap8(Math.min(N === 3 ? 480 : 368, free1 - free0 - keyW - 8));
  const sla = r(snap8(free0 + (free1 - free0 - slaW - 8 - keyW) / 2), band.y, slaW, band.h), endKey = r(sla.x + slaW + 8, band.y, keyW, band.h);
  return {
    kind: 'desktop', N, lat, gutter: U, x, y, w: W, h: H, body, lh, big: N === 3 ? 32 : 24, mid: N === 3 ? 20 : 16,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    // The head card's key is wide enough for "Return to market" on one line; Dismiss keeps the same box.
    now, dismiss: r(now.x + now.w - lat - 144, now.y + lat, 144, KEY_H),
    research, lab: r(world.x, top, world.w, H - U - top),
    rungs: band0, rungRow: band.h, rungLabel, sla, endKey, wallet,
    pipeSrc: { x: headSlot.x + lat + 8 * N, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 288, h: N === 3 ? 144 : 112 },
  };
}

function phone(aw: number, ah: number, safe: SafeInsets): PhoneLayout {
  const N = 2, U = 8, lat = 8;
  const W = Math.floor(Math.min(aw, 440) / U) * U, H = Math.max(480, Math.floor(ah / U) * U);
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top;
  const nowH = 80, nowY = H - U - nowH;
  const world = r(U, U, W - 2 * U, nowY - 2 * U);
  // The band: the ladder row (48 px rungs, a primary tap) with Data over Credits at its right, then SLA and End round.
  const rungRow = 48, band = r(U, U, world.w, rungRow + 48);
  const band0 = rungs(band, rungRow, 0), walletX = band0[4].x + band0[4].w + 8;
  // The strip: the head first, then the next 4.
  const strip = r(U, band.y + band.h, world.w, 64);
  // The head keeps room for the longest task name on its own line ("Replicated Write"); the next 4 share the rest.
  const headSlot = r(U, strip.y, 144, 64);
  const cardW = Math.floor((world.w - headSlot.w) / 4 / U) * U;
  const card = (i: number) => r(headSlot.x + headSlot.w + i * cardW, strip.y, i === 3 ? world.w - headSlot.w - 3 * cardW : cardW, 64);
  const top = strip.y + strip.h;
  // The deck: one row, Research at the left (the thumb), then the head card.
  const research = r(U, nowY, 112, nowH), now = r(research.x + research.w + U, nowY, world.w - research.w - U, nowH);
  const view = r(world.x, top, world.w, world.y + world.h - top);
  return {
    kind: 'phone', N, lat, gutter: U, x, y, w: W, h: H, body: 13, lh: 16, big: 24, mid: 18,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w - 8 - 80, now.y + 16, 80, KEY_H),
    research, lab: r(U, top, world.w, H - U - top),
    rungs: band0, rungRow, rungLabel: r(walletX, band.y, 0, rungRow),
    sla: r(band.x, band.y + rungRow, band.w - 88, 48), endKey: r(band.x + band.w - 80, band.y + rungRow, 80, 48), wallet: r(walletX, band.y, band.x + band.w - U - walletX, rungRow),
    pipeSrc: { x: headSlot.x + 8 + 16, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 288, h: 104 },
  };
}
