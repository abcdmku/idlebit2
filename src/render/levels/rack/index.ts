// Rack level (v3, D17.2): the whole room row of racks, each at its true column. The active
// rack (the focus) is drawn in full; its neighbours are darkened and a tap makes one active.
// The view scrolls along the row (row.ts, rackRowScroll); the camera rests on the active rack.
// Inside the active rack: five infrastructure slots (cooling roof, Power control under it, switch,
// load balancer, PDU)
// and up to twelve servers; tap a server and its sled slides out into the System board.
import { P, R, copyRect, partVersionOf, px, setRect } from '../../core';
import type { LevelRegistry, LevelRenderer, Rect } from '../../core';
import { createFanBank } from './art';
import { CAB_RECT, FOCUS, PHONE_TAG_GUTTER, PLINTH, ROW_W, U0, UP_X, WORLD, colX, serverRect } from './layout';
import { drawRackMini } from './mini';
import { rackLabels } from './labels';
import { rackCol, rackRowScroll } from './row';
import { rackChildren, rackTargets, rackPayoutAnchor, rackShardAnchor } from './targets';
import { drawRow } from './world';
import { rackDark } from './sprites';

export { rackRowScroll, clampScroll, createRowScroll, snapScroll } from './row';
export type { RackRowScroll } from './row';

function icon(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, 16, 16);
  R(g, 3, 0, 11, 16, P.ink);
  R(g, 4, 1, 9, 2, '#4c4a6a'); R(g, 4, 1, 9, 1, P.steelLo);
  R(g, 4, 3, 9, 12, '#18142f');
  R(g, 4, 4, 9, 2, P.logicLo); px(g, 5, 4, P.net); px(g, 7, 4, P.net); px(g, 9, 4, P.ledOff); px(g, 11, 4, P.net);
  for (let i = 0; i < 3; i++) { const y = 7 + i * 3; R(g, 4, y, 9, 2, i ? P.waferHi : P.steelLo); px(g, 5, y, P.led); R(g, 8, y, 3, 1, i ? P.led : P.cacheOn); }
}

export function createRackRenderer(registry: LevelRegistry): LevelRenderer<'rack'> {
  const ctx = { registry, fans: createFanBank(8) };
  return {
    id: 'rack', name: 'Rack',
    size: (_s, out) => setRect(out, 0, 0, ROW_W, WORLD.h),
    /** The active rack, shifted by the row scroll (clamped to the row's built racks). */
    focus(s, _vp, out, form, area) {
      copyRect(FOCUS, out); out.x += colX(rackCol(s)) + rackRowScroll.apply(s, area);
      // Phone: the rest also frames a gutter left of the cabinet, so the pipe tags beside the first
      // drop never touch it (the cabinet rests right of centre; 174 art px fits at 2 from a 348 px view).
      // A narrower view (320 px) keeps the whole cabinet instead: the gutter would crop its PDU strip.
      if (form === 'phone' && (!area || area.w >= (out.w + PHONE_TAG_GUTTER) * 2)) { out.x -= PHONE_TAG_GUTTER; out.w += PHONE_TAG_GUTTER; }
      return out;
    },
    /** The pipe tags keep clear of the active cabinet itself, not the phone gutter beside it. */
    tagClear(s, out) { copyRect(FOCUS, out); out.x += colX(rackCol(s)) + rackRowScroll.offset; return out; },
    /** The row snaps, and a tapped neighbour settles, in 0.15 s (A06). */
    restEaseS: () => 0.15,
    /** The pipe enters at the active rack's ceiling uplink (Control deck D17: x 120, y 0). */
    entry(s, out) { out.x = colX(rackCol(s)) + UP_X; out.y = 0; return out; },
    /** The camera tracks a drag or wheel along the row live. */
    followFocus: () => rackRowScroll.dragging,
    draw: (g, s, view, frame) => drawRow(g, s, view, frame, ctx),
    drawMini: (g, v, rect, frame) => drawRackMini(g, v, rect, frame.paused),
    /** D35: the switch's one speed. */
    labels: (s, _view, frame, out) => rackLabels(s, frame, out),
    children: rackChildren,
    targets: (s, _view, out, from) => rackTargets(s, out, from),
    payoutAnchor: rackPayoutAnchor,
    shardAnchor: rackShardAnchor,
    /** Purchase flash (A10): cooler, PDU, balancer and switch generations and levels. */
    partVersion(s, id) {
      switch (id) {
        case 'cooler': return partVersionOf(s.cooler);
        case 'pdu': case 'plinth': return partVersionOf(s.pdu);
        case 'lb': return partVersionOf(s.lb);
        case 'switch': return partVersionOf(s.switch);
        case 'powerCtl': return s.powerCtl ? partVersionOf(s.powerCtl) : null;
        default: return null;
      }
    },
    faults(s, out: Rect[]) {
      const ax = colX(rackCol(s));
      let n = 0;
      if (s.crashed && n < out.length) { setRect(out[n++], ax + CAB_RECT.x + 8, U0, CAB_RECT.w - 16, 4); }
      if (rackDark(s) && n < out.length) { copyRect(PLINTH, out[n]); out[n++].x += ax; }
      for (let i = 0; i < s.servers.length && n < out.length; i++) {
        if (s.servers[i].state !== 'crashed' || s.crashed) continue;
        serverRect(i, out[n]); out[n++].x += ax;
      }
      return n;
    },
    icon,
  };
}
