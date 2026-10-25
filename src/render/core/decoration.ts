// State overlays. Each one is static for a given sim state, or a one-shot whose age
// comes from a real event. No idle shimmer, flicker, bob or pulse (v2 program §7).
import { P } from './palette';
import { R, brackets, dither, dotted, frame, isReducedMotion, px } from './px';
import { SPR, stamp } from './sprites';

type G = CanvasRenderingContext2D;

/** Glow = temperature. `heat` is heatFraction(tempF, ...) of the real temperature. */
export function heatFx(g: G, x: number, y: number, w: number, h: number, heat: number): void {
  if (heat < 0.45) return;
  const alpha = g.globalAlpha;
  g.globalAlpha = alpha * Math.min(0.9, (heat - 0.45) * 1.8);
  dither(g, x, y, w, h, heat > 0.8 ? P.heat : P.heatHi); g.globalAlpha = alpha;
  if (heat > 0.85) frame(g, x - 1, y - 1, w + 2, h + 2, P.heat);
}
/** Crashed or failed hardware: dark face, steady red outline, a crack. Draw it only while the fault holds. */
export function faultFx(g: G, x: number, y: number, w: number, h: number): void {
  const alpha = g.globalAlpha;
  g.globalAlpha = alpha * 0.6; R(g, x, y, w, h, P.ink); g.globalAlpha = alpha;
  frame(g, x - 1, y - 1, w + 2, h + 2, P.fault);
  const cx = x + (w >> 1), cy = y + (h >> 1);
  for (let i = -2; i <= 2; i++) px(g, cx + i, cy + (i > 0 ? i - 1 : i), P.fault);
}
/** Offline or unpowered hardware: dimmed, no lights. */
export function darkFx(g: G, x: number, y: number, w: number, h: number): void {
  const alpha = g.globalAlpha;
  g.globalAlpha = alpha * 0.55; R(g, x, y, w, h, P.ink); g.globalAlpha = alpha;
}
/** One-shot on a real upgrade or replace event. `ageS` = present time − event time. */
export function upgradeFx(g: G, x: number, y: number, w: number, h: number, ageS: number): void {
  if (ageS < 0 || ageS > 0.7) return;
  if (isReducedMotion()) { brackets(g, x - 1, y - 1, w + 2, h + 2, P.paper); return; }
  if (ageS < 0.12) { R(g, x - 1, y - 1, w + 2, h + 2, P.paper); return; }
  if (ageS < 0.2) frame(g, x - 2, y - 2, w + 4, h + 4, P.paper);
  const k = Math.floor((ageS - 0.12) * 24);
  for (let i = 0; i < 4; i++) {
    const dx = i & 1 ? 1 : -1, dy = i & 2 ? 1 : -1;
    const cx = i & 1 ? x + w : x - 1, cy = i & 2 ? y + h : y - 1;
    px(g, cx + dx * k, cy + dy * k, k % 2 ? P.goldHi : P.gold);
    if (k > 2) px(g, cx + dx * (k - 2), cy + dy * (k - 2), P.goldLo);
  }
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
