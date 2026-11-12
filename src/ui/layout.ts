// The fixed market head and horizontally browsable incoming tasks sit above the world.
// A task fact/action card anchors the bottom; the HUD keeps SLA central and currencies at the right.
// Every rect is CSS px relative to the stage. Two grids, one rule: text and boxes sit on the 8 px
// grid; art sits on N (one art px). Boxes the art fills snap to lcm(8, N). Geometry depends only on
// the viewport, never on game state, so controls never move.
//
// Desktop (N = 3, cell 24, from 1200 × 760; N = 2, cell 16, below that):
//   band: ladder | SLA (centre) | Data over Credits (right); the strip; the world;
//   deck: one 64 px row, Settings and Research at the left beside the head card (Details, Dismiss);
//   the 16 px gutter above it carries the notice line.
// Phone (N = 2, 8 px): band, compact market, world, then a task bar and on-demand requirements drawer.
// Landscape (short and wide): the phone's band, market, task card and menu keys in a 352 px left column, one
// 16 px gutter between each; the world takes the full height beside it.
import type { Rect } from '../render/core';

export interface SafeInsets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
export const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
/** Portrait phones use the compact task bar and an on-demand drawer. */
export const hasTaskDock = (L: ShellLayout): boolean => L.kind === 'phone' && L.w < 640;

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
  /** The world: the band and strip overlay its top edge (landscape: the world stands clear, beside them). */
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
  /** The head task's card or compact bar, and its Dismiss (Return between rounds). */
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
  /** SLA, round task count, next reward milestone and reward key: the HUD's centre. */
  readonly sla: Rect;
  /** End round, right of the SLA group: reserved in every phase, so nothing moves. */
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
/** Landscape: the left column's width, and its task card (needs, state and the 48 px action row in 8 px of padding). */
const LANDSCAPE_COLUMN_W = 352, LANDSCAPE_TASK_H = 104;

/**
 * The N = 3 desktop from 1200 × 760 (50 × 31 cells of 24); the N = 2 desktop from 960 × 592
 * (60 × 37 cells of 16); below that, the phone.
 */
const DESKTOP3 = { cols: 50, rows: 31 }, DESKTOP2 = { cols: 60, rows: 37 };
/** Desktop: the deck row (48 px keys in 8 px of padding) and the notice gutter between it and the world. */
const DECK_H = 64, DECK_GAP = 16;

export function shellLayout(vw: number, vh: number, safe: SafeInsets = NO_INSETS): ShellLayout {
  const aw = Math.max(0, vw - safe.left - safe.right), ah = Math.max(0, vh - safe.top - safe.bottom);
  for (const [N, min] of [[3, DESKTOP3], [2, DESKTOP2]] as const) {
    const cell = 8 * N;
    if (Math.floor(aw / cell) >= min.cols && Math.floor(ah / cell) >= min.rows) return desktop(N, aw, ah, safe);
  }
  if (aw >= 640 && ah < 480) return landscape(aw, ah, safe);
  return phone(aw, ah, safe);
}

/** Notices: the gutter above the desktop deck, just above the compact phone bar, or the landscape gutter between the card and the menu keys. */
export function nowRows(L: ShellLayout): {
  readonly notice: number;
} {
  // Desktop: the line ends on the deck's top edge and stays on the 8 px grid (a 24 px line reaches 8 px over the world's foot).
  return { notice: L.kind === 'desktop' ? -Math.max(DECK_GAP, L.lh) : hasTaskDock(L) ? -24 : L.settings.y - L.now.y - L.lh };
}

/**
 * Short, wide screens: the phone's HUD, market, task card and menu keys stack in a left column, and the world takes
 * the stage's full height beside it, so a CPU rests whole at 2× on an 844 × 390 phone.
 */
function landscape(aw: number, ah: number, safe: SafeInsets): PhoneLayout {
  const U = 8, W = snap8(aw), H = snap8(ah), x = safe.left + Math.floor((aw - W) / 2), y = safe.top;
  // The band, as on a portrait phone: the ladder with Data over Credits, then SLA and End round.
  const rungRow = 48, band = r(U, U, LANDSCAPE_COLUMN_W, rungRow + 48), band0 = rungs(band, rungRow, 0);
  const walletX = band0[4].x + band0[4].w + 8, endW = 64;
  // The column's four groups (band, market, task card, menu keys) stand one 16 px gutter apart; the gutter under the
  // card carries the notice line. A screen too short for that closes up to 8 px and sets the market on the band.
  const roomy = H >= 368, gap = roomy ? 16 : U;
  // The market keeps its two-line cards while the column has the height; a shorter screen gets the compact strip.
  const stripH = H >= 384 ? 72 : 48, cardW = stripH > 48 ? band.w / 2 : 200;
  const strip = r(U, band.y + band.h + (roomy ? gap : 0), band.w, stripH), headSlot = r(U, strip.y, stripH > 48 ? band.w / 2 : 160, stripH);
  const card = (i: number) => r(headSlot.x + headSlot.w + i * cardW, strip.y, cardW, stripH);
  // The menu keys sit on the bottom edge and the task card on them; a taller screen leaves the slack under the strip.
  const menu = r(U, H - U - KEY_H, band.w, KEY_H), below = strip.y + strip.h + gap;
  const nowH = Math.max(0, Math.min(LANDSCAPE_TASK_H, menu.y - gap - below)), now = r(U, menu.y - gap - nowH, band.w, nowH);
  const view = r(band.x + band.w + U, 0, W - band.x - band.w - U, H);
  return { kind: 'phone', N: 2, lat: 8, gutter: 8, x, y, w: W, h: H, body: 13, lh: 16, big: 24, mid: 18,
    world: view, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w / 2 + 4, now.y + 48, now.w / 2 - 12, KEY_H), ...menuKeys(menu),
    lab: r(view.x + U, U, view.w - 2 * U, H - 2 * U),
    rungs: band0, rungRow, rungLabel: r(walletX, band.y, 0, rungRow),
    sla: r(band.x, band.y + rungRow, band.w - endW - U, 48), endKey: r(band.x + band.w - endW, band.y + rungRow, endW, 48),
    wallet: r(walletX, band.y, band.x + band.w - walletX, rungRow),
    // The pipe leaves the strip's right end, climbs the world's left edge and runs along its top into the entry.
    pipeSrc: { x: view.x, y: strip.y + strip.h / 2 }, pipeRunY: 4,
    calloutBounds: inset(view, 8), callout: { w: Math.min(288, view.w - 16), h: 104 } };
}

function rungs(band: Rect, rz: number, step: number, h = rz): ShellLayout['rungs'] {
  const at = (i: number) => r(band.x + step + i * rz, band.y, rz, h);
  return [at(0), at(1), at(2), at(3), at(4)];
}

/** Landscape: Settings keeps its own square touch target; Research takes the rest of the row. */
function menuKeys(area: Rect): Pick<ShellLayout, 'research' | 'settings'> {
  return { settings: r(area.x, area.y, area.h, area.h), research: r(area.x + area.h + 8, area.y, area.w - area.h - 8, area.h) };
}

function desktop(N: 2 | 3, aw: number, ah: number, safe: SafeInsets): DesktopLayout {
  const U = 8 * N, lat = U;
  const W = Math.floor(aw / U) * U, H = Math.floor(ah / U) * U;
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top + Math.floor((ah - H) / 2);
  const body = N === 3 ? 16 : 13, lh = N === 3 ? 24 : 16;
  // The deck is only as tall as its keys; the world takes the rest and still ends on the lattice.
  const deckH = DECK_H, deckY = H - DECK_GAP - deckH;
  const world = r(U, U, W - 2 * U, deckY - DECK_GAP - U);
  // The band's keys (ladder rungs, Rewards, End round) are 48 px at either scale: a small window still gets full touch targets.
  const band = r(U, U, world.w, 48);
  const strip = r(U, band.y + band.h, world.w, N === 3 ? 3 * U : 4 * U);
  // Incoming cards retain readable names; a partial next card makes the horizontal browsing visible.
  const headW = N === 3 ? 11 * U : 14 * U, cardW = N === 3 ? 11 * U : 13 * U;
  const headSlot = r(U, strip.y, headW, strip.h);
  const card = (i: number) => r(headSlot.x + headW + i * cardW, strip.y, cardW, strip.h);
  const top = strip.y + strip.h;
  // The deck: one row, Settings and Research at the left, then the head card.
  const settings = r(world.x, deckY, deckH, deckH), research = r(settings.x + settings.w + 8, deckY, N === 3 ? 168 : 136, deckH);
  const now = r(research.x + research.w + 8, deckY, world.x + world.w - research.x - research.w - 8, deckH);
  const actionW = N === 3 ? 112 : 96;
  const view = r(world.x, top, world.w, world.y + world.h - top);
  // The band: the ladder at the left, the currencies stacked at the right, SLA centred between them.
  // At 2× the 48 px rungs start on the band's edge, and a window under 1024 px also trims the wallet and End round,
  // so the SLA group keeps its Tasks count and Rewards key down to the 960 px minimum.
  const tight = N === 2 && W < 1024;
  const band0 = rungs(band, 48, N === 3 ? U : 0);
  const rungLabel = r(band0[4].x + band0[4].w + (N === 3 ? 16 : 8), band.y, N === 3 ? 152 : 112, band.h);
  const walletW = N === 3 ? 184 : tight ? 136 : 152, wallet = r(band.x + band.w - (N === 3 ? U : 8) - walletW, band.y, walletW, band.h);
  // SLA and End round as one block, centred between the level name and the wallet.
  const keyW = N === 3 ? 112 : tight ? 88 : 96, free0 = rungLabel.x + rungLabel.w + 8, free1 = wallet.x - 8;
  const slaW = snap8(Math.min(N === 3 ? 480 : 368, free1 - free0 - keyW - 8));
  const sla = r(snap8(free0 + (free1 - free0 - slaW - 8 - keyW) / 2), band.y, slaW, band.h), endKey = r(sla.x + slaW + 8, band.y, keyW, band.h);
  return {
    kind: 'desktop', N, lat, gutter: U, x, y, w: W, h: H, body, lh, big: N === 3 ? 32 : 24, mid: N === 3 ? 20 : 16,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w - 8 - actionW, now.y + (deckH - KEY_H) / 2, actionW, KEY_H),
    research, settings, lab: r(world.x, top, world.w, H - DECK_GAP - top),
    rungs: band0, rungRow: band.h, rungLabel, sla, endKey, wallet,
    // The run sits 4 art px under the strip: the pipe and its half-width fit one lattice step of top gutter.
    pipeSrc: { x: headSlot.x + lat + 8 * N, y: top }, pipeRunY: top + 4 * N,
    // Plates and callouts: a lattice step in from the sides, 8 px under the strip, down to the notice gutter.
    calloutBounds: r(view.x + lat, view.y + 8, view.w - 2 * lat, view.h - 8), callout: { w: 288, h: N === 3 ? 144 : 112 },
  };
}

function phone(aw: number, ah: number, safe: SafeInsets): PhoneLayout {
  const N = 2, U = 8, lat = 8;
  const W = Math.floor(Math.min(aw, 440) / U) * U, H = Math.max(320, Math.floor(ah / U) * U);
  const x = safe.left + Math.floor((aw - W) / 2), y = safe.top;
  const nowH = 56, nowY = H - U - nowH;
  const world = r(U, U, W - 2 * U, nowY - 2 * U);
  // The band: the ladder row (48 px rungs, a primary tap) with Data over Credits at its right, then SLA and End round.
  const rungRow = 48, band = r(U, U, world.w, rungRow + 48);
  // A 320 px phone narrows the rungs to the 44 px touch minimum inside a ladder box that stays on the 8 px grid
  // (224 px). The wallet runs from the ladder to the band's edge at every width: its figures end on End round's edge.
  const slim = W < 360, band0 = rungs(band, slim ? 44 : rungRow, 0, rungRow);
  const walletX = slim ? band.x + 224 : band0[4].x + band0[4].w + 8;
  // The head is fixed; incoming cards retain their width and scroll through the remaining strip.
  const strip = r(U, band.y + band.h, world.w, 48);
  const headSlot = r(U, strip.y, W < 360 ? 160 : 176, 48);
  const cardW = 200;
  const card = (i: number) => r(headSlot.x + headSlot.w + i * cardW, strip.y, cardW, 48);
  const top = strip.y + strip.h;
  // Compact keys leave room for inline task count and milestone without adding a HUD row.
  const endW = W < 360 ? 48 : 64, hudGap = 8;
  // Settings, Research, labelled resources/wait, then Dismiss; all controls keep their boxes.
  const now = r(U, nowY, world.w, nowH);
  const settings = r(now.x, nowY, 48, nowH), research = r(now.x + 56, nowY, 48, nowH);
  const view = r(world.x, top, world.w, world.y + world.h - top);
  return {
    kind: 'phone', N, lat, gutter: U, x, y, w: W, h: H, body: 13, lh: 16, big: 24, mid: 18,
    world, view, band, strip, headSlot, cards: [card(0), card(1), card(2), card(3)],
    now, dismiss: r(now.x + now.w - 64, now.y, 64, nowH),
    research, settings, lab: r(U, H < 640 ? band.y + band.h : top, world.w, H - U - (H < 640 ? band.y + band.h : top)),
    rungs: band0, rungRow, rungLabel: r(walletX, band.y, 0, rungRow),
    sla: r(band.x, band.y + rungRow, band.w - endW - hudGap, 48), endKey: r(band.x + band.w - endW, band.y + rungRow, endW, 48), wallet: r(walletX, band.y, band.x + band.w - walletX, rungRow),
    pipeSrc: { x: headSlot.x + 8 + 16, y: top }, pipeRunY: top + U,
    calloutBounds: inset(view, lat), callout: { w: 288, h: 104 },
  };
}
