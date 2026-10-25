// D31.3 Power control: the rack battery and its start controller as one 1U unit, directly under
// the cooler. Its face: a battery whose fill is the real charge (it drains at the rack's real draw
// while the round runs), an LCD with the time until billed ("BAT 4:12", "GRID" once empty) and the
// awake count ("4/12 ON"). An empty slot is a blanking plate with a lock until `powerCtl` is
// researched (`powerCtlLocked`), then an open bay with the add mark.
import { P, R, drawGhost, mix, px } from '../../core';
import type { GhostState } from '../../core';
import { formatClock } from '../../../game';
import type { RackSnapshot } from '../../../game';
import { OFF, ears, lcdText } from './art';
import { POWER_CTL_RECT } from './layout';

type G = CanvasRenderingContext2D;
const BODY = [mix(P.wafer, P.steelLo, 0.45), mix(P.logicLo, P.steelLo, 0.4), mix(P.coolLo, P.steelLo, 0.45)];
const LCD_BG = mix(P.ledOff, P.ink, 0.4), LCD_ON = P.led, LCD_QUIET = mix(P.led, LCD_BG, 0.45);
/** Battery glyph, the battery LCD and the awake LCD across the 100 px face (ears at both ends). */
export const PWR_FACE = { bat: { dx: 7, w: 16 }, lcd: { dx: 25, w: 34 }, awake: { dx: 61, w: 32 } } as const;

const timeText = new Map<number, string>();
/**
 * QA-14: the shared `formatClock` ("4:12", "10:00", then "1.5 h", "12 h"), the plate's format, with
 * "BAT " in front where the LCD holds it (`maxChars`). "GRID" once the battery is empty.
 */
export function batteryText(secondsLeft: number | null, chargeJ: number, maxChars = 8): string {
  if (chargeJ <= 0) return 'GRID';
  if (secondsLeft === null) return 'BAT';
  const s = Math.max(0, secondsLeft);
  // formatClock's resolution: whole seconds under an hour, tenths of an hour after (cached, no per-frame strings)
  const key = (s < 3600 ? Math.floor(s) : 1e6 + Math.floor(s / 360)) * 16 + Math.min(15, maxChars);
  let t = timeText.get(key);
  if (t === undefined) {
    const c = formatClock(s);
    t = c.length + 4 <= maxChars ? `BAT ${c}` : c;
    if (timeText.size < 4096) timeText.set(key, t);
  }
  return t;
}
/** Fill columns of a battery bar `w` px wide: the real charge share (full battery, full bar), at least one while any charge is left. */
export function batteryFill(chargeJ: number, capacityJ: number, w: number): number {
  if (chargeJ <= 0 || capacityJ <= 0) return 0;
  return Math.max(1, Math.round(w * Math.min(1, chargeJ / capacityJ)));
}
const awakeText = new Map<number, string>();
/** "4/12 ON": units awake under the controller now, of its total; "12/12" when "ON" doesn't fit `maxChars`. */
export function awakeCount(awake: number, total: number, maxChars = 7): string {
  const k = (awake * 64 + total) * 16 + maxChars;
  let t = awakeText.get(k);
  if (t === undefined) { t = `${awake}/${total}`; if (t.length + 3 <= maxChars) t += ' ON'; awakeText.set(k, t); }
  return t;
}

/** The Power control U. `dark`: the rack has no power; `quiet`: between rounds (steady lights). */
export function drawPowerCtl(g: G, s: RackSnapshot, dark: boolean, quiet: boolean, ghost: GhostState = 'open'): void {
  const r = POWER_CTL_RECT, pc = s.powerCtl ?? null;
  if (!pc && s.powerCtlLocked === false) {
    // researched, not installed: an open bay with the add mark (the price lives on its plate)
    const cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1);
    drawGhost(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, ghost);
    R(g, cx - 3, cy - 1, 7, 3, P.ink); R(g, cx - 1, cy - 3, 3, 7, P.ink); R(g, cx - 2, cy, 5, 1, P.paper); R(g, cx, cy - 2, 1, 5, P.paper);
    return;
  }
  if (!pc) {
    // The blanking plate (the shell's) with one small lock: Power control is not installed here.
    const lx = r.x + (r.w >> 1) - 3, ly = r.y + 2;
    R(g, lx, ly + 3, 7, 6, P.ink); R(g, lx + 1, ly + 4, 5, 4, P.silk); px(g, lx + 3, ly + 5, P.ink); px(g, lx + 3, ly + 6, P.ink);
    R(g, lx + 1, ly, 5, 3, P.ink); R(g, lx + 2, ly + 1, 1, 2, P.silk); R(g, lx + 4, ly + 1, 1, 2, P.silk); R(g, lx + 2, ly + 1, 3, 1, P.silk);
    return;
  }
  const bez = BODY[Math.max(0, Math.min(2, pc.generation))], face = dark ? mix(bez, P.ink, 0.5) : bez;
  R(g, r.x, r.y, r.w, r.h, P.ink); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, face);
  R(g, r.x + 1, r.y + 1, r.w - 2, 1, mix(face, '#ffffff', 0.15));
  ears(g, r, face, pc.generation >= 1 ? 2 : 0);
  const b = pc.battery, share = b.capacityJ > 0 ? Math.max(0, Math.min(1, b.chargeJ / b.capacityJ)) : 0;

  // battery: body with its real charge as the fill, terminal on the right
  const bx = r.x + PWR_FACE.bat.dx, bw = PWR_FACE.bat.w, by = r.y + 3;
  R(g, bx, by, bw, 6, P.ink); R(g, bx + bw, by + 2, 1, 2, P.ink);
  const fill = batteryFill(b.chargeJ, b.capacityJ, bw - 2), low = share < 0.25;
  R(g, bx + 1, by + 1, bw - 2, 4, mix(face, P.ink, 0.6));
  if (!dark && fill > 0) R(g, bx + 1, by + 1, fill, 4, low ? P.amber : P.led);

  // time until billed: bright while it discharges, quiet otherwise (full between rounds, or no draw)
  const lx = r.x + PWR_FACE.lcd.dx, lw = PWR_FACE.lcd.w;
  R(g, lx, r.y + 2, lw, 8, P.ink); R(g, lx + 1, r.y + 3, lw - 2, 6, dark ? P.ink : LCD_BG);
  if (!dark) {
    const empty = b.chargeJ <= 0, text = batteryText(b.secondsLeft, b.chargeJ, Math.floor((lw - 3) / 4) + 1);
    lcdText(g, lx + 2, r.y + 3, text, empty ? P.amber : b.discharging && !quiet ? LCD_ON : LCD_QUIET, lx + 1, lx + lw - 1);
  }
  // the awake count under the start controller
  const ax = r.x + PWR_FACE.awake.dx, aw = PWR_FACE.awake.w;
  R(g, ax, r.y + 2, aw, 8, P.ink); R(g, ax + 1, r.y + 3, aw - 2, 6, dark ? P.ink : LCD_BG);
  if (!dark) lcdText(g, ax + 2, r.y + 3, awakeCount(pc.start.awake, pc.start.total, Math.floor((aw - 3) / 4)), quiet ? LCD_QUIET : LCD_ON, ax + 1, ax + aw - 1);
  // status LED: green while the battery carries the rack, amber on grid, off when dark
  px(g, r.x + r.w - 4, r.y + 3, dark ? OFF : b.chargeJ <= 0 ? P.amber : P.led);
}
