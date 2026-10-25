// Server front panels (mockup levels/rack/sprites.js drawServer), drawn from the slot view.
// Every light is real: core LEDs are busy cores, the NIC light is a transfer on its switch
// port, the power light is power, red is halted. A dark rack is fully unlit.
import { KIND, P, R, frame as outline, drawTypeMini, drawUnitLamp, lampState, mix, px, typeOf } from '../../core';
import type { RackSnapshot, ServerSlotView } from '../../../game';
import { BEZEL, OFF, ears, label, lcdChars, lcdText, typeText } from './art';

type G = CanvasRenderingContext2D;
/** Between rounds a sled is 'paused' (on market: it runs next round, LCD READY) or 'out' (its switch or an ancestor's is off: it sits out, LCD OFF). */
export type ServerLook = 'live' | 'dark' | 'crash' | 'noport' | 'paused' | 'out' | 'offline' | 'boot';
/** The sled is on market: its own and every ancestor's switch is on (a missing flag reads as on). */
export const onMarket = (v: ServerSlotView): boolean => v.onMarket !== false;

/** The rack has no power: its PDU failed or the unit is dark. */
export const rackDark = (s: RackSnapshot): boolean => s.online === 'dark' || s.pdu.failed;

export function serverLook(s: RackSnapshot, v: ServerSlotView, paused: boolean): ServerLook {
  if (rackDark(s) || v.state === 'dark') return 'dark';
  if (s.crashed || v.state === 'crashed') return 'crash';
  if (paused) return onMarket(v) ? 'paused' : 'out';
  if (v.state === 'boot' || v.state === 'cold') return 'boot';
  if (v.state === 'offline' || v.state === 'goingOffline') return 'offline';
  if (v.port === null) return 'noport';
  return 'live';
}
/** Chassis grade from the real core count: bigger servers wear brighter metal. */
export const tierOf = (cores: number): number => (cores >= 32 ? 3 : cores >= 8 ? 2 : cores >= 2 ? 1 : 0);
/** The status LCD's window on a server face at (x, y), as `drawServer` lays it out. */
export function serverLcd(x: number, y: number, cores: number, out: { x: number; y: number; w: number; h: number }): void {
  const cols = Math.max(1, Math.min(4, cores)), tier = tierOf(cores);
  out.x = x + 7 + cols * 3 + 2 + 1; out.y = y + 3; out.w = LW[tier]! - 2; out.h = 6;
}
const LW = [26, 30, 34, 38], BAYS = [2, 3, 4, 4];
const LCD_BG = [mix(P.ledOff, P.ink, 0.4), mix(P.sramLo, P.ink, 0.35)], LCD_FG = [P.led, P.cacheOn];
/** Idle and offline lines: the lit segment colour at 60% over the LCD, readable but quiet (A19). */
export const LCD_IDLE = [mix(LCD_FG[0]!, LCD_BG[0]!, 0.4), mix(LCD_FG[1]!, LCD_BG[1]!, 0.4)];
const HALT = mix(P.fault, P.ink, 0.25), box = { x: 0, y: 0, w: 0, h: 0 };

function lcdLine(v: ServerSlotView, look: ServerLook, max: number): string {
  switch (look) {
    case 'crash': return 'HALTED';
    case 'noport': return max >= 7 ? 'NO PORT' : 'NO NET';
    case 'offline': return 'OFFLINE';
    case 'paused': return 'READY';
    case 'out': return 'OFF';
    case 'boot': return label('BOOT ', Math.max(0, Math.ceil(v.timerS ?? 0)));
    default: break;
  }
  if (v.running > 0) return label('RUN ', v.running);
  if (v.port?.active) return 'RECV';
  return 'IDLE';
}

/** One server face at (x, y), OPEN.w × U. */
export function drawServer(g: G, x: number, y: number, w: number, h: number, v: ServerSlotView, look: ServerLook, heat: number, paused: boolean): void {
  const tier = tierOf(v.cores), bez = BEZEL[tier], hi = mix(bez, '#ffffff', 0.16), lo = mix(bez, P.ink, 0.35);
  const dark = look === 'dark', face = dark ? mix(bez, P.ink, 0.55) : bez, alpha = g.globalAlpha;
  R(g, x, y, w, h, P.ink);
  R(g, x + 1, y + 1, w - 2, h - 2, face);
  R(g, x + 1, y + 1, w - 2, 1, dark ? lo : tier === 3 ? P.logicHi : hi);
  R(g, x + 1, y + h - 2, w - 2, 1, lo);
  box.x = x; box.y = y; box.w = w; box.h = h; ears(g, box, face, tier);
  const live = look === 'live';
  // NIC jack with its link light (left ear): lit only while a real transfer runs on its port
  R(g, x + 2, y + 3, 3, 3, P.ink); px(g, x + 3, y + 4, P.substrateHi);
  px(g, x + 4, y + 2, live && v.port?.active ? P.net : OFF);
  px(g, x + w - 4, y + 3, look === 'crash' ? P.fault : dark || look === 'offline' || look === 'out' ? OFF : look === 'boot' ? P.amber : P.led);

  // one LED column per core (up to 4), lit for the cores that are busy now
  const cols = Math.max(1, Math.min(4, v.cores)), busy = v.cores > 0 ? v.busyCores / v.cores : 0;
  const litCols = live && v.busyCores > 0 ? Math.max(1, Math.round(busy * cols)) : 0, bottom = y + 2 + 9 - 1;
  let cx = x + 7;
  for (let c = 0; c < cols; c++, cx += 3) for (let k = 0; k < 3; k++) R(g, cx, bottom - k * 3 - 2, 2, 2, c < litCols ? KIND.compute : OFF);
  cx += 2;

  // status display
  const lw = LW[tier], hiLcd = tier >= 2 ? 1 : 0;
  R(g, cx, y + 2, lw, 8, P.ink); R(g, cx + 1, y + 3, lw - 2, 6, dark ? P.ink : LCD_BG[hiLcd]);
  if (!dark) {
    // A19, set F: a running task shows as its type: the type's 5×5 mini and the type name.
    // The 16 art px type icon does not fit the 6 px LCD window (a server face is one 12 px U).
    const type = look === 'live' && v.running > 0 && v.family !== null ? typeOf(v.family) : null;
    if (type) {
      drawTypeMini(g, type, cx + 2, y + 3);
      lcdText(g, cx + 8, y + 3, typeText(type, (lw - 8) >> 2), LCD_FG[hiLcd]!, cx + 1, cx + lw - 1);
    } else {
      const line = lcdLine(v, look, lcdChars(lw));
      const c = look === 'crash' ? HALT : look === 'noport' ? P.amber : look === 'offline' || look === 'out' || line === 'IDLE' ? LCD_IDLE[hiLcd]! : LCD_FG[hiLcd]!;
      lcdText(g, cx + 2, y + 3, line, c, cx + 1, cx + lw - 1);
    }
    // a task landing over its port: the line is the transfer's real progress
    if (live && v.port?.active) R(g, cx + 1, y + 9, Math.round((lw - 2) * Math.min(1, v.port.progress)), 1, P.net);
  }
  cx += lw + 2;

  // drive bays: more with grade
  const bay = mix(bez, P.ink, 0.5);
  for (let i = 0; i < BAYS[tier]; i++, cx += 6) {
    R(g, cx, y + 2, 5, 8, P.ink); R(g, cx + 1, y + 3, 3, 6, bay); R(g, cx + 1, y + 7, 3, 1, P.steelLo);
    px(g, cx + 1, y + 3, live && v.kind === 'storageNode' && v.busyCores + v.running > 0 ? P.led : P.ledOff);
  }
  cx += 1;
  const vx1 = x + w - 8;
  if (tier === 0) { for (let yy = y + 4; yy < y + h - 3; yy += 3) R(g, cx + 1, yy, vx1 - cx - 1, 1, lo); }
  else for (let yy = y + 3; yy < y + h - 3; yy += 2) for (let xx = cx + ((yy >> 1) & 1); xx < vx1; xx += 2) px(g, xx, yy, lo);
  // the server's online lamp: real mode, draining over a real boot or switch
  if (!dark) drawUnitLamp(g, x + w - 14, y + 9, 6, look === 'out' ? 'offline' : lampState(v.state), (v.timerS ?? 0) * 1000, (v.timerTotalS ?? 0) * 1000, paused);

  if (look === 'crash') { g.globalAlpha = alpha * 0.45; R(g, x + 1, y + 1, w - 2, h - 2, P.ink); g.globalAlpha = alpha; outline(g, x, y, w, h, HALT); }
  // Between rounds: a sled that sits out is clearly darker; a ready one is only slightly dimmed.
  else if (look === 'noport' || look === 'offline' || look === 'out' || look === 'paused') {
    g.globalAlpha = alpha * (look === 'out' ? 0.55 : look === 'paused' ? 0.15 : 0.3); R(g, x + 1, y + 1, w - 2, h - 2, P.ink); g.globalAlpha = alpha;
  }
  else if (live && heat > 0.6) { g.globalAlpha = alpha * Math.min(0.85, (heat - 0.6) * 2.5); R(g, x + 6, y + 1, w - 12, 1, P.heat); g.globalAlpha = alpha; }
}
