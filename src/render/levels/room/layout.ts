// Room world (mockup levels/datacenter/layout.js, v3.js): one AZ hall in 3/4 view.
// Coordinates are the mockup's hall 1 at 1:1, so the approved art lines up. Racks
// stand 15 apart in rows of 8; the rack world (128 × 232) maps exactly onto each
// 16 × 29 rack rect at 1/8. The network rack sits in the top-left corner, outside
// the 24-slot grid. Everything here is computed once at import: no runtime allocation.
import { MAX_ROWS, RACK_SLOTS_PER_ROW } from '../../../game';
import type { PixelPath, Rect } from '../../core';

export const COLS = RACK_SLOTS_PER_ROW;
export const ROWS_MAX = MAX_ROWS;
export const RACK = { w: 16, h: 29, pitch: 15, top: 27 } as const;
export const CRAC = { w: 16, d: 14, z: 24 } as const;
export const BOH = { d: 8, z: 18 } as const;
export const SPINE = { w: 16, d: 8, z: 20 } as const;
export const WALL = { t: 3, z: 22 } as const;
export const ROW0 = 46, ROW_PITCH = 46, IY = 86, HALL_X = 54;
export const ZONE_LETTERS = 'ABCDEF';

export const rowW = (cols: number): number => (cols - 1) * RACK.pitch + RACK.w;
export const rowY = (r: number): number => IY + ROW0 + r * ROW_PITCH;   // ground line in front of row r
export const trayY = (r: number): number => rowY(r) - 29;               // fibre tray above the cabinet roofs
export const exhaustY = (r: number): number => rowY(r) - 33;            // hot-aisle containment top

/** Hall geometry for a row count. */
export interface Hall {
  readonly rows: number; readonly x: number; readonly ix: number; readonly iw: number; readonly w: number;
  readonly rowX: number; readonly crW: number; readonly crE: number; readonly trunk: number; readonly ib: number; readonly gwx: number;
}
function hallGeom(rows: number): Hall {
  const x = HALL_X, ix = x + WALL.t, rw = rowW(COLS), rowX = ix + 25, crW = ix + 2, crE = rowX + rw + 4, trunk = ix + 20;
  const iw = crE + CRAC.w + 2 - ix, ib = rowY(rows - 1) + 14 + (rows % 2 ? 8 : 0);
  return { rows, x, ix, iw, w: iw + 2 * WALL.t, rowX, crW, crE, trunk, ib, gwx: ix + 9 };
}
const HALLS: readonly Hall[] = Array.from({ length: ROWS_MAX + 1 }, (_, r) => hallGeom(Math.max(1, r)));
export const hallOf = (rows: number): Hall => HALLS[Math.max(1, Math.min(ROWS_MAX, rows))];
const H0 = HALLS[1];

export const rackX = (c: number): number => H0.rowX + c * RACK.pitch;
const rr = (s: number): Rect => ({ x: rackX(s % COLS), y: rowY(Math.floor(s / COLS)) - RACK.top, w: RACK.w, h: RACK.h });
/** Rack slot s (row s / 8, column s % 8): where the rack world maps. */
export const RACK_RECTS: readonly Rect[] = Array.from({ length: COLS * ROWS_MAX }, (_, s) => rr(s));

/** CRACs stand at the ends of the cold aisle in front of row 2p and cool rows 2p and 2p + 1. */
export const pairs = (rows: number): number => Math.ceil(rows / 2);
export const CRAC_FEET: readonly Rect[] = Array.from({ length: pairs(ROWS_MAX) * 2 }, (_, i) => {
  const p = i >> 1, side = i & 1;
  return { x: side ? H0.crE : H0.crW, y: rowY(2 * p) + 4, w: CRAC.w, h: CRAC.d };
});
export const CRAC_HITS: readonly Rect[] = CRAC_FEET.map(f => ({ x: f.x, y: f.y - CRAC.z, w: f.w, h: f.h + CRAC.z }));

// Back of house along the back wall: network in the NW corner (the network rack, its fibre from
// the top); power in the NE (the utility feed drops onto the UPS bank at the east end of the back
// wall, and a busway runs down the east side of the rows, mockup datacenter/layout.js).
export const NET_FOOT: Rect = { x: H0.ix + 2, y: IY + 2, w: SPINE.w, h: SPINE.d };
export const NET_RECT: Rect = { x: NET_FOOT.x, y: NET_FOOT.y - SPINE.z, w: NET_FOOT.w, h: NET_FOOT.h + SPINE.z };
/** The LB display on the network rack's front: tapping it opens the load balancer. */
export const LB_RECT: Rect = { x: NET_FOOT.x, y: NET_FOOT.y - SPINE.z + NET_FOOT.h, w: 16, h: 8 };
export const UPS_MAX = 6;
/** UPS cabinet feet, flush with the east end of the back wall. Cabinet k of a bank of n is upsIndex(k, n). */
export const UPS_FEET: readonly Rect[] = Array.from({ length: UPS_MAX }, (_, j) => ({ x: H0.ix + H0.iw - 4 - (UPS_MAX - j) * 11, y: IY + 2, w: 10, h: BOH.d }));
export const upsIndex = (k: number, n: number): number => UPS_MAX - n + k;
/** The utility feed drop over the last UPS, and the power busway east of every rack. */
export const FEED_X = H0.ix + H0.iw - 7, BUS_X = H0.rowX + rowW(COLS) + 1;
export const UPS_HITS: readonly Rect[] = UPS_FEET.map(f => ({ x: f.x, y: f.y - BOH.z, w: f.w, h: f.h + BOH.z }));
export const GATEWAY: Rect = { x: H0.ix + 3, y: IY - 30, w: 12, h: 12 };

// v3 pieces above the back wall: thermostat, zone sign, save icon and lamp, the door to the next zone.
const SIGN_Y = IY - 4 - WALL.z - 11;
export const THERMO: Rect = { x: H0.ix + 24, y: SIGN_Y, w: 21, h: 9 };
export const SIGN: Rect = { x: H0.ix + 48, y: SIGN_Y, w: 22, h: 9 };
export const SAVE_AT = { x: H0.ix + 73, y: SIGN_Y + 1 } as const;
export const LAMP = { x: SAVE_AT.x + 10, y: SAVE_AT.y + 3, w: 8 } as const;
export const LAMP_RECT: Rect = { x: LAMP.x - 1, y: LAMP.y - 2, w: LAMP.w + 2, h: 6 };
/** The corridor door just west of the largest UPS bank, so it never moves. */
export const DOOR: Rect = { x: UPS_FEET[0].x - 14, y: IY - 4 - WALL.z + 1, w: 9, h: WALL.z };
/** The door plus the corridor sign over it: one generous zone-switch target. */
export const DOOR_HIT: Rect = { x: DOOR.x - 5, y: DOOR.y - 1, w: 19, h: DOOR.h + 1 };

/** The fibre path a task rides from the gateway to rack slot s: down the trunk, along the row tray. */
export const JOB_PATHS: readonly PixelPath[] = RACK_RECTS.map((r, s) => {
  const ty = trayY(Math.floor(s / COLS)), cx = r.x + 8, tx = H0.trunk + 1;
  return [[H0.gwx, 0], [H0.gwx, IY - 14], [tx, IY - 14], [tx, ty], [cx, ty], [cx, ty + 4]] as const;
});
/** The site data plane leaves the gateway east, toward the site's other zones. */
export const DATA_PLANE = { x0: GATEWAY.x + 6, x1: H0.x + H0.w + 40, y: GATEWAY.y - 8 } as const;

// World: the hall plus the yard strip above it and the data plane run to the east.
export const WORLD_X = 10, WORLD_W = 266;
export const worldH = (rows: number): number => hallOf(rows).ib + WALL.t + 20;
/** The rest focus: the hall with its sign strip, as the mockup frames it. */
export function focusRect(rows: number, out: Rect): Rect {
  const G = hallOf(rows), y = IY - 4 - WALL.z - 14;
  out.x = G.x - 1; out.y = y; out.w = G.w + 2; out.h = G.ib + WALL.t + 4 - y;
  return out;
}
