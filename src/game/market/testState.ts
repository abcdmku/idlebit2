import { cloneCompiled } from '../core/buffers';
import { MAX_ACCELS } from '../core/constants';
import { initialHot, preparedMarket } from '../core/state';
import { buildState, type FleetSpec } from '../testkit/builders';
import type { GameState } from '../types/state';

/**
 * Test states for the market. Capability columns are written here, not taken from build/compile,
 * so market tests pin exactly the hardware they reason about.
 */
export interface Caps {
  readonly memCap: number; readonly cacheBits: number; readonly hasRam: number; readonly keff: number;
  readonly threads: number; readonly threadRate: number; readonly ramBw: number; readonly gpuOps: number;
  readonly gpuCores: number; readonly vram: number; readonly storageCap: number; readonly ioRate: number; readonly ecc: number;
}
export const BOOT_CAPS: Caps = {
  memCap: 1, cacheBits: 1, hasRam: 0, keff: 1, threads: 1, threadRate: 1, ramBw: 0, gpuOps: 0,
  gpuCores: 0, vram: 0, storageCap: 0, ioRate: 0, ecc: 0,
};
/** Can run every single-system family at any size. */
export const HUGE_CAPS: Caps = {
  memCap: 2 ** 80, cacheBits: 2 ** 80, hasRam: 1, keff: 4, threads: 8, threadRate: 2 ** 60, ramBw: 2 ** 60, gpuOps: 2 ** 60,
  gpuCores: 2 ** 20, vram: 2 ** 80, storageCap: 2 ** 80, ioRate: 2 ** 60, ecc: 1,
};

export function withCaps(state: GameState, caps: Caps): GameState {
  const compiled = cloneCompiled(state.compiled);
  const s = compiled.sys;
  for (let i = 0; i < s.len; i += 1) {
    if (s.alive[i] !== 1) continue;
    for (const [k, v] of Object.entries(caps)) {
      if (k !== 'gpuCores') (s[k as Exclude<keyof Caps, 'gpuCores'>] as Float64Array | Uint8Array | Uint16Array)[i] = v;
    }
    s.npu[i] = 0; s.tensorOps[i] = caps.gpuOps; s.kind[i] = 0; s.gpuLinked[i] = 0;
    for (const col of ['accelKind', 'accelCores', 'accelClockHz', 'accelVram', 'accelOps', 'accelTensorOps', 'accelIdleW', 'accelLoadW'] as const) {
      s[col].fill(0, i * MAX_ACCELS, (i + 1) * MAX_ACCELS);
    }
    if (caps.gpuOps > 0) {
      const p = i * MAX_ACCELS;
      s.accelKind[p] = 1; s.accelCores[p] = caps.gpuCores; s.accelClockHz[p] = caps.gpuOps / caps.gpuCores;
      s.accelVram[p] = caps.vram; s.accelOps[p] = caps.gpuOps; s.accelTensorOps[p] = caps.gpuOps;
    }
  }
  return { ...state, compiled };
}

/** One running system (round 1, tick 0) with the given caps. */
export function marketState(caps: Caps = BOOT_CAPS, spec: Partial<FleetSpec> = {}): GameState {
  const base = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, seed: 42, ...spec });
  const state = withCaps(base, caps);
  const hot = initialHot(state);
  return { ...state, hot, market: preparedMarket(hot, state.seed, state.round.index) };
}
