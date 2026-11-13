// World geometry: a plan of the eight regions sized to the free world it is given (the rest area
// in art px). On desktop the map is a grid laid out as the regions sit on the globe, west to east and
// north up: four columns of two (a wide, short world: no empty cell) or three of three (Americas,
// Europe and Africa, Asia-Pacific); narrower views fold it to two columns or one. A cell is a region: a
// header (name, outside air, power price), its site's AZ halls, and a footer for the site's state. On a
// phone the map is a list with the built sites first (list.ts). The scheduler hub sits at the top of the
// west channel, where the pipe enters; backbone cables leave it along the header lane and run down
// the channel west of each column to the site's landing station.
// Every text anchor sits on the 8 art px lattice from the entry, so labels land on the text grid
// at 2 and at 3.
import { REGION_IDS } from '../../../game';
import type { GlobalSnapshot, RegionId, SiteView } from '../../../game';
import { rect } from '../../core';
import type { Rect, RestArea, WorldForm } from '../../core';
import { MINI_SIZE } from '../room/mini';
import { listPlan } from './list';
import { CHANNEL, EAST, HEAD, HUB, HUB_FOOT, LANE_Y, LOCK_HEAD, ROW_GAP, SEA_BOTTOM, SEA_TOP, SEA_X, SIGN_H, SOUTH, TRUNK_X, WEST } from './plan';
import type { Cols, Lines, Path, Plan } from './plan';
export { HEAD, SIGN_H } from './plan';
export type { Path, Plan } from './plan';

/** Region → [column, row] per column count. */
type Grid = Readonly<Record<RegionId, readonly [number, number]>>;
const GRIDS: Readonly<Record<Cols, Grid>> = {
  // both rows run west to east; each column's north region sits over its south one
  4: { 'us-west': [0, 0], 'us-east': [0, 1], 'eu-west': [1, 0], 'sa-east': [1, 1], 'eu-north': [2, 0], 'af-south': [2, 1], 'ap-northeast': [3, 0], 'ap-southeast': [3, 1] },
  3: { 'us-west': [0, 0], 'us-east': [0, 1], 'sa-east': [0, 2], 'eu-north': [1, 0], 'eu-west': [1, 1], 'af-south': [1, 2], 'ap-northeast': [2, 0], 'ap-southeast': [2, 2] },
  2: { 'us-west': [0, 0], 'us-east': [0, 1], 'sa-east': [0, 2], 'af-south': [0, 3], 'eu-north': [1, 0], 'eu-west': [1, 1], 'ap-northeast': [1, 2], 'ap-southeast': [1, 3] },
  1: { 'us-west': [0, 0], 'us-east': [0, 1], 'sa-east': [0, 2], 'eu-north': [0, 3], 'eu-west': [0, 4], 'af-south': [0, 5], 'ap-northeast': [0, 6], 'ap-southeast': [0, 7] },
};
const ROWS = { 1: 8, 2: 4, 3: 3, 4: 2 } as const;
const COLS = [4, 3, 2, 1] as const;
/** Regions on one landmass: neighbours in a column share their ground. */
const LANDMASS: Readonly<Record<RegionId, number>> = {
  'us-west': 0, 'us-east': 0, 'sa-east': 1, 'eu-north': 2, 'eu-west': 2, 'af-south': 3, 'ap-northeast': 4, 'ap-southeast': 5,
};
const CELL_MIN = 72, CELL_MAX = 112, TILE_MAX = 32;
/** CSS px the UI's two-line name and price takes across a zone add pad (desktop, phone type), and the narrowest hall beside it. */
const ADD_W = { desktop: 114, phone: 80 } as const, HALL_MIN = 10;
/** CSS px the closed regions' legend text takes with its inset (desktop type), and the art px of its lock. */
const LEGEND_CSS = 160, LEGEND_LOCK = 12;

const snap8 = (v: number): number => Math.floor(v / 8) * 8;
function build(cols: Cols, cellW: number, lines: Lines, tileMax: number, addW: number, legendW: number): Plan {
  const rows = ROWS[cols], grid = GRIDS[cols];
  const tileW = Math.min(tileMax, Math.floor((cellW - 10) / 3)), tileH = Math.round(tileW * MINI_SIZE.h / MINI_SIZE.w);
  // header plate, halls and data plane, then the footer on the next text line
  const footY = 2 + 8 * Math.ceil((SIGN_H + 1 + tileH + 4) / 8), cellH = footY + 8 * lines + 2;
  const pitchX = cellW + CHANNEL, pitchY = cellH + ROW_GAP;
  const w = WEST + cols * pitchX - CHANNEL + EAST, h = HEAD + rows * pitchY - ROW_GAP + SOUTH;
  const gap = Math.floor((cellW - 6 - 3 * tileW) / 2);
  const trunkX = Array.from({ length: cols }, (_, c) => (c === 0 ? TRUNK_X : WEST + c * pitchX - CHANNEL / 2));
  const cells = REGION_IDS.map(id => rect(WEST + grid[id][0] * pitchX, HEAD + grid[id][1] * pitchY, cellW, cellH));
  const planeY = cells.map(b => b.y + SIGN_H + 2 + tileH + 2);
  const routes = REGION_IDS.map((id, i): Path => {
    const c = grid[id][0], x = trunkX[c]!, y = planeY[i]!, b = cells[i]!;
    return c === 0 ? [[TRUNK_X, HUB_FOOT], [TRUNK_X, y], [b.x, y]] : [[TRUNK_X, HUB_FOOT], [TRUNK_X, LANE_Y], [x, LANE_Y], [x, y], [b.x, y]];
  });
  const top = SIGN_H + 2, tiles = cells.map(b => [0, 1, 2].map(z => rect(b.x + 3 + z * (tileW + gap), b.y + top, tileW, tileH)));
  // (the pad runs from 1 px after the second hall to 1 px inside the cell's east edge)
  const hallW = Math.max(HALL_MIN, Math.floor((cellW - 6 - addW) / 2)), hallH = Math.round(hallW * MINI_SIZE.h / MINI_SIZE.w);
  const tight = cellW - 5 - 2 * tileW - gap >= addW || hallW >= tileW ? tiles : cells.map(b => [
    rect(b.x + 3, b.y + top + tileH - hallH, hallW, hallH), rect(b.x + 4 + hallW, b.y + top + tileH - hallH, hallW, hallH),
    rect(b.x + 5 + 2 * hallW, b.y + top, cellW - 6 - 2 * hallW, tileH),
  ]);
  return {
    key: `${cols}:${cellW}:${lines}:${tileMax}:${addW}:${legendW}`, list: false, lines, pitchX, pitchY,
    size: rect(-SEA_X, -SEA_TOP, w + 2 * SEA_X, h + SEA_TOP + SEA_BOTTOM), focus: rect(0, 0, w, h),
    cells, land: REGION_IDS.map(id => LANDMASS[id]), col: REGION_IDS.map(id => grid[id][0]),
    tiles, tight, lock: null, legend: rect(w - EAST - legendW, LANE_Y - 2 - LOCK_HEAD, legendW, LOCK_HEAD),
    pads: cells.map(b => rect(b.x + 3, b.y + SIGN_H + 2, cellW - 6, cellH - SIGN_H - 5)), padMax: Infinity,
    footY, hub: rect(HUB.x, HUB.y, HUB.w, HUB.h), laneY: LANE_Y,
    trunkX, planeY, routes,
  };
}
const plans = new Map<string, Plan>();
function planOf(cols: Cols, cellW: number, lines: Lines, n: number, addCss: number, tileMax = TILE_MAX): Plan {
  const addW = Math.ceil(addCss / n), legendW = Math.ceil(LEGEND_CSS / n) + LEGEND_LOCK;
  const key = `${cols}:${cellW}:${lines}:${tileMax}:${addW}:${legendW}`;
  let p = plans.get(key);
  if (!p) { p = build(cols, cellW, lines, tileMax, addW, legendW); plans.set(key, p); }
  return p;
}
/** The cell width `cols` columns get in `w` art px (under CELL_MIN: they don't fit). */
const cellWidth = (cols: Cols, w: number): number => Math.min(CELL_MAX + (cols === 1 ? 8 : 0), snap8((w - WEST - EAST - (cols - 1) * CHANNEL) / cols));
const LINES3 = [3, 2, 1] as const, LINES2 = [2, 1] as const;
/** Bit i: region i has a site (`closed`: it has none and is not open yet). */
function regionMask(s: GlobalSnapshot | undefined, closed = false): number {
  let mask = 0;
  if (s) for (let i = 0; i < s.sites.length && i < REGION_IDS.length; i++) {
    const site = s.sites[i]!;
    if (closed ? site.siteId === null && !site.open : site.siteId !== null) mask |= 1 << i;
  }
  return mask;
}
/**
 * The plan for a free world of `area` (CSS px at the shell's N). Phone: the list of `s`'s built sites
 * and open regions (list.ts), at 2. Desktop: the whole map at the largest scale that shows it, on the
 * grid with the widest cells, with as many footer lines as its rows leave room for (three only at the
 * desktop type). Where no grid shows it whole at 2, it rests at 2 on the most columns that fit, with
 * one footer line, and pans by rows; its halls are then sized so the window ends part-way down a row,
 * the next region's name in view: there is more below.
 */
export function planFor(area: RestArea | undefined, form: WorldForm | undefined, s?: GlobalSnapshot): Plan {
  const addCss = ADD_W[form === 'phone' ? 'phone' : 'desktop'];
  if (form === 'phone') {
    const n = area ? Math.min(2, area.scale) : 2;
    const built = regionMask(s), closed = regionMask(s, true);
    return area ? listPlan(Math.floor(area.w / n), Math.floor(area.h / n), built, closed) : listPlan(176, 268, built, closed);
  }
  if (!area) return planOf(3, 96, 2, 3, addCss);
  for (let n = area.scale; n >= 2; n--) {
    const w = Math.floor(area.w / n), h = Math.floor(area.h / n);
    let best: Plan | null = null, bestW = 0;
    for (const cols of COLS) {
      const cellW = cellWidth(cols, w);
      if (cellW < CELL_MIN) continue;
      for (const lines of n >= 3 ? LINES3 : LINES2) {
        const p = planOf(cols, cellW, lines, n, addCss);
        if (p.focus.h > h) continue;
        if (!best || cellW > bestW) { best = p; bestW = cellW; }
        break;
      }
    }
    if (best) return best;
  }
  const n = Math.min(2, area.scale), w = Math.floor(area.w / n), h = Math.floor(area.h / n);
  let cols: Cols = 1, cellW = Math.max(CELL_MIN, cellWidth(1, w));
  for (const c of COLS) if (cellWidth(c, w) >= CELL_MIN) { cols = c; cellW = cellWidth(c, w); break; }
  for (let t = TILE_MAX; t >= 24; t -= 2) {
    const p = planOf(cols, cellW, 1, n, addCss, t), peek = (h - HEAD) % p.pitchY;
    if (peek >= 10 && peek <= p.pitchY - 16) return p;
  }
  return planOf(cols, cellW, 1, n, addCss);
}

let current: Plan = planFor(undefined, 'desktop');
/** The plan in use: set by the level's `focus()` each rest frame, read by every other method. */
export const plan = (): Plan => current;
export function usePlan(p: Plan): Plan { current = p; return p; }
/** The tiles of the site in cell i: its halls stand closer while its third zone alone is empty (`Plan.tight`). */
export function tilesOf(p: Plan, i: number, site: SiteView): readonly Rect[] {
  const z = site.zones;
  return z.length >= 3 && z[0]!.roomId !== null && z[1]!.roomId !== null && z[2]!.roomId === null ? p.tight[i]! : p.tiles[i]!;
}
