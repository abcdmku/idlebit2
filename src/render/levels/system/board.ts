// The motherboard itself (mockup v3 levels/system/board.js): PCB slab, texture, silkscreen,
// traces and set dressing. Low contrast so parts and tasks read first. Cached per board.
import type { BoardKind } from '../../../game';
import { P, R, cached, frame, hash, mix, prism, px, silk } from '../../core';
import { BOARD, PORT, SAVE, WORLD, boardOf, siteCentre } from './layout';
import type { BoardLayout, SiteType } from './layout';

type G = CanvasRenderingContext2D;
const TRACE = mix(P.mask, P.maskHi, 0.6);
const VIA = mix(P.mask, P.padLo, 0.55);

function cap(g: G, x: number, y: number): void {
  R(g, x - 1, y - 7, 6, 10, P.ink); R(g, x, y - 2, 4, 4, '#2b2d44'); R(g, x, y - 6, 4, 4, P.steel); px(g, x + 1, y - 5, P.steelHi); R(g, x, y - 2, 1, 4, '#3d4060');
}
function choke(g: G, x: number, y: number): void {
  prism(g, x, y, 7, 5, 5, { top: '#5e6284', front: '#3a3d58', sx: 2, sy: 2 }); R(g, x + 2, y - 4, 3, 1, P.steelLo);
}
/** An orthogonal trace bundle from a to b (horizontal first), n lines 2 px apart. */
function bundle(g: G, x0: number, y0: number, x1: number, y1: number, n: number): void {
  for (let k = 0; k < n; k++) {
    const o = (k - (n >> 1)) * 2;
    R(g, Math.min(x0, x1), y0 + o, Math.abs(x1 - x0) + 1, 1, TRACE);
    R(g, x1 + o, Math.min(y0 + o, y1), 1, Math.abs(y1 - y0 - o) + 1, TRACE);
  }
  px(g, x0, y0, VIA); px(g, x1, y1, VIA);
}
const a = { x: 0, y: 0 }, c = { x: 0, y: 0 };
/** The socket nearest a site centre (Manhattan), written to `a`. */
function nearestSocket(b: BoardLayout, x: number, y: number): void {
  let best = Infinity;
  for (let i = 0; i < b.sites.cpu.length; i++) {
    siteCentre(b, 'cpu', i, c);
    const d = Math.abs(c.x - x) + Math.abs(c.y - y);
    if (d < best) { best = d; a.x = c.x; a.y = c.y; }
  }
}

export function boardStatic(kind: BoardKind): HTMLCanvasElement {
  const b = boardOf(kind);
  return cached(`v3-board-orig:${kind}`, WORLD.w, WORLD.h, g => {
    const top = prism(g, BOARD.x, BOARD.y, BOARD.w, BOARD.h, BOARD.z, { top: P.mask, hi: P.maskHi, lo: P.maskLo, front: '#1f1848', sx: 4, sy: 4 });
    const dark = mix(P.mask, P.maskLo, 0.7), light = mix(P.mask, P.maskHi, 0.6);
    const tx = top.x, ty = top.y, tw = top.w, th = top.h;
    for (let y = ty + 1; y < ty + th - 1; y++) for (let x = tx + 1; x < tx + tw - 1; x++) {
      const h = hash(x * 3.7 + y * 17.3);
      if (h < 0.03) px(g, x, y, dark); else if (h > 0.988) px(g, x, y, light);
    }
    // link from the integrated port down into socket 1
    R(g, PORT.x + (PORT.w >> 1), PORT.y + PORT.h, 1, b.sites.cpu[0]!.y - PORT.y - PORT.h, TRACE);
    // socket-to-socket links, then every site wired back to its nearest socket
    const s0 = { x: 0, y: 0 }; siteCentre(b, 'cpu', 0, s0);
    for (let i = 1; i < b.sites.cpu.length; i++) { siteCentre(b, 'cpu', i, c); bundle(g, s0.x, s0.y, c.x, c.y, 3); }
    for (const type of ['ram', 'gpu', 'drive'] as const satisfies readonly SiteType[]) {
      for (let i = 0; i < b.sites[type].length; i++) {
        const t = { x: 0, y: 0 }; siteCentre(b, type, i, t); nearestSocket(b, t.x, t.y);
        bundle(g, a.x, a.y, t.x, t.y, type === 'ram' ? 1 : 2);
      }
    }
    for (let i = 0; i < 3; i++) choke(g, 108 + i * 9, 56);
    for (const [x, y] of b.dimm === 'h' ? [[155, 166], [155, 194]] : [[155, 120], [155, 166]]) cap(g, x!, y!);
    for (const [hx, hy] of [[14, 34], [154, 34], [14, 209], [154, 209]] as const) { R(g, hx - 2, hy - 2, 5, 5, P.padLo); R(g, hx - 1, hy - 1, 3, 3, P.ink); }
    silk(g, 58, 31, b.silk, mix(P.mask, P.silk, 0.45));
    frame(g, SAVE.x - 2, SAVE.y - 2, 11, 11, mix(P.mask, P.silk, 0.3));
    if (b.dimm === 'v') {
      // baseboard outline: the GPU modules sit on their own tray
      const g0 = b.sites.gpu[0]!, g7 = b.sites.gpu[b.sites.gpu.length - 1]!;
      frame(g, g0.x - 2, g0.y - 9, g7.x + g7.w - g0.x + 4, g7.y + g7.h - g0.y + 4, mix(P.mask, P.silk, 0.22));
    }
  });
}
