import type { CompiledBuffers } from '../core/buffers';
import { supplyLossW } from '../phys/supplies';
import type { SystemSpec } from '../types/build';
import type { Unlocks } from '../types/state';

/** Rates and watts of the same work, independent of a quote's display units. */
export interface WorkProfile {
  readonly cpuRate: number;
  readonly researchRate: number;
  readonly gpuRate: number;
  readonly cpuIdle: number;
  readonly cpuLoad: number;
  readonly otherIdle: number;
  readonly loads: readonly number[];
  readonly sleep: number;
  readonly cap: number;
  readonly loss: number;
}

export function workProfile(c: CompiledBuffers['sys'], id: number, spec: SystemSpec, u: Unlocks): WorkProfile {
  const sleep = spec.settings.cStateLimit > 0 && u.rules.includes('coreIdle') ? u.ruleParams.coreIdle?.factor ?? 1 : 1;
  let otherIdle = c.clockIdleW[id] ?? 0;
  const loads: number[] = [];
  for (let r = 0; r < 4; r += 1) { otherIdle += c.idleW[id * 4 + r] ?? 0; loads.push(c.loadW[id * 4 + r] ?? 0); }
  return { cpuRate: (c.threadRate[id] ?? 0) * (c.cores[id] ?? 0) * (c.etaCfg[id] ?? 1),
    researchRate: (c.threadRate[id] ?? 0) * (c.threads[id] ?? 0) * (c.etaCfg[id] ?? 1), gpuRate: c.gpuOps[id] ?? 0,
    cpuIdle: c.coreIdleW[id] ?? 0, cpuLoad: c.coreLoadW[id] ?? 0, otherIdle, loads,
    sleep, cap: u.levels.rack ? c.psuCapW[id] ?? 0 : 0, loss: u.levels.rack ? c.psuLoss[id] ?? 0 : 0 };
}

/**
 * Same workload: faster hardware spends fewer seconds doing each unit of work. Added demand
 * scales that work, not the rated watts. Sleep applies to the unoccupied CPU share.
 */
export function workInputWatts(base: WorkProfile, next: WorkProfile, duty: number, demand: number): number {
  const used = (before: number, after: number) => Math.min(1, Math.max(0, duty * demand * (before > 0 ? before / Math.max(1e-12, after) : 1)));
  const cpu = used(base.cpuRate, next.cpuRate), gpu = used(base.gpuRate, next.gpuRate);
  let watts = next.cpuIdle * (cpu + (1 - cpu) * next.sleep) + next.otherIdle + next.cpuLoad * cpu;
  for (let r = 0; r < next.loads.length; r += 1) watts += next.loads[r]! * (r === 2 ? gpu : Math.min(1, duty * demand));
  return watts + supplyLossW(watts, next.cap, next.loss);
}

/** CPU-only research occupies every thread between rounds; other devices retain their idle draw. */
export function researchInputWatts(p: WorkProfile): number {
  const watts = p.cpuIdle + p.cpuLoad + p.otherIdle;
  return watts + supplyLossW(watts, p.cap, p.loss);
}
