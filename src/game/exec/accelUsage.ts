import { ACCEL_CLOCKS, DT_S, MAX_ACCELS, POOL_DOMAIN } from '../core/constants';
import type { World } from '../core/world';
import type { Span } from './clocks';
import { acceleratorResearchOn } from './research';
import { GPU } from './shape';

/**
 * A visit owns fresh meters; later failure cleanup leaves consumed duty intact. A skipped system
 * keeps last tick's meters, which a visit without events would reproduce exactly (run.ts).
 */
export function resetAccelUsage(w: World): void {
  const h = w.hot.sys;
  h.accelTaskS.fill(0); h.accelResearchS.fill(0); h.accelResearchOps.fill(0);
}

export function resetSystemAccelUsage(w: World, s: number): void {
  const h = w.hot.sys, taskS = h.accelTaskS, researchS = h.accelResearchS;
  // A plain loop: a ranged fill() per system costs more than its eight stores.
  for (let p = s * MAX_ACCELS, end = p + MAX_ACCELS; p < end; p += 1) { taskS[p] = 0; researchS[p] = 0; }
  h.accelResearchOps[s] = 0;
}

/**
 * Integrate physical-card duty and research through an interval before its ending event. Returns
 * the research base (Σ card ops × research share) the research ops scale (0 for an empty interval).
 */
export function integrateAccelerators(w: World, s: number, from: number, to: number, span: Span, share: number, runs: boolean): number {
  if (to === from) return 0;
  const c = w.compiled.sys, h = w.hot.sys;
  const seconds = (to - from) * DT_S;
  const deltaE = (to - from) * (span.x1[GPU]! - span.x0[GPU]!);
  const research = acceleratorResearchOn(w, s);
  let researchBase = 0;
  for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
    const p = s * MAX_ACCELS + slot, kind = c.accelKind[p]!;
    if (kind === 0) continue;
    const d = kind === 1 && c.gpuLinked[s] === 1 ? POOL_DOMAIN : slot;
    const i = s * ACCEL_CLOCKS + 2 * d;
    const active = h.accelActive[i]! + h.accelActive[i + 1]!;
    const taskU = runs && active > 0 ? share : 0;
    const researchU = research ? 1 - taskU : 0;
    h.accelTaskS[p] = h.accelTaskS[p]! + taskU * seconds;
    h.accelResearchS[p] = h.accelResearchS[p]! + researchU * seconds;
    researchBase += (kind === 1 ? c.accelOps[p]! : c.accelTensorOps[p]!) * researchU;
  }
  h.accelResearchOps[s] = h.accelResearchOps[s]! + researchBase * c.etaCfg[s]! * deltaE;
  return researchBase;
}
