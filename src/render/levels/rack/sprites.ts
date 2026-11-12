// Server front panels (mockup levels/rack/sprites.js drawServer), drawn from the slot view.
// Every light is real: core LEDs are busy cores, the NIC light is a transfer on its switch
// port, the power light is power, red is halted. A dark rack is fully unlit.
import { KIND, P, R, frame as outline, drawTypeMini, drawUnitLamp, lampState, mix, px, typeOf } from '../../core';
import type { RackSnapshot, ServerSlotView } from '../../../game';
import { BEZEL, OFF, ears } from './art';
import { LCD_DY, LCD_H, SRV_LCD, SRV_LEDS, sledDy } from './layout';

type G = CanvasRenderingContext2D;
/** Between rounds a sled is 'paused' (on market: it runs next round, LCD READY) or 'out' (its switch or an ancestor's is off: it sits out, LCD OFF). */
/** D31: 'asleep' (S3, 0.03 × idle) dims with LCD SLEEP; a 'standby' system (its rack powered off by a start controller, 0 W) draws 'dark'. */
export type ServerLook = 'live' | 'dark' | 'crash' | 'noport' | 'paused' | 'out' | 'offline' | 'boot' | 'asleep' | 'waking';
/** D31: the base S3 wake (s3WakeS, 2 s); Power control levels only shorten it, so a wake lamp drains within it. */
export const WAKE_MS = 2000;
/** The sled is on market: its own and every ancestor's switch is on (a missing flag reads as on). */
export const onMarket = (v: ServerSlotView): boolean => v.onMarket !== false;

/** The rack has no power: its PDU failed, the unit is dark, or a room start controller holds it in standby (D31, 0 W). */
export const rackDark = (s: RackSnapshot): boolean => s.online === 'dark' || s.online === 'standby' || s.pdu.failed;

export function serverLook(s: RackSnapshot, v: ServerSlotView, paused: boolean): ServerLook {
  if (rackDark(s) || v.state === 'dark' || v.state === 'standby' || s.online === 'standby') return 'dark';
  if (s.crashed || v.state === 'crashed') return 'crash';
  if (paused) return onMarket(v) ? 'paused' : 'out';
  if (v.state === 'boot' || v.state === 'cold') return 'boot';
  if (v.state === 'offline' || v.state === 'goingOffline') return 'offline';
  if (v.state === 'asleep') return (v.wakeMs ?? 0) > 0 ? 'waking' : 'asleep';
  if (v.port === null) return 'noport';
  return 'live';
}
/** Chassis grade from the real core count: bigger servers wear brighter metal. */
export const tierOf = (cores: number): number => (cores >= 32 ? 3 : cores >= 8 ? 2 : cores >= 2 ? 1 : 0);
/** The status display's window on a server face at (x, y), as `drawServer` lays it out: the label line and the shard drain. */
export function serverLcd(x: number, y: number, _cores: number, out: { x: number; y: number; w: number; h: number }): void {
  out.x = x + SRV_LCD.dx; out.y = y + sledDy() + LCD_DY; out.w = SRV_LCD.w; out.h = LCD_H;
}
/** A half sled's busy share starts here (a text column, a multiple of 4 art px), 2 px after its type's mini; `lx` is its display's x. */
export const halfShareX = (lx: number): number => Math.ceil((lx + 8) / 4) * 4;
const LCD_BG = [mix(P.ledOff, P.ink, 0.55), mix(P.sramLo, P.ink, 0.5)];
const HALT = mix(P.fault, P.ink, 0.25), SLEEP_LED = mix(P.led, P.ink, 0.55), box = { x: 0, y: 0, w: 0, h: 0 };

/**
 * Lit LEDs (0..3) of core column `c` of `cols`: the mean busy of its cores (`coreBusy`, core order),
 * at least one while any of them works. Without `coreBusy` (older views), the busy count fills
 * columns from the left as before.
 */
export function litLeds(v: ServerSlotView, c: number, cols: number): number {
  const per = v.coreBusy;
  if (!per || !per.length) {
    const n = v.cores > 0 && v.busyCores > 0 ? Math.max(1, Math.round((v.busyCores / v.cores) * cols)) : 0;
    return c < n ? 3 : 0;
  }
  const n = per.length, lo = Math.floor((c * n) / cols), hi = Math.max(lo + 1, Math.floor(((c + 1) * n) / cols));
  let sum = 0;
  for (let i = lo; i < hi && i < n; i++) sum += Math.max(0, Math.min(1, per[i]!));
  const f = sum / (hi - lo);
  return f > 0 ? Math.max(1, Math.round(f * 3)) : 0;
}
/**
 * One server face at (x, y), `w` × `h`: NIC, the status display, one LED column per core, the lamp in the right ear.
 * The display's words and the busy figure are the core's crisp label (labels.ts); here it is a dark window with the
 * port's real transfer progress along its top, and on a half sled the mini of the task type it runs. The LEDs and the
 * right ear stand under the payout pop (targets.ts), which so covers no word.
 */
export function drawServer(g: G, x: number, y: number, w: number, h: number, v: ServerSlotView, look: ServerLook, heat: number, paused: boolean): void {
  const tier = tierOf(v.cores), bez = BEZEL[tier], hi = mix(bez, '#ffffff', 0.16), lo = mix(bez, P.ink, 0.35);
  const dark = look === 'dark', face = dark ? mix(bez, P.ink, 0.55) : bez, alpha = g.globalAlpha;
  R(g, x, y, w, h, P.ink);
  R(g, x + 1, y + 1, w - 2, h - 2, face);
  R(g, x + 1, y + 1, w - 2, 1, dark ? lo : tier === 3 ? P.logicHi : hi);
  R(g, x + 1, y + h - 2, w - 2, 1, lo);
  box.x = x; box.y = y; box.w = w; box.h = h; ears(g, box, face, tier);
  const live = look === 'live', half = w < 60, fy = y + ((h - 12) >> 1);
  // NIC jack with its link light (left ear): lit only while a real transfer runs on its port
  R(g, x + (half ? 1 : 2), fy + 3, 3, 3, P.ink); px(g, x + (half ? 2 : 3), fy + 4, P.substrateHi);
  px(g, x + (half ? 3 : 4), fy + 2, live && v.port?.active ? P.net : OFF);
  px(g, x + w - 4, fy + 3, look === 'crash' ? P.fault : dark || look === 'offline' || look === 'out' ? OFF : look === 'boot' || look === 'waking' ? P.amber : look === 'asleep' ? SLEEP_LED : P.led);

  // status display
  const lx = x + SRV_LCD.dx, lw = SRV_LCD.w;
  R(g, lx - 1, fy + LCD_DY - 1, lw + 2, LCD_H + 2, P.ink);
  R(g, lx, fy + LCD_DY, lw, LCD_H, dark ? P.ink : look === 'crash' ? P.faultLo : LCD_BG[tier >= 2 ? 1 : 0]);
  // a task landing over its port: the line is the transfer's real progress
  if (live && v.port?.active) R(g, lx, fy + LCD_DY, Math.round(lw * Math.min(1, v.port.progress)), 1, P.net);
  // a half sled has no room for the type's name: its mini stands before the busy share
  if (half && live && v.running > 0 && v.family !== null) drawTypeMini(g, typeOf(v.family), halfShareX(lx) - 7, fy + LCD_DY + 2);

  // one LED column per core (up to 4, a half sled 2; past that, each column is its share of the cores in core order),
  // lit from the foot by how busy those very cores are now, so a busy core stays where it really is
  const cols = Math.max(1, Math.min(SRV_LEDS.max, v.cores)), bottom = fy + 2 + 9 - 1;
  for (let c = 0, cx = x + SRV_LEDS.dx; c < cols; c++, cx += SRV_LEDS.pitch) {
    const lit = live ? litLeds(v, c, cols) : 0;
    for (let k = 0; k < 3; k++) R(g, cx, bottom - k * 3 - 2, SRV_LEDS.w, 2, k < lit ? KIND.compute : OFF);
  }
  // a storage node's bay light (lit while it serves)
  if (!half && v.kind === 'storageNode') { R(g, x + w - 9, fy + 3, 3, 4, P.ink); px(g, x + w - 8, fy + 4, live && v.busyCores + v.running > 0 ? P.led : P.ledOff); }
  // the server's online lamp, in its right ear: real mode, draining over a real boot or switch
  const lampX = x + w - 5, lampY = fy + 7;
  if (!dark) if (look === 'waking') drawUnitLamp(g, lampX, lampY, 3, 'switching', v.wakeMs ?? 0, Math.max(WAKE_MS, v.wakeMs ?? 0), paused);
  else drawUnitLamp(g, lampX, lampY, 3, look === 'out' ? 'offline' : lampState(v.state), (v.timerS ?? 0) * 1000, (v.timerTotalS ?? 0) * 1000, paused);

  // A crashed sled is red-framed at full strength; a sled that sits out is clearly darker; a ready one only slightly dimmed.
  if (look === 'crash') { outline(g, x, y, w, h, P.fault); outline(g, x + 1, y + 1, w - 2, h - 2, HALT); }
  else if (look === 'noport' || look === 'offline' || look === 'out' || look === 'paused' || look === 'asleep') {
    g.globalAlpha = alpha * (look === 'out' ? 0.55 : look === 'paused' ? 0.15 : look === 'asleep' ? 0.35 : 0.3); R(g, x + 1, y + 1, w - 2, h - 2, P.ink); g.globalAlpha = alpha;
    if (look === 'noport') outline(g, x, y, w, h, P.amber);
  }
  else if (live && heat > 0.6) { g.globalAlpha = alpha * Math.min(0.85, (heat - 0.6) * 2.5); R(g, x + 6, y + 1, w - 12, 1, P.heat); g.globalAlpha = alpha; }
}
