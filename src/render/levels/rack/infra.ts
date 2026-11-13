// The four infrastructure slots (mockup levels/rack/infra.js): cooler (roof), switch and load
// balancer (top two U), PDU (right post and plinth head). Each light is real snapshot state.
import { P, R, mix, px } from '../../core';
import { drawWells } from './flowkit';
import type { RackSnapshot } from '../../../game';
import { ROOF } from './cabinet';
import { OFF, disc, ears, fan, fanAt, unitCol } from './art';
import type { FanBank } from './art';
import { BAY_H, CAB, LB_FACE, LB_LCD, LB_RECT, LB_WELLS, LCD_DY, LCD_H, OPEN, PDU_BAR, PDU_LCD, PLINTH, READOUT, SERVER_SLOTS, STRIP, SWITCH_FACE, SWITCH_RECT, U0, UPLINK_JACK, bayX, plan, portX, serverRect } from './layout';

type G = CanvasRenderingContext2D;
const ROOF_FAN = mix(ROOF, P.steel, 0.25);
const AIR_FANS = [2, 3, 4, 4];

// ---------- cooler: the roof ----------
/** Fans spin at the cooler's real duty; the roof tint is the rack's real temperature. */
export function drawCooler(g: G, s: RackSnapshot, fans: FanBank, timeMs: number, quiet: boolean, still: boolean): void {
  const c = s.cooler, duty = quiet ? 0 : Math.max(0, Math.min(1, c.duty)), y0 = CAB.roofY, cy = y0 + 11, T = s.tempF, alpha = g.globalAlpha;
  if (T > 80) { g.globalAlpha = alpha * Math.min(0.55, (T - 80) / 36); R(g, CAB.x + 1, y0 + 1, READOUT.x - CAB.x - 3, CAB.roofH - 2, T >= 100 ? P.heat : P.heatHi); }
  else if (T < 68) { g.globalAlpha = alpha * Math.min(0.3, (70 - T) / 50); R(g, CAB.x + 1, y0 + 1, READOUT.x - CAB.x - 3, CAB.roofH - 2, P.coolHi); }
  g.globalAlpha = alpha;
  const key = s.rackId * 8;
  if (c.tech === 'air') {
    const n = AIR_FANS[Math.min(3, c.generation)], r = n >= 4 ? 5 : 6, x0 = 27, span = n >= 4 ? 52 : 48;
    for (let i = 0; i < n; i++) {
      const x = Math.round(x0 + (i * span) / (n - 1));
      R(g, x - r - 2, cy - r - 2, 2 * r + 5, 2 * r + 5, P.ink); R(g, x - r - 1, cy - r - 1, 2 * r + 3, 2 * r + 3, ROOF_FAN);
      fan(g, x, cy, r, fanAt(fans, i, key + i, timeMs, duty, still), duty > 0);
    }
  } else {
    // water: supply (blue) and return (warm) hoses from the ceiling, manifold runs, pumps at real duty
    const warm = mix(P.cool, P.heatHi, Math.min(1, Math.max(0, (T - 66) / 30)));
    for (let k = 0; k < 2; k++) {
      const hx = CAB.x + 9 + k * 5, col = k ? warm : P.cool;
      for (let y = 0; y < y0 + 4; y++) { g.globalAlpha = alpha * Math.min(1, (y + 1) / 8); R(g, hx - 1, y, 4, 1, P.ink); R(g, hx, y, 2, 1, col); }
    }
    g.globalAlpha = alpha;
    run(g, y0 + 6, P.coolLo); run(g, y0 + 15, mix(P.coolLo, P.heat, Math.min(0.6, Math.max(0, (T - 66) / 40))));
    for (let x = CAB.x + 30; x < CAB.x + 84; x += 12) { R(g, x, y0 + 8, 2, 7, P.ink); R(g, x, y0 + 9, 1, 5, P.steelLo); }
    // coolant marks move with the pump's real duty (flow), held still under reduced motion
    const off = still ? 0 : Math.floor((timeMs / 1000) * duty * 14) % 8;
    for (let x = CAB.x + 9 + off; x < CAB.x + 85; x += 8) { px(g, x, y0 + 6, P.coolHi); px(g, CAB.x + 93 - (x - CAB.x), y0 + 15, P.coolHi); }
    disc(g, CAB.x + 20, cy, 5, P.ink); fan(g, CAB.x + 20, cy, 4, fanAt(fans, 0, key, timeMs, duty, still), duty > 0, P.coolHi);
    if (c.tech === 'closedLoop' || c.generation >= 1) { disc(g, CAB.x + 72, cy, 5, P.ink); fan(g, CAB.x + 72, cy, 4, fanAt(fans, 1, key + 1, timeMs, duty, still), duty > 0, P.coolHi); }
  }
  drawReadout(g);
}
function run(g: G, y: number, col: string): void {
  R(g, CAB.x + 8, y - 1, 78, 4, P.ink); R(g, CAB.x + 9, y, 76, 2, col); R(g, CAB.x + 9, y, 76, 1, mix(col, '#ffffff', 0.3));
}
/** The roof display's window; the °F is the core's crisp label (labels.ts). */
function drawReadout(g: G): void {
  const r = READOUT;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, mix(P.ledOff, P.ink, 0.55));
}

/** A half cabinet's unit carries its name and value on its faceplate: the window the core's crisp label fills (labels.ts). */
function nameLine(g: G, x: number, y: number, w: number): void {
  R(g, x, y + LCD_DY - 1, w, LCD_H + 1, P.ink); R(g, x + 1, y + LCD_DY, w - 2, LCD_H - 1, mix(P.ledOff, P.ink, 0.55));
}
// ---------- switch ----------
const SW_BODY = [mix(P.wafer, P.steelLo, 0.35), P.logicLo, mix(P.logicLo, P.ink, 0.25)];
/** D35: the switch's port speeds, slowest and fastest (equal when they all match), 0 with no ports. */
export function switchSpeeds(s: RackSnapshot, out: { lo: number; hi: number }): { lo: number; hi: number } {
  out.lo = 0; out.hi = 0;
  for (const p of s.switch.ports) if (p.speedHz > 0) { out.lo = out.lo ? Math.min(out.lo, p.speedHz) : p.speedHz; out.hi = Math.max(out.hi, p.speedHz); }
  return out;
}
/** Port jacks, each with its transfer light (lit only while that link carries a real transfer) and its own speed tier (D35: ports upgrade one by one). */
export function drawSwitch(g: G, s: RackSnapshot, quiet: boolean): void {
  const r = SWITCH_RECT, fy = SWITCH_FACE.y, sw = s.switch, gen = Math.max(0, Math.min(2, sw.generation)), bez = SW_BODY[gen];
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, bez);
  R(g, r.x + 1, r.y + 1, r.w - 2, 1, gen >= 2 ? P.coolLo : mix(bez, '#ffffff', 0.15));
  ears(g, r, bez, gen ? 2 : 0);
  if (fy > r.y) nameLine(g, r.x + 2, r.y, UPLINK_JACK.x - 4 - r.x);
  px(g, r.x + r.w - 4, fy + 3, P.led);
  for (let i = 0; i < SERVER_SLOTS; i++) {
    const jx = portX(i), p = sw.ports[i];
    if (!p) { R(g, jx, fy + 4, 4, 5, mix(bez, P.ink, 0.25)); continue; }
    R(g, jx, fy + 4, 4, 5, P.ink); R(g, jx + 1, fy + 5, 2, 3, p.peer !== null ? P.steel : mix(unitCol(p.speedHz), P.ink, 0.6));
    R(g, jx, fy + 2, 4, 1, !quiet && p.active ? P.net : OFF);
    // the port's speed tier: dots = the 1-2-5 step, brightness = the decade, colour = the unit
    const step = p.rung % 3, dec = Math.floor(p.rung / 3) % 3, col = mix(unitCol(p.speedHz), P.ink, dec === 0 ? 0.55 : dec === 1 ? 0.3 : 0);
    for (let k = 0; k <= step; k++) px(g, jx + k + (step < 2 ? 1 : 0), fy + 10, col);
  }
  const u = UPLINK_JACK, up = sw.uplinks[0];
  R(g, u.x, fy + 3, u.w, 6, P.ink); R(g, u.x + 1, fy + 4, u.w - 2, 4, P.steel); R(g, u.x + 2, fy + 5, u.w - 4, 2, up ? unitCol(up.speedHz) : P.steelLo);
  R(g, u.x, fy + 1, u.w, 1, !quiet && !!up && up.active ? P.net : OFF);
}

// ---------- load balancer ----------
/** Strategy display; one light per server slot, lit on the slot the balancer routed to this tick. */
export function drawLB(g: G, s: RackSnapshot, quiet: boolean): void {
  const r = LB_RECT, fy = LB_FACE.y, bez = mix(P.wafer, P.logicLo, 0.5), lb = s.lb;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, bez);
  R(g, r.x + 1, r.y + 1, r.w - 2, 1, mix(bez, '#ffffff', 0.15));
  ears(g, r, bez, lb.generation >= 1 ? 2 : 0);
  if (fy > r.y) nameLine(g, r.x + 2, r.y, r.w - 4);
  px(g, r.x + r.w - 4, fy + 3, P.led);
  // routed per second: the window the core's crisp label fills (labels.ts)
  const lx = r.x + LB_LCD.dx, lw = LB_LCD.w;
  R(g, lx, fy + LCD_DY - 1, lw, LCD_H + 2, P.ink); R(g, lx + 1, fy + LCD_DY, lw - 2, LCD_H, mix(P.sramLo, P.ink, 0.5));
  R(g, lx + lw + 2, fy + 4, 3, 3, P.ink); px(g, lx + lw + 3, fy + 5, !quiet && lb.lastTarget !== null ? P.bit : OFF);
  const mx = lx + lw + 8;
  for (let i = 0; i < SERVER_SLOTS; i++) {
    const has = s.servers[i]?.systemId != null;
    R(g, mx + i * 3, fy + 4, 2, 4, quiet || !has ? OFF : lb.lastTarget === i ? P.bit : mix(P.net, P.ink, 0.55));
  }
  // D25.7: the router queue's wells, between the routing lights and the status LED
  drawWells(g, lb.queue, LB_WELLS.x, fy + LB_WELLS.dy, LB_WELLS.w, LB_WELLS.h, !quiet);
}

// ---------- PDU: outlet strip on the right post, readout head on the plinth ----------
export function drawPdu(g: G, s: RackSnapshot, quiet: boolean): void {
  const x = STRIP.x - 1, h = BAY_H;
  R(g, x, U0, STRIP.w + 1, h, P.ink); R(g, x + 1, U0 + 1, STRIP.w - 1, h - 2, P.steelLo);
  // a twin's left bay plugs into a slim rail on the divider: one light per unit
  if (plan.id === 'twin') R(g, OPEN.x + OPEN.w, U0, 1, h, P.ink);
  // Power control (row 0) has no outlet: the uplink drops past it.
  for (let u = -2; u < SERVER_SLOTS; u++) {
    const v = u >= 0 ? s.servers[u] : null, used = u < 0 || (!!v && v.systemId !== null);
    const r = u < 0 ? (u === -2 ? SWITCH_FACE : LB_FACE) : serverRect(u, cell);
    const led = used ? (v && v.load > 0.05 && !quiet ? P.amber : P.led) : OFF;
    if (r.x + r.w + 2 < STRIP.x && plan.id === 'twin') { px(g, r.x + r.w, r.y + (r.h >> 1) - 1, used ? led : P.steelLo); continue; }
    // a half row's two sleds take an outlet each, the left sled's above the right's
    const oy = r.w < OPEN.w ? r.y + (r.x > OPEN.x ? 7 : 1) : r.y + (r.h >> 1) - 2;
    R(g, x + 1, oy, 3, 3, P.ink); px(g, x + 2, oy + 1, used ? P.steel : P.steelLo);
    px(g, x + 5, oy + 1, led);
    if (used && r.x + r.w + 2 === STRIP.x) R(g, r.x + r.w, oy + 1, x + 1 - r.x - r.w, 1, mix(P.steelLo, P.ink, 0.3));
  }
  drawPduHead(g, s);
}
const cell = { x: 0, y: 0, w: 0, h: 0 };
function drawPduHead(g: G, s: RackSnapshot): void {
  const r = PLINTH, sp = s.pdu, use = sp.usage, bez = mix(P.steelLo, P.ink, 0.25);
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, bez); R(g, r.x + 1, r.y + 1, r.w - 2, 1, P.steelLo);
  // usage: the window the core's crisp label fills (labels.ts)
  const lx = r.x + PDU_LCD.dx, lw = PDU_LCD.w;
  R(g, lx, r.y + 1, lw, 9, P.ink); R(g, lx + 1, r.y + 1, lw - 2, 9, mix(P.amber, P.ink, 0.88));
  const bx = r.x + PDU_BAR.dx, lit = Math.round(Math.min(1.1, use) * 10);
  for (let i = 0; i < PDU_BAR.n; i++) R(g, bx + i * PDU_BAR.pitch, r.y + 3, 3, 5, i < lit ? (i >= 10 ? P.fault : i >= 9 ? P.amber : P.led) : OFF);
  // a twin's plinth has room for a second display under the right bay: the watts, the core's crisp label (labels.ts)
  if (plan.id === 'twin') {
    const wx = bayX(1);
    R(g, wx, r.y, OPEN.w, r.h, P.ink); R(g, wx + 1, r.y + 1, OPEN.w - 2, r.h - 2, bez); R(g, wx + 1, r.y + 1, OPEN.w - 2, 1, P.steelLo);
    R(g, wx + 2, r.y + 1, OPEN.w - 4, 9, mix(P.amber, P.ink, 0.88));
  }
}
