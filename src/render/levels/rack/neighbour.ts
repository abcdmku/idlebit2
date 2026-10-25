// A row neighbour beside the active rack (D17.2), at 1:1 in its own column and drawn at 30%
// alpha to keep the focus on the active rack (L2 README "Rack row"). It is drawn from its
// RackSlotView: real modes, °F and PDU usage. The view has no per-port or fan state, so its
// cables stay unlit and its fans stand still. Allocation-free: one scratch server view.
import { P, R, lampState } from '../../core';
import { UNIT_MODES } from '../../../game';
import type { PortView, RackSlotView, ServerSlotView, UnitMode } from '../../../game';
import { fan, label, lcdText, lcdWidth, tempCol } from './art';
import { drawClips, drawPatch, shell } from './cabinet';
import { drawLB, drawSwitch } from './infra';
import { CAB, OPEN, PLINTH, READOUT, SERVER_SLOTS, U, UP_X, WORLD, createRoute, patchRoute, serverRow, slotY } from './layout';
import { drawServer } from './sprites';
import type { ServerLook } from './sprites';
import type { RackSnapshot } from '../../../game';

type G = CanvasRenderingContext2D;
/** The alpha a darkened neighbour draws at. */
export const NEIGHBOUR_ALPHA = 0.3;
/** Mode code (UNIT_MODES index) → the server counts as online. */
export const SERVER_ONLINE: readonly boolean[] = UNIT_MODES.map(mode => lampState(mode) === 'online');

const port: PortView = { speedHz: 1e3, rung: 0, peer: null, active: false, family: null, progress: 0, queued: 0 };
type Mut<T> = { -readonly [K in keyof T]: T[K] };
const server: Mut<ServerSlotView> = {
  systemId: null, kind: 'server', state: 'onMarket', onMarket: true, load: 0, running: 0, admitted: 0, reserved: 0,
  timerS: null, timerTotalS: null, cores: 4, busyCores: 0, port, family: null,
};
const route = createRoute();
const lookOf = (mode: UnitMode, rack: RackSlotView, paused: boolean, market: boolean): ServerLook =>
  rack.state === 'dark' || mode === 'dark' ? 'dark' : rack.state === 'crashed' || mode === 'crashed' ? 'crash' : paused ? (market ? 'paused' : 'out')
    : mode === 'offline' || mode === 'goingOffline' ? 'offline' : mode === 'boot' || mode === 'cold' ? 'boot' : 'live';

/** Plates with no lights: a neighbour's switch and LB faces at their real positions. */
const plates = {
  online: 'onMarket', pdu: { failed: false }, crashed: false, lb: { generation: 0, strategy: 'firstFit', lastTarget: null },
  switch: { generation: 0, ports: [] as PortView[], uplinks: [] as PortView[] }, servers: [] as ServerSlotView[],
} as unknown as RackSnapshot;

/** One reused buffer: each neighbour draws opaque into it, then blits at 30% (no layer bleed). */
let buffer: { canvas: HTMLCanvasElement; g: G } | null | undefined;
function scratchBuffer(): { canvas: HTMLCanvasElement; g: G } | null {
  if (buffer !== undefined) return buffer;
  buffer = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = WORLD.w; canvas.height = WORLD.h;
    let g: G | null = null;
    try { g = canvas.getContext('2d'); } catch { g = null; }
    if (g) { g.imageSmoothingEnabled = false; buffer = { canvas, g }; }
  }
  return buffer;
}

export function drawNeighbour(g: G, v: RackSlotView, x: number, paused: boolean): void {
  const alpha = g.globalAlpha, b = scratchBuffer();
  if (b) {
    b.g.clearRect(0, 0, WORLD.w, WORLD.h); drawBody(b.g, v, paused);
    g.globalAlpha = alpha * NEIGHBOUR_ALPHA; g.drawImage(b.canvas, x, 0); g.globalAlpha = alpha;
    return;
  }
  g.globalAlpha = alpha * NEIGHBOUR_ALPHA; g.save(); g.translate(x, 0);
  drawBody(g, v, paused);
  g.restore(); g.globalAlpha = alpha;
}
function drawBody(g: G, v: RackSlotView, paused: boolean): void {
  const on = v.state !== 'dark' && v.state !== 'empty' && !paused;
  shell(g);
  for (let i = 0; i < 3; i++) fan(g, 27 + i * 24, CAB.roofY + 11, 6, 0, false);
  R(g, READOUT.x, READOUT.y, READOUT.w, READOUT.h, P.ink);
  if (on) { const t = label('', Math.round(v.tempF), '°F'); lcdText(g, READOUT.x + ((READOUT.w - lcdWidth(t)) >> 1), READOUT.y + 2, t, tempCol(v.tempF)); }
  drawSwitch(g, plates, true);
  drawLB(g, plates, true);
  for (let i = 0; i < SERVER_SLOTS; i++) {
    const mode = v.servers[i] ?? 0;
    if (!mode) continue;
    server.state = UNIT_MODES[mode]; server.onMarket = (v.serversOnMarket?.[i] ?? 1) === 1;
    drawServer(g, OPEN.x, slotY(serverRow(i)), OPEN.w, U, server, lookOf(server.state, v, paused, server.onMarket), 0, paused);
    drawPatch(g, patchRoute(i, i, route), 1e3, false);
  }
  drawClips(g);
  R(g, UP_X - 1, 0, 3, CAB.roofY + 2, P.ink); R(g, UP_X, 0, 1, CAB.roofY + 2, P.copperLo);
  R(g, PLINTH.x, PLINTH.y, PLINTH.w, PLINTH.h, P.ink);
  lcdText(g, PLINTH.x + 3, PLINTH.y + 3, 'PDU', P.silk);
  if (on) lcdText(g, PLINTH.x + 18, PLINTH.y + 3, label('', Math.round(v.pduUsage * 100), '%'), v.pduUsage > 0.9 ? P.amber : P.led);
}
