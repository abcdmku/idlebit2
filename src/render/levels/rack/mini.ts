// The room floor's level of detail for one rack, drawn from its RackSlotView inside a 16 × 29
// slot (the rack world at 1/8; mockup levels/rack/mini.js). The slot view carries the rack's
// mode, load, °F, PDU usage and its 12 server modes, so every light here is real.
// Row neighbours at 1:1 are neighbour.ts.
import { P, R, mix, px } from '../../core';
import type { Rect } from '../../core';

import { UNIT_MODES } from '../../../game';
import type { RackSlotView } from '../../../game';
import { SERVER_ONLINE as ONLINE } from './neighbour';

import { CAB, SERVER_SLOTS, SRV_U0, U, U0, WORLD } from './layout';

type G = CanvasRenderingContext2D;
const ROOF = mix(P.wafer, P.steelLo, 0.28), ROOF_HI = mix(ROOF, '#ffffff', 0.18);
const FRONT = mix(P.substrate, P.ink, 0.35), POST = mix(P.wafer, P.ink, 0.25);

const HOT = [0, 0.2, 0.4, 0.6, 0.8].map(t => mix(ROOF, P.heatHi, t)), COLD = mix(ROOF, P.coolHi, 0.3);
function roofTint(T: number): string {
  if (T >= 100) return P.heat;
  if (T > 80) return HOT[Math.min(4, Math.ceil((T - 80) / 5))];
  return T < 68 ? COLD : ROOF;
}
/** Between rounds: a sled row that runs next round (ready, dim green) or sits out (unlit). */
const READY = mix(P.led, P.ink, 0.55), OUT = mix(FRONT, P.ink, 0.45);
/** D31: a standby rack (its room's start controller has not powered it) draws 0 W: dark like an off rack. */
const powered = (v: RackSlotView): boolean => v.state !== 'dark' && v.state !== 'offline' && v.state !== 'empty' && v.state !== 'standby' && v.powered !== false;
const ASLEEP = UNIT_MODES.indexOf('asleep'), SLEEP_ROW = mix(P.ledOff, P.ink, 0.5);
const m = { k: 1, ox: 0, oy: 0 };
const X = (v: number): number => Math.round(m.ox + v * m.k), Y = (v: number): number => Math.round(m.oy + v * m.k);
/** Per server slot: 1 when it shows as busy. The rack's real load lights that share of its online servers. */
const busy = new Uint8Array(SERVER_SLOTS);
function markBusy(v: RackSlotView): void {
  let n = 0;
  for (let i = 0; i < SERVER_SLOTS; i++) if (ONLINE[v.servers[i] ?? 0] && v.servers[i] !== ASLEEP) n++;
  let left = v.load > 0.02 ? Math.max(1, Math.round(Math.min(1, v.load) * n)) : 0;
  for (let i = 0; i < SERVER_SLOTS; i++) { const on = ONLINE[v.servers[i] ?? 0] && v.servers[i] !== ASLEEP && left > 0; busy[i] = on ? 1 : 0; if (on) left--; }
}

/** The room's view of one rack: roof tinted by its °F, one LED row per server lit by the real load share. */
export function drawRackMini(g: G, v: RackSlotView, rect: Rect, paused: boolean): void {
  m.k = Math.min(rect.w / WORLD.w, rect.h / WORLD.h);
  m.ox = rect.x + (rect.w - WORLD.w * m.k) / 2; m.oy = rect.y + (rect.h - WORLD.h * m.k) / 2;
  const x0 = X(CAB.x), x1 = X(CAB.x + CAB.w), y0 = Y(CAB.roofY), y1 = Y(CAB.ground), yf = Math.max(y0 + 2, Y(CAB.frontY));
  const w = x1 - x0, h = y1 - y0, on = powered(v) && !paused, crashed = v.state === 'crashed', ready = paused && powered(v) && !crashed;
  if (w < 4 || h < 6) { R(g, x0, y0, Math.max(1, w), Math.max(2, h), P.ink); return; }
  const alpha = g.globalAlpha;
  g.globalAlpha = alpha * 0.34; R(g, x0 + 1, y0 + 1, w, h, P.ink); g.globalAlpha = alpha;
  R(g, x0, y0, w, h, P.ink);
  R(g, x0 + 1, y0 + 1, w - 2, yf - y0 - 1, powered(v) ? roofTint(v.tempF) : mix(ROOF, P.ink, 0.5));
  if (yf - y0 >= 3) R(g, x0 + 1, y0 + 1, w - 2, 1, ROOF_HI);
  R(g, x0 + 1, yf, w - 2, y1 - yf - 1, FRONT);
  const side = w >= 14 ? 2 : 1, ix0 = x0 + side, ix1 = x1 - side - (w >= 14 ? 1 : 0);
  if (w >= 14) { R(g, x0 + 1, yf, 1, y1 - yf - 1, POST); R(g, x1 - 3, yf, 2, y1 - yf - 1, POST); }
  // Between rounds an off-market rack (its switch or an ancestor's is off) is clearly darker.
  if (paused && v.state === 'offline') { g.globalAlpha = alpha * 0.45; R(g, x0 + 1, y0 + 1, w - 2, h - 2, P.ink); g.globalAlpha = alpha; }
  // D31: a rack powering on shows one steady amber line along its roof edge until it is up (real wakeMs).
  if (v.wakeMs != null && v.wakeMs > 0) R(g, x0 + 1, y0 + 1, w - 2, 1, P.amber);
  if (!on && !ready) return;
  if (on) markBusy(v);
  for (let y = yf + 1; y < y1 - 1; y += 2) {
    const wy = (y + 0.5 - m.oy) / m.k;
    if (wy < U0) continue;
    const u = Math.floor((wy - U0) / U), slot = u - SRV_U0;
    if (u < SRV_U0) { for (let x = ix0; x < ix1; x += 2) px(g, x, y, mix(P.net, P.ink, 0.6)); continue; }
    if (slot >= SERVER_SLOTS || !v.servers[slot]) continue;
    const c = ready ? ((v.serversOnMarket?.[slot] ?? 1) ? READY : OUT) : crashed ? mix(P.fault, P.ink, 0.3) : v.servers[slot] === ASLEEP ? SLEEP_ROW : busy[slot] ? P.led : P.ledOff;
    for (let x = ix0; x < ix1; x += 2) px(g, x, y, c);
  }
}

