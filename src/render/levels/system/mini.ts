// System level of detail, drawn by parents from a ServerSlotView (mockup v3 levels/system/mini.js).
// Wide rects get the server front panel (racks); squarish rects get a top view of the board.
// Every light is real slot state; paused shows power only.
import type { ServerSlotView } from '../../../game';
import { P, R, frame as outline, lampState, mix, px } from '../../core';
import type { Rect, WorldFrame } from '../../core';
import { BOARD, BOARDS, WORLD, packageRect } from './layout';

type G = CanvasRenderingContext2D;
const FACE = '#2b2842', FACE_HI = '#3d3a5a', BAY = '#1d1b30';
const PKG = packageRect(BOARDS.general, 0);

function powerColour(slot: ServerSlotView, paused: boolean): string {
  switch (lampState(slot.state)) {
    case 'online': return paused ? P.ledOff : P.led;
    case 'switching': return P.amber;
    case 'fault': return P.fault;
    case 'offline': return P.lampOff;
  }
}

export function drawSystemMini(g: G, slot: ServerSlotView, r: Rect, frame: WorldFrame): void {
  if (r.w >= r.h * 2.2) frontPanel(g, slot, r, frame); else topView(g, slot, r);
}

function frontPanel(g: G, slot: ServerSlotView, r: Rect, frame: WorldFrame): void {
  const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  const live = !frame.paused && lampState(slot.state) === 'online';
  R(g, x, y, w, h, P.ink);
  R(g, x + 1, y + 1, w - 2, h - 2, FACE); R(g, x + 1, y + 1, w - 2, 1, FACE_HI);
  if (h >= 6) { px(g, x + 2, y + (h >> 1), P.steel); px(g, x + w - 3, y + (h >> 1), P.steel); }
  const inner = h >= 6 ? 2 : 1, ly = y + inner, lh = Math.max(1, h - inner * 2);
  let cx = x + (h >= 6 ? 5 : 2);
  px(g, cx, ly, powerColour(slot, frame.paused)); cx += 3;
  // One LED column per running task (each holds a core); dark columns are free run slots.
  const cols = Math.min(8, Math.max(4, slot.admitted)), lit = live ? Math.min(cols, slot.running) : 0;
  for (let i = 0; i < cols && cx + 2 < x + w - 8; i++) { R(g, cx, ly, 2, lh, i < lit ? P.op : P.ledOff); cx += 3; }
  cx += 2;
  const gw = Math.max(4, Math.round(w * 0.12));
  if (cx + gw < x + w - 8) {
    R(g, cx, ly + lh - 1, gw, 1, P.waferLo);
    if (live) R(g, cx, ly + lh - 1, Math.round(gw * Math.max(0, Math.min(1, slot.load))), 1, P.bit);
    cx += gw + 3;
  }
  if (slot.kind === 'storageNode') for (let i = 0; i < 4 && cx + 5 < x + w - 8; i++) { R(g, cx, ly, 4, lh, BAY); cx += 5; }
  px(g, x + w - 5, ly, live && slot.port?.active ? P.led : P.ledOff);
}

/** The board seen from above, at the full world's own proportions, so a zoom dissolves into it. */
function topView(g: G, slot: ServerSlotView, r: Rect): void {
  const k = Math.min(r.w / WORLD.w, r.h / WORLD.h);
  const ox = r.x + (r.w - WORLD.w * k) / 2, oy = r.y + (r.h - WORLD.h * k) / 2;
  const X = (v: number) => Math.round(ox + v * k), Y = (v: number) => Math.round(oy + v * k);
  const bx = X(BOARD.x), by = Y(BOARD.y - BOARD.z), bw = Math.max(1, X(BOARD.x + BOARD.w) - bx), bh = Math.max(1, Y(BOARD.y - BOARD.z + BOARD.h) - by);
  R(g, bx, by, bw, bh, P.mask); outline(g, bx - 1, by - 1, bw + 2, bh + 2, P.ink);
  const cx = X(PKG.x), cy = Y(PKG.y), cw = Math.max(1, X(PKG.x + PKG.w) - cx), ch = Math.max(1, Y(PKG.y + PKG.h) - cy);
  R(g, cx, cy, cw, ch, '#2b2550');
  if (lampState(slot.state) === 'fault') R(g, cx, cy, cw, ch, mix(P.fault, P.ink, 0.5));
}
