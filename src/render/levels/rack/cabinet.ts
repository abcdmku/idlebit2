// The cabinet and what is fixed to it (mockup levels/rack/cabinet.js): the shell (one cached
// layer), patch cables, the uplink and the pulled-out server sled.
import { BG, P, R, frame, mix, prism, px, trace } from '../../core';
import type { PrismStyle } from '../../core';
import { cableOf, disc, drawBlank, drawLayer, fan } from './art';
import { CAB, CHAN, HEADER_Y, NU, OPEN, PLINTH, SLED, U, U0, UPLINK_X, UP_X, WORLD, unitRect } from './layout';
import type { Route } from './layout';

type G = CanvasRenderingContext2D;
export const ROOF = mix(P.wafer, P.steelLo, 0.28);
export const POST = mix(P.wafer, P.ink, 0.25);
const DARK = mix(P.substrate, P.ink, 0.5);
const TILE = mix(BG.rack, P.substrateHi, 0.7);
const SHELL_STYLE: PrismStyle = { top: ROOF, front: POST, sx: 3, sy: 2 };
const scratch = { x: 0, y: 0, w: 0, h: 0 };

function drawFloor(g: G): void {
  const ty = CAB.ground + 3;
  R(g, 9, ty, 110, 13, TILE); frame(g, 9, ty, 110, 13, mix(TILE, P.ink, 0.35));
  for (let y = ty + 2; y < ty + 12; y += 3) for (let x = 12 + ((y / 3) & 1); x < 117; x += 3) px(g, x, y, mix(TILE, P.ink, 0.45));
}
function drawShell(g: G): void {
  const ground = CAB.ground;
  drawFloor(g);
  prism(g, CAB.x, ground - CAB.roofH, CAB.w, CAB.roofH, ground - CAB.frontY, SHELL_STYLE);
  R(g, CAB.x + 1, CAB.roofY + 1, CAB.w - 2, 1, mix(ROOF, '#ffffff', 0.12));
  for (let y = CAB.roofY + 3; y < CAB.roofY + CAB.roofH - 2; y += 3) {
    for (let x = CAB.x + 3 + ((y / 3) & 1); x < CAB.x + CAB.w - 2; x += 3) px(g, x, y, mix(ROOF, P.ink, 0.22));
  }
  R(g, CAB.x + 1, CAB.roofY + CAB.roofH - 1, CAB.w - 2, 1, mix(ROOF, P.ink, 0.3));
  R(g, CAB.x + 1, CAB.frontY + 1, CAB.w - 2, 2, DARK);
  R(g, CAB.x + 1, U0, 7, NU * U, POST); R(g, CHAN.x, U0, CHAN.w, NU * U, DARK);
  R(g, CHAN.x - 1, U0, 1, NU * U, mix(POST, '#ffffff', 0.1));
  R(g, OPEN.x + OPEN.w, U0, 9, NU * U, POST);
  for (const rx of [OPEN.x, OPEN.x + OPEN.w - 2]) {
    R(g, rx, U0, 2, NU * U, P.steelLo);
    for (let y = U0 + 2; y < U0 + NU * U; y += 4) px(g, rx + (rx === OPEN.x ? 1 : 0), y, P.ink);
  }
  for (let u = 0; u < NU; u++) drawBlank(g, unitRect(u, scratch));
  const py = U0 + NU * U;
  R(g, CAB.x + 1, py, CAB.w - 2, ground - py - 1, mix(POST, P.ink, 0.3));
  R(g, PLINTH.x, PLINTH.y, PLINTH.w, PLINTH.h, P.ink);
  for (const fx of [CAB.x + 4, CAB.x + CAB.w - 10]) R(g, fx, ground - 1, 6, 2, P.steelLo);
}
/** Floor tile, cabinet prism, posts, rails and a blanking plate in every U, on a clear ground so
 * row neighbours stand beside it. One cached blit at column offset x. */
export function shell(g: G, x = 0): void { drawLayer(g, 'rack3:shell', WORLD.w, WORLD.h, drawShell, x); }
/** An empty row slot: the floor tile alone. */
export function emptyBay(g: G, x: number): void { drawLayer(g, 'rack3:floor', WORLD.w, WORLD.h, drawFloor, x); }

/** One patch cable, brightened while its port carries a real transfer. */
export function drawPatch(g: G, route: Route, hz: number, lit: boolean): void {
  const c = cableOf(hz);
  trace(g, route, lit ? mix(c, '#ffffff', 0.35) : c, 1);
}
/** Cable-manager clips over the patch bundle. */
export function drawClips(g: G): void {
  for (let y = U0 + 10; y < U0 + NU * U; y += 24) {
    R(g, CHAN.x - 1, y, CHAN.w + 2, 1, P.steelLo); px(g, CHAN.x - 1, y + 1, P.steelLo); px(g, CHAN.x + CHAN.w, y + 1, P.steelLo);
  }
}
/** The uplink drops from the ceiling at the back-right corner, runs along the header into the switch's uplink cage. */
export function drawUplink(g: G, hz: number, lit: boolean): void {
  const c = cableOf(hz), col = lit ? mix(c, '#ffffff', 0.35) : c, alpha = g.globalAlpha;
  for (let y = 0; y < HEADER_Y; y++) { g.globalAlpha = alpha * Math.min(1, (y + 1) / 10); R(g, UP_X - 1, y, 3, 1, P.ink); px(g, UP_X, y, col); }
  g.globalAlpha = alpha;
  R(g, UPLINK_X - 1, HEADER_Y - 1, UP_X - UPLINK_X + 2, 3, P.ink); R(g, UPLINK_X, HEADER_Y, UP_X - UPLINK_X + 1, 1, col);
  R(g, UPLINK_X - 1, HEADER_Y, 3, U0 + 3 - HEADER_Y, P.ink); R(g, UPLINK_X, HEADER_Y, 1, U0 + 3 - HEADER_Y, col);
}

/** The server sled pulled out: tray, PSUs with fans at the server's real fan state, fan wall, drive cage. */
export function sledInterior(g: G, iy: number, angle: number, on: boolean): void {
  const x = SLED.x, w = SLED.w, d = SLED.d;
  R(g, x, iy, w, d, mix(P.substrate, P.ink, 0.25));
  R(g, x, iy, 2, d, P.steelLo); R(g, x + w - 2, iy, 2, d, P.steelLo); R(g, x, iy, 1, d, P.steel);
  R(g, x + 2, iy, w - 4, 2, P.ink);
  R(g, x + 2, iy + 2, 69, 74, P.maskLo);
  R(g, x + 71, iy + 2, 2, 74, P.steelLo);
  for (let j = 0; j < 2; j++) {
    const py = iy + 4 + j * 35;
    R(g, x + 73, py, 17, 31, P.ink); R(g, x + 74, py + 1, 15, 29, P.steelLo); R(g, x + 74, py + 1, 15, 1, P.steel);
    fan(g, x + 81, py + 9, 5, angle, on, P.steel);
    for (let yy = py + 17; yy < py + 27; yy += 2) R(g, x + 76, yy, 11, 1, mix(P.steelLo, P.ink, 0.4));
    px(g, x + 75, py + 27, on ? P.led : P.ledOff);
  }
  R(g, x + 2, iy + 77, w - 4, 5, P.ink);
  for (let k = 0; k < 6; k++) { const cx = x + 9 + k * 15; disc(g, cx, iy + 79, 2, P.void); px(g, cx, iy + 79, P.steelHi); }
  R(g, x + 2, iy + 82, w - 4, 3, P.steelLo);
  for (let k = 0; k < 10; k++) R(g, x + 4 + k * 9, iy + 83, 7, 1, P.ink);
}
