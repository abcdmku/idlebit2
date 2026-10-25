import { G } from '../core/buffers';
import { MAX_UPS } from '../core/constants';
import type { World } from '../core/world';
import { DRAW_NONE, drawKind } from './draw';
import { efficiency, nextThrottle } from './efficiency';
import { physSettings } from './settings';
import { lumpStep, rackSurroundF, roomSurroundF } from './thermal';

/**
 * True when a power and thermal pass would change nothing (quiescent skip, architecture §1.1).
 * Core asks only when the round is not running and research is idle. No system may be in a mode
 * that draws (paused, dark, crashed, cold and offline do not), every stored draw, heat and cooler
 * value must already be 0, no supply or crash timer may be running,
 * and every opened lump must sit exactly at its unpowered equilibrium (the 0.05 °F snap).
 */
export function physSettled(w: World): boolean {
  const c = w.compiled, h = w.hot;
  if (h.g[G.utilityW] !== 0) return false;
  const researchOn = w.research.active !== null && !w.research.stoppedInsolvent;
  for (let s = 0; s < c.sys.len; s += 1) {
    if (drawKind(h.sys.mode[s]!, researchOn) !== DRAW_NONE) return false;
    if (h.sys.drawW[s] !== 0 || h.sys.psuUsage[s] !== 0 || h.sys.psuOverTicks[s] !== 0 || h.sys.psuRebootTicks[s] !== 0) return false;
  }
  const throttle = physSettings(w).throttle;
  for (let r = 0; r < c.rack.len; r += 1) {
    if (h.rack.drawW[r] !== 0 || h.rack.heatW[r] !== 0 || h.rack.coolerW[r] !== 0 || h.rack.coolerDuty[r] !== 0) return false;
    if (h.rack.pduOverTicks[r] !== 0 || h.rack.pduRebootTicks[r] !== 0 || h.rack.crashTicks[r] !== 0 || h.rack.crashed[r] !== 0) return false;
    if (c.rack.alive[r] !== 1 || c.rack.opened[r] !== 1) continue;
    const t = h.rack.tempF[r]!;
    const s = lumpStep(t, 0, c.rack.coolerQc[r]!, 0, c.rack.leak[r]!, c.rack.coolerTau[r]!, rackSurroundF(w, r));
    if (s.next !== t || h.rack.eff[r] !== efficiency(t) || (h.rack.throttled[r] === 1) !== nextThrottle(h.rack.throttled[r] === 1, t, throttle)) return false;
  }
  for (let m = 0; m < c.room.len; m += 1) {
    if (h.room.drawW[m] !== 0 || h.room.heatW[m] !== 0 || h.room.coolerW[m] !== 0 || h.room.coolerDuty[m] !== 0) return false;
    if (h.room.crashTicks[m] !== 0 || h.room.crashed[m] !== 0 || h.room.rideTicks[m] !== 0) return false;
    for (let i = 0; i < MAX_UPS; i += 1) {
      const k = m * MAX_UPS + i;
      if (h.room.upsOverTicks[k] !== 0 || h.room.upsRebootTicks[k] !== 0 || h.room.upsUsage[k] !== 0) return false;
    }
    if (c.room.alive[m] !== 1 || c.room.opened[m] !== 1) continue;
    const t = h.room.tempF[m]!;
    if (lumpStep(t, 0, c.room.coolerQc[m]!, 0, c.room.leak[m]!, c.room.coolerTau[m]!, roomSurroundF(w, m)).next !== t) return false;
  }
  for (let s = 0; s < c.site.len; s += 1) {
    if (h.site.drawW[s] !== 0 || h.site.gridUsage[s] !== 0 || h.site.gridOverTicks[s] !== 0 || h.site.gridRebootTicks[s] !== 0) return false;
  }
  return true;
}
