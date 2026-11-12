// Room world (mockup levels/datacenter/layout.js, v3.js): one AZ hall in 3/4 view, racks 15 apart in rows of 8.
// The hall is planned for the free world it rests in (`planFor`, called by the level's `focus()`):
//   wide:   the mockup's hall 1 at 1:1, 176 art px wide. Network rack and UPS bank along the back wall, CRACs at the
//           aisle ends, the signs on a strip above the wall. The rack world (128 × 240) maps onto each 16 × 30 rack at 1/8.
//   short:  three rows in a wide, short view (a landscape phone, a desktop at 3), 226 × 174. The rows stand against
//           the back wall, the UPS bank takes the north-east corner beside them and the signs hang on the wall.
//   narrow: the small phone, 140 wide, three rows in 163. No side aisles: the network rack, two CRACs and the UPS
//           bank line the back wall, and the racks are 22 tall on a 36 px row pitch.
// Each plan's geometry for each row count is built once at import (`geomOf`); `G` is the live one. Read `G` at
// draw time, never at import.
import { MAX_ROWS, RACK_SLOTS_PER_ROW } from '../../../game';
import type { PixelPath, Rect, RestArea } from '../../core';

export const COLS = RACK_SLOTS_PER_ROW;
export const ROWS_MAX = MAX_ROWS;
export const RACK_W = 16, RACK_PITCH = 15;
export const CRAC = { w: 16, z: 24 } as const;
export const BOH = { d: 8, z: 18 } as const;
export const SPINE = { w: 16, d: 8, z: 20 } as const;
export const WALL = { t: 3, z: 22 } as const;
export const HALL_X = 54, WORLD_X = 10, UPS_MAX = 6, ROW_SITE_H = 10;
export const ZONE_LETTERS = 'ABCDEF';
/** CRACs stand in pairs: a pair for every two rows. */
export const pairs = (rows: number): number => Math.ceil(rows / 2);

export type RoomPlan = 'wide' | 'short' | 'narrow';
/** One hall: a plan laid out for a row count. Everything is art px in the room world. */
export interface Geom {
  readonly id: RoomPlan; readonly rows: number;
  /** The hall's outer x and width, its interior's x, width, top (the back wall's foot) and bottom (the front wall). */
  readonly x: number; readonly w: number; readonly ix: number; readonly iw: number; readonly iy: number; readonly ib: number;
  /** Rows: the first rack's x, row 0's ground line, the row pitch, a rack's height and its floor tile's. */
  readonly rowX: number; readonly rowW: number; readonly row0: number; readonly pitch: number; readonly rackH: number; readonly tileH: number;
  /** Rack slot s (row s / 8, column s % 8): where the rack world maps; each row's span. */
  readonly racks: readonly Rect[]; readonly spans: readonly Rect[];
  readonly cracs: readonly Rect[]; readonly cracHits: readonly Rect[];
  /** The network rack's foot, its whole sprite, and the LB display on its front. */
  readonly net: Rect; readonly netRect: Rect; readonly lb: Rect;
  /** The UPS bank: its east end, a cabinet's pitch, width and foot y. Cabinet k of n stands at `upsX(G, k, n)`. */
  readonly upsEnd: number; readonly upsPitch: number; readonly upsW: number; readonly upsY: number;
  /** The fibre trunk's x and top, the gateway and its fibre's x, the busway's x and the utility feed's. */
  readonly trunk: number; readonly trunkY: number; readonly gateway: Rect; readonly gwx: number; readonly busX: number; readonly feedX: number;
  readonly thermo: Rect; readonly sign: Rect; readonly save: { readonly x: number; readonly y: number };
  readonly lamp: { readonly x: number; readonly y: number; readonly w: number }; readonly lampRect: Rect;
  /** The corridor door and the door plus its sign: one zone-switch target. */
  readonly door: Rect; readonly doorHit: Rect;
  /** Phone: where the network rack's port speed sits, and its leader's end. */
  readonly netTag: { readonly x: number; readonly y: number; readonly lx: number; readonly ly: number };
  /** Waiting shards stack here, beside the gateway fibre. */
  readonly wait: { readonly x: number; readonly y: number };
  /** The fibre path a task rides from the gateway to each rack slot: down the trunk, along the row tray. */
  readonly jobPaths: readonly PixelPath[];
  readonly dataPlane: { readonly x0: number; readonly x1: number; readonly y: number };
  readonly worldW: number; readonly worldH: number;
  /** The rest focus, the next row's build site, and the focus that frames it too. */
  readonly focus: Rect; readonly rowSite: Rect; readonly focusSite: Rect;
}
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export const rowYOf = (g: Geom, r: number): number => g.iy + g.row0 + r * g.pitch;   // ground line in front of row r
export const trayYOf = (g: Geom, r: number): number => rowYOf(g, r) - g.rackH + 1;     // fibre tray above the cabinet roofs
export const exhaustYOf = (g: Geom, r: number): number => rowYOf(g, r) - g.rackH - 3;  // hot-aisle containment top
export const upsX = (g: Geom, k: number, n: number): number => g.upsEnd - (n - k) * g.upsPitch;

function build(id: RoomPlan, rows: number): Geom {
  const narrow = id === 'narrow', short = id === 'short', wide = id === 'wide';
  const x = HALL_X, ix = x + WALL.t, rowW = (COLS - 1) * RACK_PITCH + RACK_W;
  // text lines sit on multiples of 4 art px (8 CSS px at 2): the narrow hall's rows, strip and wall tags all do
  const iy = narrow ? 84 : short ? 80 : 86, pitch = narrow ? 36 : 46, rackH = narrow ? 22 : 30, tileH = narrow ? 10 : 11;
  const row0 = wide ? 46 : 34, rowX = ix + (narrow ? 7 : 25), trunk = ix + (narrow ? 2 : 20);
  const iw = rowX - ix + rowW + 4 + (narrow ? 0 : short ? UPS_MAX * 11 + 2 : CRAC.w + 2), w = iw + 2 * WALL.t;
  const lastY = iy + row0 + (rows - 1) * pitch, ib = lastY + (narrow ? 15 : 14) + (wide && rows % 2 ? 8 : 0);
  const rowY = (r: number): number => iy + row0 + r * pitch;
  const racks = Array.from({ length: COLS * ROWS_MAX }, (_, s) => R(rowX + (s % COLS) * RACK_PITCH, rowY(Math.floor(s / COLS)) - rackH + 2, RACK_W, rackH));
  const spans = Array.from({ length: ROWS_MAX }, (_, r) => R(rowX, racks[r * COLS]!.y, rowW, rackH));
  // CRACs: a narrow hall lines two up on the back wall; else a pair at the ends of the cold aisle of rows 0 and 2 (a short hall: 0 and 1)
  const crE = rowX + rowW + 4;
  const cracs = narrow ? [R(ix + 20, iy, CRAC.w, 8), R(ix + 55, iy, CRAC.w, 8)]
    : Array.from({ length: pairs(rows) * 2 }, (_, i) => R(i & 1 ? crE : ix + 2, rowY((i >> 1) * (short ? 1 : 2)) + 4, CRAC.w, 14));
  const fy = iy + (narrow ? 0 : 2), net = R(ix + 2, fy, SPINE.w, SPINE.d);
  const upsEnd = ix + iw - (narrow ? 0 : short ? 2 : 4), upsPitch = narrow ? 10 : 11;
  const gateway = R(ix + 3, iy - 30, 12, 12), gwx = ix + 9, tx = trunk + 1;
  // the signs: a strip above the back wall, or on the wall itself where nothing stands against it (short)
  const sy = short ? iy - 17 : narrow ? iy - 37 : iy - 4 - WALL.z - 13, sx = ix + (short ? 56 : narrow ? 48 : 23), tw = narrow ? 22 : 24;
  const save = { x: sx + tw + 2 + 26 + 2, y: sy + 1 }, lamp = { x: save.x + 10, y: save.y + 3, w: 8 };
  const doorX = ix + (short ? 136 : narrow ? 41 : iw - 4 - UPS_MAX * 11 - 14), doorY = iy - 4 - WALL.z + 1;
  const focusY = short ? iy - 4 - WALL.z - 1 : narrow ? iy - 38 : iy - 4 - WALL.z - 14;
  const rowSite = R(rowX, Math.ceil((ib + WALL.t + (narrow ? 3 : 6)) / 4) * 4 - 1, rowW, ROW_SITE_H);
  return {
    id, rows, x, w, ix, iw, iy, ib, rowX, rowW, row0, pitch, rackH, tileH, racks, spans,
    cracs, cracHits: cracs.map(f => R(f.x, f.y - CRAC.z, f.w, f.h + CRAC.z)),
    net, netRect: R(net.x, net.y - SPINE.z, net.w, net.h + SPINE.z), lb: R(net.x, net.y - SPINE.z + net.h, 16, 8),
    upsEnd, upsPitch, upsW: upsPitch - 1, upsY: fy,
    trunk, trunkY: narrow ? iy + 9 : iy - 16, gateway, gwx, busX: rowX + rowW + 1, feedX: upsEnd - 3,
    thermo: R(sx, sy, tw, 10), sign: R(sx + tw + 2, sy, 26, 10), save, lamp, lampRect: R(lamp.x - 1, lamp.y - 2, lamp.w + 2, 6),
    door: R(doorX, doorY, 9, WALL.z), doorHit: narrow ? R(doorX - 4, doorY - 1, 18, WALL.z + 1) : R(doorX - 5, doorY - 1, 19, WALL.z + 1),
    netTag: narrow ? { x: ix + 20, y: iy - 36, lx: ix + 14, ly: iy - 22 } : { x: net.x + net.w + 8, y: short ? iy - 16 : iy - 18, lx: net.x + net.w - 1, ly: iy - 14 },
    wait: { x: narrow ? ix - 3 : gateway.x + gateway.w + 4, y: gateway.y - 9 },
    jobPaths: racks.map((r, s) => {
      const ty = rowY(Math.floor(s / COLS)) - rackH + 1, cx = r.x + 8;
      return [[gwx, 0], [gwx, iy - 14], [tx, iy - 14], [tx, ty], [cx, ty], [cx, ty + 4]] as const;
    }),
    dataPlane: { x0: gateway.x + 6, x1: x + w + 40, y: gateway.y - 8 },
    worldW: x + w + 48 - WORLD_X, worldH: ib + WALL.t + 20,
    focus: R(x - 1, focusY, w + 2, ib + WALL.t + (narrow ? 1 : 4) - focusY),
    rowSite, focusSite: R(x - 1, focusY, w + 2, (narrow ? rowSite.y + ROW_SITE_H + 2 : ib + WALL.t + ROW_SITE_H + 8) - focusY),
  };
}
export const PLAN_IDS: readonly RoomPlan[] = ['wide', 'short', 'narrow'];
const ALL: Readonly<Record<RoomPlan, readonly Geom[]>> = {
  wide: Array.from({ length: ROWS_MAX }, (_, i) => build('wide', i + 1)),
  short: Array.from({ length: ROWS_MAX }, (_, i) => build('short', i + 1)),
  narrow: Array.from({ length: ROWS_MAX }, (_, i) => build('narrow', i + 1)),
};
export const geomOf = (id: RoomPlan, rows: number): Geom => ALL[id][Math.max(1, Math.min(ROWS_MAX, rows)) - 1]!;

// ---------- the live plan ----------
let planId: RoomPlan = 'wide';
export let G: Geom = geomOf('wide', 1);
/** Make the live hall the current plan's for `rows`. Every level method calls it before reading `G`. */
export function useRows(rows: number): Geom { G = geomOf(planId, rows); return G; }
/** The largest scale, at most the shell's N, at which `f` rests whole in `area` (0: not even at 1). */
const fit = (f: Rect, area: RestArea): number => Math.max(0, Math.min(area.scale, Math.floor(area.w / f.w), Math.floor(area.h / f.h)));
/**
 * Plan the hall for a free world: the plan whose focus (`site`: with the next row's build site) rests whole at the
 * largest scale, the wide hall first. None at 2 or more keeps the wide hall, which pans.
 */
export function planFor(rows: number, site: boolean, area: RestArea): Geom {
  let best: RoomPlan = 'wide', n = 1;
  for (const id of PLAN_IDS) {
    const g = geomOf(id, rows), k = fit(site ? g.focusSite : g.focus, area);
    if (k > n) { n = k; best = id; }
  }
  planId = best;
  return useRows(rows);
}
export const rowY = (r: number): number => rowYOf(G, r);
export const trayY = (r: number): number => trayYOf(G, r);
export const exhaustY = (r: number): number => exhaustYOf(G, r);
export const rackX = (c: number): number => G.rowX + c * RACK_PITCH;
