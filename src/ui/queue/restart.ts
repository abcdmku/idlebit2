// A system restarting (a cold change or a boot) holds no work: its cores sit at 0 Hz. The UI says so
// plainly, in the world's reserved line and on the head card, so an idle core is never a mystery.
import type { RenderSnapshot } from '../../game';

export interface Restart { readonly on: boolean; readonly seconds: number | null }
const NONE: Restart = { on: false, seconds: null };

/**
 * The focused system's restart, if it is cold or booting. The System snapshot carries the countdown;
 * the CPU snapshot only its mode until the sim publishes a timer there too (read guarded).
 */
export function restartOf(s: RenderSnapshot): Restart {
  const f = s.focus;
  if (f.level !== 'chip' && f.level !== 'system') return NONE;
  if (f.online !== 'cold' && f.online !== 'boot') return NONE;
  const timer = (f as { timerS?: number | null }).timerS ?? null;
  return { on: true, seconds: timer === null ? null : Math.ceil(timer) };
}

export const restartKey = (r: Restart): string => (r.on ? `on:${r.seconds}` : 'off');

/** "Restarting · 7 s", or "Restarting" before the countdown is known. */
export const restartText = (r: Restart): string => (r.seconds === null ? 'Restarting' : `Restarting · ${r.seconds} s`);
