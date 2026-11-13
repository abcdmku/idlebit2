// The phone World: a list, because built sites are what the player manages. Built sites come first, in
// region order, each a full tile (header, its halls at 56 CSS px, a zone add pad, its state and links); the
// open regions follow as compact cards (name, climate and power price over the build pad), then the closed
// ones as one plate: the research that opens them, once, over a line each (name, climate). The list takes
// the first arrangement that shows the whole map in the free world: built sites across the full width,
// then (landscape) a built site with an open region beside it, then built sites two a row. Where none
// fits it takes the shortest one and the core pans it from its top, the built sites in view.
import { REGION_IDS } from '../../../game';
import { rect } from '../../core';
import type { Rect } from '../../core';
import { MINI_SIZE } from '../room/mini';
import { HEAD, HUB, HUB_FOOT, LANE_Y, LOCK_HEAD, LOCK_LINE, SEA_BOTTOM, SEA_TOP, SEA_X, SIGN_H, TRUNK_X, WEST } from './plan';
import type { Lines, Path, Plan } from './plan';

/** A hall: 56 × 46 CSS px at 2, a 44 px key with room to read its racks. */
const TILE_W = 28, TILE_GAP = 2;
/** Wider halls, widest first: a list with few sites takes the widest that still shows the whole map in the free world. */
const ROOMY: readonly number[] = [52, 44, 36];
/** The narrowest zone add pad after two halls (the UI's name over price, 80 CSS px). */
const ADD_MIN = 40;
const tileH = (tile: number): number => Math.round(tile * MINI_SIZE.h / MINI_SIZE.w);
const footY = (tile: number): number => 2 + 8 * Math.ceil((SIGN_H + 1 + tileH(tile) + 4) / 8);
/** A built tile narrower than this has no room for its links beside its state: they take a second footer line where the view has the height. */
const LINKS_INLINE = 150;
/** An open region's card: two text lines, then a pad the UI's name over price fits (34 CSS px at least). */
const CARD_TEXT = 18, CARD_H = 38, CARD_PITCH = CARD_H + 2, COL_GAP = 2, BUILT_GAP = 4;
/** The narrowest card (its climate line), a built tile beside a card, and a built tile two a row. */
const CARD_MIN = 63, SIDE_MIN = 112, HALF_MIN = 100, PAD_MAX = 56;
/** The narrowest line of a closed region: its name, then its full climate line. */
const LOCK_MIN = 120;
type Mode = 'full' | 'side' | 'half';
const MODES: readonly Mode[] = ['full', 'side', 'half'];

interface Arranged { readonly cells: Rect[]; readonly lock: Rect | null; readonly h: number; readonly lines: Lines; /** The narrowest built tile. */ readonly tileW: number; /** A hall's width. */ readonly tile: number }
/**
 * Cells for the built sites (`mask` bit i) in `mode`, with `lines` footer lines, then the open regions'
 * cards, then the `closed` regions' lines on their plate; null when the mode has no room for halls `tile` wide.
 */
function arrange(mode: Mode, w: number, mask: number, closed: number, lines: Lines, tile = TILE_W): Arranged | null {
  const inner = w - WEST, cols = Math.max(1, Math.min(4, Math.floor((inner + COL_GAP) / (CARD_MIN + COL_GAP))));
  const cardW = Math.floor((inner - COL_GAP * (cols - 1)) / cols), half = Math.floor((inner - BUILT_GAP) / 2), side = inner - cardW - COL_GAP;
  const built: number[] = [], open: number[] = [], shut: number[] = [];
  for (let i = 0; i < REGION_IDS.length; i++) (mask & (1 << i) ? built : closed & (1 << i) ? shut : open).push(i);
  if ((mode === 'side' && (side < SIDE_MIN || cols < 2)) || (mode === 'half' && (half < HALF_MIN || built.length < 2))) return null;
  // wider halls: three across the full tile, and a zone add pad after two of them
  if (tile > TILE_W && (mode !== 'full' || inner < 4 + 3 * tile + 2 * TILE_GAP || inner - 3 - 2 * (tile + TILE_GAP) < ADD_MIN)) return null;
  const cells: Rect[] = REGION_IDS.map(() => rect()), BUILT_H = footY(tile) + 8 * lines + 2, BUILT_PITCH = BUILT_H + 4;
  let y = HEAD, next = 0, bottom = HEAD;
  const put = (i: number, x: number, cw: number, h: number): void => { cells[i] = rect(x, y, cw, h); bottom = Math.max(bottom, y + h); };
  for (let k = 0; k < built.length; k++) {
    if (mode === 'full') put(built[k]!, WEST, inner, BUILT_H);
    else if (mode === 'side') {
      put(built[k]!, WEST, side, BUILT_H);
      if (next < open.length) put(open[next++]!, WEST + side + COL_GAP, cardW, CARD_H);
    } else {
      put(built[k]!, WEST, half, BUILT_H);
      if (k + 1 < built.length) put(built[++k]!, WEST + half + BUILT_GAP, half, BUILT_H);
      else if (next < open.length) put(open[next++]!, WEST + half + BUILT_GAP, Math.min(cardW, half), CARD_H);
    }
    y += BUILT_PITCH;
  }
  for (let c = 0; next < open.length; next++, c = (c + 1) % cols) {
    put(open[next]!, WEST + c * (cardW + COL_GAP), cardW, CARD_H);
    if (c === cols - 1 || next === open.length - 1) y += CARD_PITCH;
  }
  // the closed regions: one plate, a head line and then a line each (two a row where both fit)
  let lock: Rect | null = null;
  if (shut.length) {
    const n = inner >= 2 * LOCK_MIN ? 2 : 1, lineW = Math.floor(inner / n), rows = Math.ceil(shut.length / n), top = y + LOCK_HEAD + 2;
    lock = rect(WEST, y, inner, LOCK_HEAD + 2 + rows * LOCK_LINE + 2);
    for (let k = 0; k < shut.length; k++) cells[shut[k]!] = rect(WEST + (k % n) * lineW, top + Math.floor(k / n) * LOCK_LINE, lineW, LOCK_LINE);
    bottom = Math.max(bottom, lock.y + lock.h);
  }
  return { cells, lock, h: bottom, lines, tileW: mode === 'full' ? inner : mode === 'side' ? side : half, tile };
}

/** A list shorter than the free world (`h`) is framed with the sea under it: it starts at the top, the hub under the pipe's entry. */
function build(key: string, w: number, h: number, a: Arranged): Plan {
  const cells = a.cells, TILE_H = tileH(a.tile), focusH = Math.max(a.h, h);
  const planeY = cells.map(b => b.y + SIGN_H + 2 + TILE_H + 2);
  // a cell west of the map lands from the trunk; one further east from the lane over its row
  const laneOf = (b: Rect): number => (b.y === HEAD ? LANE_Y : b.y - 2);
  const routes = cells.map((b, i): Path => {
    const y = planeY[i]!, x = b.x - 2;
    return b.x === WEST ? [[TRUNK_X, HUB_FOOT], [TRUNK_X, y], [b.x, y]] : [[TRUNK_X, HUB_FOOT], [TRUNK_X, laneOf(b)], [x, laneOf(b)], [x, y], [b.x, y]];
  });
  const tiles = cells.map(b => [0, 1, 2].map(z => rect(b.x + 3 + z * (a.tile + TILE_GAP), b.y + SIGN_H + 2, a.tile, TILE_H)));
  return {
    key, list: true, lines: a.lines, pitchX: 8, pitchY: 8,
    size: rect(-SEA_X, -SEA_TOP, w + 2 * SEA_X, focusH + SEA_TOP + SEA_BOTTOM), focus: rect(0, 0, w, focusH),
    cells, land: cells.map((_, i) => i), col: cells.map((_, i) => i),
    tiles, tight: tiles, lock: a.lock, legend: null,
    pads: cells.map(b => rect(b.x + 1, b.y + CARD_TEXT, b.w - 2, Math.max(0, b.h - CARD_TEXT - 1))), padMax: PAD_MAX,
    footY: footY(a.tile), hub: rect(HUB.x, HUB.y, HUB.w, HUB.h), laneY: LANE_Y,
    // (only a first-row cell east of the trunk leaves the hub along the header lane)
    trunkX: cells.map(b => (b.x !== WEST && b.y === HEAD ? b.x - 2 : TRUNK_X)),
    planeY, routes,
  };
}

const plans = new Map<string, Plan>();
/** The list for a free world of `w × h` art px, the built sites in `mask` (bit i: region i has a site) and the `closed` regions. */
export function listPlan(w: number, h: number, mask: number, closed = 0): Plan {
  const key = `list:${w}:${h}:${mask}:${closed}`;
  let p = plans.get(key);
  if (p) return p;
  const pick = (mode: Mode, tile: number): Arranged | null => {
    const two = arrange(mode, w, mask, closed, 2, tile);
    return two && two.tileW < LINKS_INLINE && two.h <= h ? two : arrange(mode, w, mask, closed, 1, tile);
  };
  let best: Arranged | null = null;
  if (mask) for (const tile of ROOMY) { const a = pick('full', tile); if (a && a.h <= h) { best = a; break; } }
  if (!best) for (const mode of MODES) {
    const a = pick(mode, TILE_W);
    if (!a) continue;
    if (a.h <= h) { best = a; break; }
    if (!best || a.h < best.h) best = a;
  }
  p = build(key, w, h, best!);
  plans.set(key, p);
  return p;
}
