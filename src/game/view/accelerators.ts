import { unifiedSpill } from './memory';
import { installedGpuStats } from '../build/gpu';
import { readAccelDomain } from '../core/accelerators';
import { ACCEL_DOMAINS, DT_S, MAX_ACCELS, POOL_DOMAIN } from '../core/constants';
import type { AccelBuild } from '../types/build';
import type { GameState } from '../types/state';
import type { PartView } from '../types/views';

/** Card activity is the actual task and research duty integrated by execution last tick. */
export function acceleratorView(state: GameState, system: number, slot: number, card: AccelBuild): PartView {
  const c = state.compiled.sys, h = state.hot.sys;
  const physical = system * MAX_ACCELS + slot;
  const busy = Math.max(0, Math.min(1,
    ((h.accelTaskS[physical] ?? 0) + (h.accelResearchS[physical] ?? 0)) / DT_S));
  const linked = card.kind === 'gpu' && c.gpuLinked[system] === 1;
  const poolVram = linked ? (readAccelDomain(state.compiled, system, POOL_DOMAIN)?.vramBits ?? 0) : 0;
  const domain = system * ACCEL_DOMAINS + (linked ? POOL_DOMAIN : slot);
  const held = h.accelUsedVram[domain] ?? 0;
  const vramUsedBits = linked ? (poolVram > 0 ? held * (c.accelVram[physical] ?? 0) / poolVram : 0) : held;
  const gpu = card.kind === 'gpu' ? installedGpuStats(card, state.research.unlocks) : undefined;
  return {
    slot, kind: card.kind, generation: gpu ? gpu.generation - 1 : card.kind === 'npu' ? card.gen : 0,
    level: gpu ? gpu.upgrades + 1 : card.kind === 'npu' ? card.level : 1,
    active: busy > 0, resourceBusy: busy, vramUsedBits,
    ...(card.kind === 'gpu' ? { unifiedSpillBits: unifiedSpill(state, system, linked ? POOL_DOMAIN : slot) } : {}),
    ...(gpu ? { gpu } : {}),
  };
}
