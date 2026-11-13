// State overlays. Each one is static for a given sim state, or a one-shot whose age
// comes from a real event. No idle shimmer, flicker, bob or pulse (v2 program §7).
import { P } from './palette';
import { R, brackets, dotted, px } from './px';
import { SPR, stamp } from './sprites';

type G = CanvasRenderingContext2D;

/** Offline or unpowered hardware: dimmed, no lights. */
export function darkFx(g: G, x: number, y: number, w: number, h: number): void {
  const alpha = g.globalAlpha;
  g.globalAlpha = alpha * 0.55; R(g, x, y, w, h, P.ink); g.globalAlpha = alpha;
}
export type GhostState = 'locked' | 'open' | 'afford' | 'picked';
/** Build site overlay. Static: locked is nearly silent, open a faint outline, affordable gold. */
export function drawGhost(g: G, x: number, y: number, w: number, h: number, state: GhostState): void {
  if (state === 'afford' || state === 'picked') {
    const c = state === 'picked' ? P.paper : P.gold, alpha = g.globalAlpha;
    g.globalAlpha = alpha * 0.22;
    for (let yy = y + 3; yy < y + h - 2; yy += 4) for (let xx = x + 3 + ((yy - y) % 8 ? 2 : 0); xx < x + w - 2; xx += 4) px(g, xx, yy, c);
    g.globalAlpha = alpha; dotted(g, x, y, w, h, c); brackets(g, x - 1, y - 1, w + 2, h + 2, c, 4);
  } else if (state === 'open') { dotted(g, x, y, w, h, P.silkLo, 0, 1, 2); brackets(g, x, y, w, h, P.silk); }
  else { brackets(g, x, y, w, h, P.silkLo); stamp(g, SPR.lock, x + (w >> 1) - 3, y + (h >> 1) - 4); }
}
/** Gold up-arrow: this part has an affordable upgrade. (x, y) is the tip. Static. */
export function upArrow(g: G, x: number, y: number): void { g.drawImage(SPR.arrow, x - 3, y); }
/** Dim arrow filling with gold as the wallet approaches the price (`fraction` = credits / price). */
export function upArrowFill(g: G, x: number, y: number, fraction: number): void {
  g.drawImage(SPR.arrowDim, x - 3, y);
  const rows = Math.round(5 * Math.max(0, Math.min(1, fraction)));
  g.save(); g.beginPath(); g.rect(x - 3, y + 6 - rows, 7, rows); g.clip(); g.drawImage(SPR.arrow, x - 3, y); g.restore();
}
