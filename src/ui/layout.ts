// The fixed market head and horizontally browsable incoming tasks sit above the world.
// A task fact/action card anchors the bottom; the HUD keeps SLA central and currencies at the right.
// Every rect is CSS px relative to the stage. Two grids, one rule: text and boxes sit on the 8 px
// grid; art sits on N (one art px). Boxes the art fills snap to lcm(8, N). Geometry depends only on
// the viewport, never on game state, so controls never move.
//
// Desktop (N = 3, cell 24, from 1200 × 760; N = 2, cell 16, below that):
//   band: ladder | SLA (centre) | Data over Credits (right); the strip; the world;
//   deck: one row, Research at the left beside the head card (Dismiss).
// Phone (N = 2, 8 px): band, market, world, then a full-width task card with menu keys in its action row.
// Landscape keeps the market and deck in a left column beside the world.
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
  /** The market head's fixed place in the strip. */
  readonly headSlot: Rect;
  /** Incoming card geometry; cards continue horizontally beyond the visible viewport. */
  readonly cards: readonly [Rect, Rect, Rect, Rect];
  /** The head task's big card above the deck, and its Dismiss (Return to market between rounds). */
  readonly now: Rect;
  readonly dismiss: Rect;
  /** Research has a stable reserved key beside the card or inside its action row. */
  readonly research: Rect;
  /** Settings always has its own reserved key beside or below Research. */
  readonly settings: Rect;
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
/** Name/rewards, hardware facts, pickup state, 48px actions, then a reserved platform notice. */
const NOW_PHONE = 160;

/**
 * The N = 3 desktop from 1200 × 760 (50 × 31 cells of 24); the N = 2 desktop from 960 × 592
 * (60 × 37 cells of 16); below that, the phone.
 */
const DESKTOP3 = { cols: 50, rows: 31 }, DESKTOP2 = { cols: 60, rows: 37 };
/** Desktop rows keep at least 24px of vertical rhythm. */
const LINE_MIN = 24;

export function shellLayout(vw: number, vh: number, safe: SafeInsets = NO_INSETS): ShellLayout {
  const aw = Math.max(0, vw - safe.left - safe.right), ah = Math.max(0, vh - safe.top - safe.bottom);
  for (const [N, min] of [[3, DESKTOP3], [2, DESKTOP2]] as const) {
    const cell = 8 * N;
    if (Math.floor(aw / cell) >= min.cols && Math.floor(ah / cell) >= min.rows) return desktop(N, aw, ah, safe);
  }
  if (aw >= 640 && ah < 480) return landscape(aw, ah, safe);
  return phone(aw, ah, safe);
}

/** The platform notice has its own row below task facts and actions in every state. */
export function nowRows(L: ShellLayout): {
  readonly notice: number;
} {
  return { notice: L.now.h - L.lh - 8 };
}

/** Short, wide screens keep the CPU at 2×. Queue and deck share the left column. */
function landscape(aw: number, ah: number, safe: SafeInsets): PhoneLayout {
  const W = snap8(aw), H = snap8(ah), x = safe.left + Math.floor((aw - W) / 2), y = safe.top;
  const band = r(8, 8, W - 16, 48), band0 = rungs(band, 48, 0);
  const wallet = r(W - 128, 8, 112, 48), endKey = r(wallet.x - 88, 8, 80, 48);
  const sla = r(256, 8, endKey.x - 264, 48);
  const headSlot = r(8, 64, 136, 80);
  const card = (i: number) => r(144 + i * 144, 64, 144, 80);
  const research = r(8, H - 56, 288, 48), now = r(8, research.y - 8 - NOW_PHONE, 288, NOW_PHONE);
  const view = r(312, 56, W - 320, H - 56);
  return { kind: 'phone', N: 2, lat: 8, gutter: 8, x, y, w: W, h: H, body: 13, lh: 16, big: 24, mid: 18,
    world: view, view, band, strip: r(8, 64, 288, 80), headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + 148, now.y + 88, 132, 48), ...menuKeys(research), lab: r(8, band.y + band.h, W - 16, H - band.y - band.h - 8),
    rungs: band0, rungRow: 48, rungLabel: r(256, 8, 0, 48), sla, endKey, wallet,
    pipeSrc: { x: headSlot.x + headSlot.w, y: headSlot.y + 24 }, pipeRunY: view.y + 8,
    calloutBounds: inset(view, 8), callout: { w: Math.min(288, view.w - 16), h: 104 } };
}

function rungs(band: Rect, rz: number, step: number): ShellLayout['rungs'] {
  const at = (i: number) => r(band.x + step + i * rz, band.y, rz, rz);
  return [at(0), at(1), at(2), at(3), at(4)];
}

/** Keep the deck's total footprint fixed while giving Settings a separate touch target. */
function menuKeys(area: Rect): Pick<ShellLayout, 'research' | 'settings'> {
  return area.w < 160
    ? { research: r(area.x, area.y, area.w, 48), settings: r(area.x, area.y + 48, area.w, 48) }
    : { research: r(area.x, area.y, area.w - 56, area.h), settings: r(area.x + area.w - 48, area.y, 48, 48) };
}

function desktop(N: 2 | 3, aw: number, ah: number, safe: SafeInsets): DesktopLayout {
  const U = 8 * N, lat = U;
  const W = Math.floor(aw / U) * U, H = Math.floor(ah / U) * U;
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top + Math.floor((ah - H) / 2);
  const body = N === 3 ? 16 : 13, lh = N === 3 ? 24 : 16;
  const deckH = 7 * Math.max(U, LINE_MIN), deckY = H - U - deckH;
  const world = r(U, U, W - 2 * U, deckY - 2 * U);
  const band = r(U, U, world.w, 2 * U);
  const strip = r(U, band.y + band.h, world.w, N === 3 ? 3 * U : 4 * U);
  // Incoming cards retain readable names; a partial next card makes the horizontal browsing visible.
  const headW = N === 3 ? 11 * U : 14 * U, cardW = N === 3 ? 11 * U : 13 * U;
  const headSlot = r(U, strip.y, headW, strip.h);
  const card = (i: number) => r(headSlot.x + headW + i * cardW, strip.y, cardW, strip.h);
  const top = strip.y + strip.h;
  // The deck: one row, Research at the left, then the head card.
  const research = r(world.x, deckY, 10 * U, deckH), now = r(research.x + research.w + U, deckY, world.w - research.w - U, deckH);
  const view = r(world.x, top, world.w, world.y + world.h - top);
  // The band: the ladder at the left, the currencies stacked at the right, SLA centred between them.
  const band0 = rungs(band, 16 * N, U), rungLabel = r(band0[4].x + band0[4].w + 16, band.y, N === 3 ? 152 : 128, band.h);
  const walletW = 200, wallet = r(band.x + band.w - U - walletW, band.y, walletW, band.h);
  // SLA and End round as one block, centred between the level name and the wallet.
  const keyW = N === 3 ? 112 : 96, free0 = rungLabel.x + rungLabel.w + 8, free1 = wallet.x - 8;
  const slaW = snap8(Math.min(N === 3 ? 480 : 368, free1 - free0 - keyW - 8));
  const sla = r(snap8(free0 + (free1 - free0 - slaW - 8 - keyW) / 2), band.y, slaW, band.h), endKey = r(sla.x + slaW + 8, band.y, keyW, band.h);
  return {
    kind: 'desktop', N, lat, gutter: U, x, y, w: W, h: H, body, lh, big: N === 3 ? 32 : 24, mid: N === 3 ? 20 : 16,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w - 128, now.y + 80, 112, KEY_H),
    ...menuKeys(research), lab: r(world.x, top, world.w, H - U - top),
    rungs: band0, rungRow: band.h, rungLabel, sla, endKey, wallet,
    pipeSrc: { x: headSlot.x + lat + 8 * N, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 288, h: N === 3 ? 144 : 112 },
  };
}

function phone(aw: number, ah: number, safe: SafeInsets): PhoneLayout {
  const N = 2, U = 8, lat = 8;
  const W = Math.floor(Math.min(aw, 440) / U) * U, H = Math.max(320, Math.floor(ah / U) * U);
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top;
  const nowH = NOW_PHONE, nowY = H - U - nowH;
  const world = r(U, U, W - 2 * U, nowY - 2 * U);
  // The band: the ladder row (48 px rungs, a primary tap) with Data over Credits at its right, then SLA and End round.
  const rungRow = 48, band = r(U, U, world.w, rungRow + 48);
  const band0 = rungs(band, rungRow, 0), walletX = band0[4].x + band0[4].w + 8;
  // The head is fixed; incoming cards retain their width and scroll through the remaining strip.
  const strip = r(U, band.y + band.h, world.w, 80);
  const headSlot = r(U, strip.y, W < 360 ? 136 : 152, 80);
  const cardW = 144;
  const card = (i: number) => r(headSlot.x + headSlot.w + i * cardW, strip.y, cardW, 80);
  const top = strip.y + strip.h;
  // Full-width facts above a stable row of Research, Settings, Details/fix, and Dismiss.
  const now = r(U, nowY, world.w, nowH), research = r(U + 8, nowY + 88, 72, 48), settings = r(U + 88, nowY + 88, 48, 48);
  const view = r(world.x, top, world.w, world.y + world.h - top);
  return {
    kind: 'phone', N, lat, gutter: U, x, y, w: W, h: H, body: 13, lh: 16, big: 24, mid: 18,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w / 2 + 72, now.y + 88, now.w / 2 - 80, KEY_H),
    research, settings, lab: r(U, H < 640 ? band.y + band.h : top, world.w, H - U - (H < 640 ? band.y + band.h : top)),
    rungs: band0, rungRow, rungLabel: r(walletX, band.y, 0, rungRow),
    sla: r(band.x, band.y + rungRow, band.w - 88, 48), endKey: r(band.x + band.w - 80, band.y + rungRow, 80, 48), wallet: r(walletX, band.y, band.x + band.w - U - walletX, rungRow),
    pipeSrc: { x: headSlot.x + 8 + 16, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 288, h: 104 },
  };
}
