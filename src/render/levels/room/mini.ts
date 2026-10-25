// Room level of detail for the global map (mockup datacenter/mini.js drawFloorLOD): the hall
// seen from above with the roof off. Walls, floor, the network rack and UPS against the back
// wall, rows of cabinets whose lights follow the zone's real load, exhaust tinted by the real
// temperature, CRACs at the row ends. Dark zones have no lights; crashed zones show red rows.
// No closures, no strings: the global map draws up to 24 of these a frame.
import { P, R, mix, px } from '../../core';
import type { Rect } from '../../core';
import type { ZoneView } from '../../../game';
import { COLS, CRAC, CRAC_FEET, IY, NET_FOOT, RACK, UPS_FEET, WALL, WORLD_W, WORLD_X, exhaustY, hallOf, rackX, rowY, worldH } from './layout';
import { APRON } from './static';

type G = CanvasRenderingContext2D;
const FACADE = mix(P.substrateHi, P.logicLo, 0.5), CAB = mix(P.substrate, P.ink, 0.35), PERF = mix(P.wafer, P.coolLo, 0.5);
const MINI_ROWS = 2;
// The mini spans the same world rect as the full room (size() at two rows), so the zoom lands on it exactly.
const HALL = hallOf(MINI_ROWS), X0 = WORLD_X, Y0 = 0, W = WORLD_W, H = worldH(MINI_ROWS);
const HX = HALL.x, HY = IY - 4 - WALL.z, HW = HALL.w, HH = HALL.ib + WALL.t - HY;
export const MINI_SIZE: Readonly<Rect> = { x: X0, y: Y0, w: W, h: H };
const m = { k: 1, ox: 0, oy: 0 };
const X = (v: number): number => Math.round(m.ox + (v - X0) * m.k);
const Y = (v: number): number => Math.round(m.oy + (v - Y0) * m.k);
function box(g: G, x: number, y: number, w: number, h: number, c: string, minW = 1, minH = 1): void {
  const x0 = X(x), y0 = Y(y);
  R(g, x0, y0, Math.max(minW, X(x + w) - x0), Math.max(minH, Y(y + h) - y0), c);
}
const exhaustCol = (tempF: number): string => tempF >= 100 ? P.fault : tempF > 92 ? P.heat : tempF > 80 ? mix(P.copperLo, P.heatHi, 0.6) : mix(P.copperLo, P.heatHi, 0.2);

export function drawRoomMini(g: G, z: ZoneView, r: Rect): void {
  m.k = Math.min(r.w / W, r.h / H); m.ox = r.x + (r.w - W * m.k) / 2; m.oy = r.y + (r.h - H * m.k) / 2;
  const dark = z.state === 'dark' || z.state === 'offline' || z.state === 'empty', crashed = z.state === 'crashed';
  const ox = X(HX), oy = Y(HY), ow = Math.max(1, X(HX + HW) - ox), oh = Math.max(1, Y(HY + HH) - oy);
  if (ow >= 10) box(g, HX - 6, IY - 34, HW + 12, HALL.ib + 12 - (IY - 34), APRON);
  R(g, ox - 1, oy - 1, ow + 2, oh + 2, P.ink);
  R(g, ox, oy, ow, oh, FACADE);
  if (ow < 10) { R(g, ox + 1, oy + 1, Math.max(1, ow - 2), Math.max(1, oh - 2), dark ? P.ink : crashed ? P.fault : P.wafer); return; }
  box(g, HALL.ix, IY, HALL.iw, HALL.ib - IY, dark ? mix(P.wafer, P.ink, 0.5) : P.wafer);
  box(g, NET_FOOT.x, IY - 18, 16, 28, CAB);
  box(g, UPS_FEET[UPS_FEET.length - 4].x, IY - 16, 43, 26, P.steelLo);
  if (!dark) {
    const nx = X(NET_FOOT.x + 8), ny = Y(IY - 4);
    px(g, nx, ny, crashed ? P.fault : P.led);
  }
  // Lights per row: the zone's real load lights that share of each row's cabinets.
  const lit = Math.round(Math.max(0, Math.min(1, z.load)) * COLS);
  for (let row = 0; row < MINI_ROWS; row++) {
    const x0 = rackX(0), x1 = rackX(COLS - 1) + RACK.w;
    box(g, x0, rowY(row) + 1, x1 - x0, 11, PERF);
    const by = Y(rowY(row) - 26), bh = Math.max(1, Y(rowY(row)) - by);
    box(g, x0, rowY(row) - 26, x1 - x0, 26, CAB);
    const ey = Math.min(Y(exhaustY(row)), by - (m.k < 0.12 ? 0 : 1));
    R(g, X(x0), ey, Math.max(1, X(x1) - X(x0)), Math.max(1, Math.round(3 * m.k)), dark ? P.ink : exhaustCol(z.tempF));
    if (dark) continue;
    const rowsL = Math.max(1, Math.floor((bh - 1) / 3));
    for (let c = 0; c < COLS; c++) {
      const lx = X(rackX(c) + 8);
      for (let j = 0; j < rowsL; j++) {
        const ly = Math.max(by, by + bh - 1 - Math.floor(((j + 0.5) * bh) / rowsL));
        px(g, lx, ly, crashed ? P.fault : c < lit ? ((c + j) % 4 ? P.led : P.bit) : P.ledOff);
      }
    }
  }
  for (let i = 0; i < 2; i++) {
    const f = CRAC_FEET[i];
    box(g, f.x, f.y - CRAC.z, f.w, f.h + CRAC.z, P.steel, 1, 2);
    if (!dark) px(g, X(f.x + (f.w >> 1)), Y(f.y - CRAC.z) + 1, crashed ? P.fault : P.cool);
  }
}
