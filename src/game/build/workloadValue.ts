import { amountToNumber } from '../amount';
import { REGIONS } from '../core/constants';
import { PRE_SYSTEM_CPU_W } from '../phys/draw';
import { supplyLossW } from '../phys/supplies';
import type { GameState } from '../types/state';
import { researchInputWatts, workInputWatts, workProfile, type WorkProfile } from './workEnergy';
import { pausedResearchEnergy } from './researchEnergy';

/** Paid capacity is bounded by the pipe. Research is work, but earns no Credits. */
export function paidCapacity(state: GameState, id: number): number {
  const c = state.compiled.sys;
  return Math.min((c.threadRate[id] ?? 0) * (c.cores[id] ?? 0) * (c.etaCfg[id] ?? 1)
    + (c.gpuOps[id] ?? 0), c.pipeSpeed[id] ?? 0);
}

/** A CPU forecast needs CPU-only paid work. Mixed device queues and deadlines need a model we do not have. */
export function cpuMarketKnown(state: GameState): boolean {
  const r = state.round.reports.at(-1);
  return r ? !r.byType.some(t => t.type === 'accel' && t.metWork > 0)
    : !state.research.unlocks.levels.system;
}

/** Only accelerator-family paid work can price added GPU capacity. */
export function gpuMarketShare(state: GameState): number {
  const r = state.round.reports.at(-1);
  const total = r?.byType.reduce((n, t) => n + t.metWork, 0) ?? 0;
  return total > 0 ? (r!.byType.find(t => t.type === 'accel')?.metWork ?? 0) / total : 1;
}

/** A busy memory or drive path makes a GPU-only income forecast unsupported. Keep 20% headroom. */
export function gpuMarketKnown(state: GameState): boolean {
  const r = state.round.reports.at(-1);
  if (!r || r.durationTicks <= 0) return false;
  let ram = 0, io = 0;
  state.build.systems.forEach((s, id) => { if (s?.online) { ram += state.compiled.sys.ramBw[id] ?? 0; io += state.compiled.sys.ioRate[id] ?? 0; } });
  const seconds = r.durationTicks / 10;
  return (r.spill.ramWork === 0 || r.spill.ramWork / seconds < ram * 0.8)
    && (r.spill.diskWork === 0 || r.spill.diskWork / seconds < io * 0.8);
}

/** Hold this calibration fixed across a purchase comparison, including actions that clone round. */
export function paidWorkScale(state: GameState): number {
  const report = state.round.reports.at(-1);
  if (!report || report.durationTicks <= 0) return 1;
  let capacity = 0;
  state.build.systems.forEach((s, id) => { if (s?.online) capacity += paidCapacity(state, id); });
  return capacity > 0 ? Math.min(1, amountToNumber(report.gross) / (report.durationTicks / 10) / capacity) : 0;
}

/** Full delivered draw, without assuming the next hardware has the previous hardware's duty. */
export function fullSystemWatts(state: GameState, id: number): number {
  if (!state.research.unlocks.levels.system) return PRE_SYSTEM_CPU_W;
  const c = state.compiled.sys;
  let w = (c.coreIdleW[id] ?? 0) + (c.clockIdleW[id] ?? 0) + (c.coreLoadW[id] ?? 0);
  // The GPU resource column already contains the summed card idle and load watts.
  for (let r = 0; r < 4; r += 1) w += (c.idleW[id * 4 + r] ?? 0) + (c.loadW[id * 4 + r] ?? 0);
  return w;
}

export function fullSystemEnergy(state: GameState, id: number): number {
  return inputEnergy(state, id, fullSystemWatts(state, id));
}

function inputEnergy(state: GameState, id: number, w: number): number {
  const c = state.compiled.sys;
  const loss = state.research.unlocks.levels.rack ? supplyLossW(w, c.psuCapW[id] ?? 0, c.psuLoss[id] ?? 0) : 0;
  const rack = state.build.systems[id]?.rack ?? 0, room = state.build.racks[rack]?.room ?? 0;
  const site = state.build.rooms[room]?.site ?? 0, region = state.build.sites[site]?.region;
  return (w + loss) * (REGIONS.find(r => r.id === region)?.energyPrice ?? REGIONS[0]!.energyPrice);
}

/** D27 research uses CPU threads, not GPU, RAM or drive load power. */
export function researchEnergy(state: GameState): number {
  return pausedResearchEnergy(state);
}

/** Measured energy duty belongs to the original build throughout a comparison. */
export function workDuty(state: GameState): number {
  const r = state.round.reports.at(-1);
  if (!r || r.durationTicks <= 0) return 1;
  let full = 0;
  state.build.systems.forEach((s, id) => { if (s?.online) full += fullSystemEnergy(state, id); });
  return full > 0 ? Math.min(1, Math.max(0, Number(r.energy) / (r.durationTicks / 10) / full)) : 0;
}

export function workEnergyChange(state: GameState, id: number, next: WorkProfile, afterPaid: number): number {
  if (!state.research.unlocks.levels.system) return 0;
  const base = workProfile(state.compiled.sys, id, state.build.systems[id]!.spec, state.research.unlocks);
  const paid = paidCapacity(state, id), demand = paid > 0 ? afterPaid / paid : 1;
  const duty = workDuty(state), watts = fullSystemWatts(state, id);
  const price = watts > 0 ? fullSystemEnergy(state, id) / (watts + supplyLossW(watts, base.cap, base.loss)) : 0;
  return (workInputWatts(base, next, duty, demand) - workInputWatts(base, base, duty, 1)) * price;
}

/** Sustained paused-research heat, including the power supply and PDU losses. */
export function researchRackHeat(state: GameState, rack: number, replacement?: { readonly id: number; readonly profile: WorkProfile }): number {
  let watts = 0;
  for (const id of state.build.racks[rack]?.servers ?? []) {
    if (id === null || !state.build.systems[id]?.online) continue;
    const p = id === replacement?.id ? replacement.profile
      : workProfile(state.compiled.sys, id, state.build.systems[id]!.spec, state.research.unlocks);
    watts += researchInputWatts(p);
  }
  return watts + supplyLossW(watts, state.compiled.rack.pduCapW[rack] ?? 0, state.compiled.rack.pduLoss[rack] ?? 0);
}

/** Marginal market estimate: observed paid work, with energy per unit at the saved sleep settings. */
export function marketGain(before: GameState, after: GameState, allowCpuProxy = false): number {
  const scale = paidWorkScale(before);
  let gain = 0;
  for (let id = 0; id < Math.max(before.build.systems.length, after.build.systems.length); id += 1) {
    const a = before.build.systems[id]?.online ? paidCapacity(before, id) : 0;
    const b = after.build.systems[id]?.online ? paidCapacity(after, id) : 0;
    const old = before.build.systems[id], next = after.build.systems[id];
    const cpuChange = old?.spec.cpu !== next?.spec.cpu;
    if (cpuChange && !cpuMarketKnown(before) && !allowCpuProxy) return 0;
    const gpuChange = old?.spec.accels !== next?.spec.accels;
    if (gpuChange && !gpuMarketKnown(before)) return 0;
    const energy = old?.online && next?.online
      ? workEnergyChange(before, id, workProfile(after.compiled.sys, id, next.spec, after.research.unlocks), b)
      : (next?.online ? fullSystemEnergy(after, id) : 0) - (old?.online ? fullSystemEnergy(before, id) : 0);
    gain += (b - a) * scale * (gpuChange ? gpuMarketShare(before) : 1) - energy;
  }
  return gain;
}
