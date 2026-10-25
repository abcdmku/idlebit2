// Room level (v3; was the data center): one AZ hall at a time. Racks are bought only at the
// next free slot; the network rack in the top-left corner is the room switch with its built-in
// load balancer; the door in the back wall walks to the site's next zone.
import { P, R, copyRect, px, setRect } from '../../core';
import type { LevelRegistry, LevelRenderer, Rect } from '../../core';
import { createFanBank } from '../rack/art';
import { MINI_SIZE, drawRoomMini } from './mini';
import { roomChildren, roomTargets } from './targets';
import { drawWorld } from './world';
import { roomPowered } from './state';
import { COLS, GATEWAY, IY, RACK_RECTS, UPS_HITS, WORLD_W, WORLD_X, focusRect, hallOf, worldH } from './layout';


function icon(g: CanvasRenderingContext2D): void {
  g.clearRect(0, 0, 16, 16);
  R(g, 1, 4, 14, 11, P.ink); R(g, 2, 5, 12, 6, '#7d7f9e'); R(g, 2, 5, 12, 1, '#a3a5c0');
  R(g, 2, 11, 12, 3, '#2c2556'); for (let x = 3; x < 13; x += 2) px(g, x, 12, x % 4 === 1 ? P.led : P.bit);
  R(g, 3, 7, 10, 1, P.bitLo); R(g, 3, 9, 10, 1, P.bitLo);
  R(g, 4, 2, 4, 3, P.ink); R(g, 5, 3, 2, 1, P.cool); R(g, 9, 2, 4, 3, P.ink); R(g, 10, 3, 2, 1, P.cool);
}

export function createRoomRenderer(registry: LevelRegistry): LevelRenderer<'room'> {
  const ctx = { registry, fans: createFanBank(1) };
  return {
    id: 'room', name: 'Room',
    size: (s, out) => setRect(out, WORLD_X, 0, WORLD_W, worldH(s.rows)),
    focus: (s, _vp, out) => focusRect(s.rows, out),
    /** The pipe enters at the gateway fibre, top-left, above the network rack (L2 D17). */
    entry(_s, out) { out.x = GATEWAY.x + (GATEWAY.w >> 1); out.y = 0; return out; },
    draw: (g, s, view, frame) => drawWorld(g, s, view, frame, ctx),
    drawMini: (g, z, rect) => drawRoomMini(g, z, rect),
    /** The World's tile shows the two-row hall, so World ↔ Room lands the hall on it. */
    miniRect: (_s, out) => copyRect(MINI_SIZE, out),
    children: roomChildren,
    targets: (s, _view, out, from) => roomTargets(s, out, from),
    faults(s, out: Rect[]) {
      let n = 0;
      const G0 = hallOf(s.rows);
      if (s.crashed && n < out.length) setRect(out[n++], G0.ix + 8, IY + 8, G0.iw - 16, 4);
      if (!roomPowered(s) && n < out.length) copyRect(UPS_HITS[UPS_HITS.length - 1], out[n++]);
      for (let i = 0; i < Math.min(s.racks.length, s.rows * COLS) && n < out.length; i++) {
        const k = s.racks[i];
        if (k.rackId !== null && k.state === 'crashed') copyRect(RACK_RECTS[i], out[n++]);
      }
      return n;
    },
    icon,
  };
}
