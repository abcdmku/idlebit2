// The four infrastructure slots (mockup levels/rack/infra.js): cooler (roof), switch and load
// balancer (top two U), PDU (right post and plinth head). Each light is real snapshot state.
import { P, R, frame as outline, mix, px } from '../../core';
import { drawWells } from './flowkit';
import type { RackSnapshot } from '../../../game';
import { ROOF } from './cabinet';
import { LB_SHORT, OFF, disc, ears, fan, fanAt, label, lcdText, lcdWidth, tempCol, unitCol } from './art';
import type { FanBank } from './art';
import { CAB, LB_RECT, LB_WELLS, NU, OPEN, PLINTH, READOUT, SERVER_SLOTS, STRIP, SWITCH_RECT, U, U0, UPLINK_JACK, portX, slotY } from './layout';

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
  drawReadout(g, s, quiet);
}
function run(g: G, y: number, col: string): void {
  R(g, CAB.x + 8, y - 1, 78, 4, P.ink); R(g, CAB.x + 9, y, 76, 2, col); R(g, CAB.x + 9, y, 76, 1, mix(col, '#ffffff', 0.3));
}
/** °F and efficiency (or the crash countdown) on the roof display. Blank while dark or paused. */
function drawReadout(g: G, s: RackSnapshot, quiet: boolean): void {
  const r = READOUT, dark = s.online === 'dark' || s.pdu.failed;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, dark ? P.ink : mix(P.ledOff, P.ink, 0.45));
  if (dark || quiet) return;
  const deg = label('', Math.round(s.tempF), '°F');
  lcdText(g, r.x + Math.max(2, (r.w - lcdWidth(deg)) >> 1), r.y + 2, deg, tempCol(s.tempF));
  let l2: string, c2: string;
  if (s.crashed) { l2 = 'HALT'; c2 = P.fault; }
  else if (s.crashS > 0) { l2 = label('CRSH ', Math.ceil(s.crashS)); c2 = P.fault; }
  // A28: the efficiency reads as a bare percent under the °F (the callout names it). The 29 px
  // display holds 6 LCD glyphs a line, so "59°F · 101%" stacks as two lines with no separator.
  else { const e = Math.round(s.eff * 100); l2 = label('', e, '%'); c2 = e < 100 ? P.amber : mix(P.led, P.ink, 0.25); }
  lcdText(g, r.x + Math.max(2, (r.w - lcdWidth(l2)) >> 1), r.y + 8, l2, c2);
}

// ---------- switch ----------
const SW_BODY = [mix(P.wafer, P.steelLo, 0.35), P.logicLo, mix(P.logicLo, P.ink, 0.25)];
/** Port jacks with one transfer light each, lit only while that port carries a real transfer. */
export function drawSwitch(g: G, s: RackSnapshot, quiet: boolean): void {
  const r = SWITCH_RECT, sw = s.switch, gen = Math.max(0, Math.min(2, sw.generation)), bez = SW_BODY[gen];
  const off = s.online === 'dark' || s.pdu.failed;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, off ? mix(bez, P.ink, 0.5) : bez);
  R(g, r.x + 1, r.y + 1, r.w - 2, 1, gen >= 2 ? P.coolLo : mix(bez, '#ffffff', 0.15));
  ears(g, r, bez, gen ? 2 : 0);
  px(g, r.x + r.w - 4, r.y + 3, off ? OFF : P.led);
  lcdText(g, r.x + 7, r.y + 4, 'SW', P.silk);
  for (let i = 0; i < SERVER_SLOTS; i++) {
    const jx = portX(i), p = sw.ports[i];
    if (!p) { R(g, jx, r.y + 4, 4, 5, mix(bez, P.ink, 0.25)); continue; }
    R(g, jx, r.y + 4, 4, 5, P.ink); R(g, jx + 1, r.y + 5, 2, 3, p.peer !== null ? P.steel : mix(unitCol(p.speedHz), P.ink, 0.6));
    R(g, jx, r.y + 2, 4, 1, !quiet && !off && p.active ? P.net : OFF);
    // speed: dots = the 1-2-5 step, brightness = the decade, colour = the unit
    const step = p.rung % 3, dec = Math.floor(p.rung / 3) % 3, col = mix(unitCol(p.speedHz), P.ink, dec === 0 ? 0.55 : dec === 1 ? 0.3 : 0);
    for (let k = 0; k <= step; k++) px(g, jx + k + (step < 2 ? 1 : 0), r.y + 10, off ? OFF : col);
  }
  const u = UPLINK_JACK, up = sw.uplinks[0];
  R(g, u.x, r.y + 3, u.w, 6, P.ink); R(g, u.x + 1, r.y + 4, u.w - 2, 4, P.steel); R(g, u.x + 2, r.y + 5, u.w - 4, 2, up ? unitCol(up.speedHz) : P.steelLo);
  R(g, u.x, r.y + 1, u.w, 1, !quiet && !off && !!up && up.active ? P.net : OFF);
}

// ---------- load balancer ----------
/** Strategy display; one light per server slot, lit on the slot the balancer routed to this tick. */
export function drawLB(g: G, s: RackSnapshot, quiet: boolean): void {
  const r = LB_RECT, bez = mix(P.wafer, P.logicLo, 0.5), dk = s.online === 'dark' || s.pdu.failed, off = dk || quiet, lb = s.lb;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, dk ? mix(bez, P.ink, 0.5) : bez);
  R(g, r.x + 1, r.y + 1, r.w - 2, 1, mix(bez, '#ffffff', 0.15));
  ears(g, r, bez, lb.generation >= 1 ? 2 : 0);
  px(g, r.x + r.w - 4, r.y + 3, dk ? OFF : P.led);
  lcdText(g, r.x + 7, r.y + 4, 'LB', P.silk);
  const lx = r.x + 16, lw = 21;
  R(g, lx, r.y + 2, lw, 8, P.ink); R(g, lx + 1, r.y + 3, lw - 2, 6, mix(P.sramLo, P.ink, 0.35));
  if (!off) lcdText(g, lx + 2, r.y + 3, LB_SHORT[lb.strategy] ?? 'LB', P.cacheOn, lx + 1, lx + lw - 1);
  R(g, lx + lw + 2, r.y + 4, 3, 3, P.ink); px(g, lx + lw + 3, r.y + 5, !off && lb.lastTarget !== null ? P.bit : OFF);
  const mx = lx + lw + 8;
  for (let i = 0; i < SERVER_SLOTS; i++) {
    const has = s.servers[i]?.systemId != null;
    R(g, mx + i * 3, r.y + 4, 2, 4, off || !has ? OFF : lb.lastTarget === i ? P.bit : mix(P.net, P.ink, 0.55));
  }
  // D25.7: the router queue's wells, between the routing lights and the status LED
  drawWells(g, lb.queue, LB_WELLS.x, r.y + LB_WELLS.dy, LB_WELLS.w, LB_WELLS.h, !off);
}

// ---------- PDU: outlet strip on the right post, readout head on the plinth ----------
export function drawPdu(g: G, s: RackSnapshot, quiet: boolean): void {
  const x = STRIP.x - 1, h = NU * U, off = s.online === 'dark' || s.pdu.failed;
  R(g, x, U0, STRIP.w + 1, h, P.ink); R(g, x + 1, U0 + 1, STRIP.w - 1, h - 2, P.steelLo);
  for (let u = 0; u < NU; u++) {
    const oy = slotY(u) + 4, v = u >= 2 ? s.servers[u - 2] : null, used = u < 2 || (!!v && v.systemId !== null);
    R(g, x + 1, oy, 3, 3, P.ink); px(g, x + 2, oy + 1, used ? P.steel : P.steelLo);
    const on = !off && used && !(v && s.crashed);
    px(g, x + 5, oy + 1, on ? (v && v.load > 0.05 && !quiet ? P.amber : P.led) : OFF);
    if (used) R(g, OPEN.x + OPEN.w, oy + 1, x + 1 - OPEN.x - OPEN.w, 1, mix(P.steelLo, P.ink, 0.3));
  }
  drawPduHead(g, s);
}
function drawPduHead(g: G, s: RackSnapshot): void {
  const r = PLINTH, sp = s.pdu, use = sp.usage, bez = mix(P.steelLo, P.ink, 0.25);
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, bez); R(g, r.x + 1, r.y + 1, r.w - 2, 1, P.steelLo);
  lcdText(g, r.x + 3, r.y + 3, 'PDU', P.silk);
  const lx = r.x + 16, lw = 36;
  R(g, lx, r.y + 1, lw, 9, P.ink); R(g, lx + 1, r.y + 2, lw - 2, 7, mix(P.amber, P.ink, 0.85));
  let text: string, col: string;
  if (sp.failed) { text = label('RBT ', Math.ceil((sp.rebootMs ?? 0) / 1000), 'S'); col = P.fault; }
  else if (sp.overloadS > 0) { text = label('OVL ', Math.ceil(sp.overloadS), 'S'); col = use > 1 ? P.fault : P.amber; }
  else { text = label('', Math.round(use * 100), '%'); col = use > 0.9 ? P.amber : P.led; }
  lcdText(g, lx + 2, r.y + 3, text, col, lx + 1, lx + lw - 1);
  const bx = lx + lw + 2, lit = Math.round(Math.min(1.1, use) * 10);
  for (let i = 0; i < 11; i++) R(g, bx + i * 4, r.y + 3, 3, 5, sp.failed ? (i === 10 ? P.fault : OFF) : i < lit ? (i >= 10 ? P.fault : i >= 9 ? P.amber : P.led) : OFF);
  if (sp.failed) outline(g, r.x - 1, r.y - 1, r.w + 2, r.h + 2, P.fault);
}
