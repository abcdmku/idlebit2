// Shared v3 world marks every unit level draws (mockup core/v3ui.js and view.js):
// the save icon, the unit state lamp and the paused-world veil.
import { P } from './palette';
import { R, px } from './px';
import { setRect } from './geom';
import type { Rect } from './geom';
import type { UnitMode } from '../../game';

type G = CanvasRenderingContext2D;

export const SAVE_ICON_SIZE = 7;
/** A 7×7 art-px floppy. Static: a saved configuration is not live state. */
export function drawSaveIcon(g: G, x: number, y: number): void {
  R(g, x, y, 7, 7, P.ink);
  R(g, x + 1, y + 1, 5, 5, P.coolLo);
  R(g, x + 2, y + 1, 3, 2, P.steelHi); px(g, x + 4, y + 1, P.steelLo);
  R(g, x + 2, y + 4, 3, 2, P.paper);
  px(g, x + 6, y, P.void);
}
/** The icon's hit rect in art px. Core arbitration pads every target to 44 CSS px. */
export function saveIconRect(x: number, y: number, out: Rect): Rect { return setRect(out, x, y, SAVE_ICON_SIZE, SAVE_ICON_SIZE); }

/** What the lamp shows. Levels map the snapshot's UnitState onto this. */
export type LampState = 'online' | 'offline' | 'switching' | 'fault';
/** The lamp for a unit mode (spec §4.3). Switching modes pair with the unit's timerS. */
export function lampState(mode: UnitMode): LampState {
  switch (mode) {
    case 'onMarket': case 'asleep': case 'paused': return 'online';
    case 'boot': case 'goingOffline': case 'draining': case 'cold': return 'switching';
    case 'crashed': case 'dark': return 'fault';
    // D31: standby (powered off by a start controller) reads as off.
    case 'offline': case 'empty': case 'standby': return 'offline';
  }
}
/** A w×2 lamp: green online, dark offline, steady red on a fault, and amber draining in
 * real time over a switch, boot or cold change (one art px per second at w = 10).
 * While the world is paused an online lamp shows as an unlit LED.
 */
export function drawUnitLamp(g: G, x: number, y: number, w: number, state: LampState,
  remainingMs = 0, totalMs = 0, paused = false): void {
  R(g, x - 1, y - 1, w + 2, 4, P.ink);
  if (state === 'online') R(g, x, y, w, 2, paused ? P.ledOff : P.led);
  else if (state === 'offline') R(g, x, y, w, 2, P.lampOff);
  else if (state === 'fault') R(g, x, y, w, 2, P.fault);
  else {
    R(g, x, y, w, 2, P.lampWell);
    if (totalMs > 0 && remainingMs > 0) R(g, x, y, Math.ceil(w * Math.min(1, remainingMs / totalMs)), 2, P.amber);
  }
}

/** Between rounds the player still makes real choices (market, research, buying): a light veil keeps the world readable. */
export const VEIL_ALPHA = 0.28;
/** The paused-world veil, drawn over the whole canvas after the world. */
export function drawVeil(g: G, w: number, h: number): void {
  const alpha = g.globalAlpha;
  g.globalAlpha = VEIL_ALPHA; g.fillStyle = P.veil; g.fillRect(0, 0, w, h); g.globalAlpha = alpha;
}
