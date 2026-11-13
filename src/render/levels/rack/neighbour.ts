// A row neighbour beside the active rack (D17.2), at 1:1 in its own column and drawn dimmed
// to keep the focus on the active rack (Control deck README "Rack row"). A neighbour in trouble
// (hot, near its PDU's limit) keeps a full-strength frame, so it is found from the active rack. It is drawn from its
// RackSlotView: real modes, °F and PDU usage. The view has no per-port or fan state, so its
// cables stay unlit and its fans stand still. Allocation-free: one scratch server view.
import { P, R, frame as outline, lampState } from '../../core';
import { UNIT_MODES } from '../../../game';
import type { PortView, RackSlotView, ServerSlotView, UnitMode } from '../../../game';
import { fan } from './art';
import { drawClips, drawPatch, shell } from './cabinet';
import { drawLB, drawSwitch } from './infra';
import { CAB, PDU_BAR, PDU_LCD, PLINTH, READOUT, SERVER_SLOTS, UP_X, WORLD, createRoute, patchRoute, serverRect } from './layout';
import { drawServer } from './sprites';
import type { ServerLook } from './sprites';
import type { RackSnapshot } from '../../../game';

type G = CanvasRenderingContext2D;
/** The alpha a darkened neighbour draws at. */
export const NEIGHBOUR_ALPHA = 0.55;
/** Mode code (UNIT_MODES index) → the server counts as online. */
export const SERVER_ONLINE: readonly boolean[] = UNIT_MODES.map(mode => lampState(mode) === 'online');

const port: PortView = { speedHz: 1e3, rung: 0, peer: null, active: false, family: null, progress: 0, queued: 0 };
type Mut<T> = { -readonly [K in keyof T]: T[K] };
const server: Mut<ServerSlotView> = {
  systemId: null, kind: 'server', state: 'onMarket', onMarket: true, load: 0, running: 0, admitted: 0, reserved: 0,
  timerS: null, timerTotalS: null, cores: 4, busyCores: 0, port, family: null,
};
const route = createRoute(), face = { x: 0, y: 0, w: 0, h: 0 };
const lookOf = (mode: UnitMode, rack: RackSlotView, paused: boolean, market: boolean): ServerLook =>
  rack.state === 'standby' || rack.powered === false || mode === 'standby' ? 'dark' : paused ? (market ? 'paused' : 'out')
    : mode === 'offline' || mode === 'goingOffline' ? 'offline' : mode === 'boot' || mode === 'cold' ? 'boot' : mode === 'asleep' ? 'asleep' : 'live';

/** Plates with no lights: a neighbour's switch and LB faces at their real positions. */
const plates = {
  lb: { generation: 0, strategy: 'firstFit', lastTarget: null },
  switch: { generation: 0, ports: [] as PortView[], uplinks: [] as PortView[] }, servers: [] as ServerSlotView[],
} as unknown as RackSnapshot;

/** One reused buffer: each neighbour draws opaque into it, then blits at 30% (no layer bleed). */
let buffer: { canvas: HTMLCanvasElement; g: G } | null | undefined;
function scratchBuffer(): { canvas: HTMLCanvasElement; g: G } | null {
  // the cabinet's plan (layout.ts) sizes it
  if (buffer && (buffer.canvas.width !== WORLD.w || buffer.canvas.height !== WORLD.h)) { buffer.canvas.width = WORLD.w; buffer.canvas.height = WORLD.h; buffer.g.imageSmoothingEnabled = false; }
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
  } else {
    g.globalAlpha = alpha * NEIGHBOUR_ALPHA; g.save(); g.translate(x, 0);
    drawBody(g, v, paused);
    g.restore(); g.globalAlpha = alpha;
  }
  // trouble, at full strength: its roof when hot, its PDU head when near its limit
  if (v.tempF > 80) outline(g, x + CAB.x, CAB.roofY, CAB.w, CAB.roofH, v.tempF >= 100 ? P.fault : P.amber);
  if (v.pduUsage > 0.9) outline(g, x + PLINTH.x - 1, PLINTH.y - 1, PLINTH.w + 2, PLINTH.h + 2, P.amber);
}
function drawBody(g: G, v: RackSlotView, paused: boolean): void {
  const on = v.state !== 'empty' && v.state !== 'standby' && v.powered !== false && !paused;
  shell(g);
  for (let i = 0; i < 3; i++) fan(g, 27 + i * 24, CAB.roofY + 11, 6, 0, false);
  R(g, READOUT.x, READOUT.y, READOUT.w, READOUT.h, P.ink);
  drawSwitch(g, plates, true);
  drawLB(g, plates, true);
  for (let i = 0; i < SERVER_SLOTS; i++) {
    const mode = v.servers[i] ?? 0;
    if (!mode) continue;
    server.state = UNIT_MODES[mode]; server.onMarket = (v.serversOnMarket?.[i] ?? 1) === 1;
    const r = serverRect(i, face);
    drawServer(g, r.x, r.y, r.w, r.h, server, lookOf(server.state, v, paused, server.onMarket), 0, paused);
    drawPatch(g, patchRoute(i, i, route), 1e3, false);
  }
  drawClips(g);
  R(g, UP_X - 1, 0, 3, CAB.roofY + 2, P.ink); R(g, UP_X, 0, 1, CAB.roofY + 2, P.copperLo);
  R(g, PLINTH.x, PLINTH.y, PLINTH.w, PLINTH.h, P.ink);
  R(g, PLINTH.x + 1, PLINTH.y + 1, PLINTH.w - 2, PLINTH.h - 2, P.steelLo);
  const lit = on ? Math.round(Math.min(1.1, v.pduUsage) * 10) : 0;
  R(g, PLINTH.x + PDU_LCD.dx, PLINTH.y + 1, PDU_LCD.w, 9, P.ink);
  for (let i = 0; i < PDU_BAR.n; i++) R(g, PLINTH.x + PDU_BAR.dx + i * PDU_BAR.pitch, PLINTH.y + 3, 3, 5, i < lit ? (i >= 10 ? P.fault : i >= 9 ? P.amber : P.led) : P.ink);
}
