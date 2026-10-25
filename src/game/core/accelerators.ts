import type { FamilyDef } from '../types/catalog';
import type { CompiledBuffers, HotBuffers } from './buffers';
import { ACCEL_DOMAINS, MAX_ACCELS, POOL_DOMAIN } from './constants';

export interface AccelNeed {
  readonly required: boolean;
  readonly tensor: boolean;
  readonly gpuCores: number;
  readonly vramBits: number;
}
export interface AccelChoice {
  readonly domain: number;
  readonly take: number;
  readonly opsPerS: number;
}
/** One enabled physical device or the linked GPU pool. Rates remain paired with capacity. */
export interface AccelDomain {
  readonly kind: 'gpu' | 'npu';
  readonly gpuCores: number;
  readonly vramBits: number;
  readonly opsPerS: number;
  readonly tensorOpsPerS: number;
}
/** Matches market/fleet's gate-code positions without importing market or exec. */
export const ACCEL_GATE = { ok: 0, gpu: 3, gpuCores: 4, vram: 5 } as const;

export function accelNeed(family: FamilyDef, size: number): AccelNeed {
  return {
    required: family.stages.some((stage) => stage.resource === 'gpu'),
    tensor: family.tensor,
    gpuCores: family.gpuCoresMin,
    vramBits: family.vramBits.fixed + family.vramBits.perSize * size,
  };
}

export function readAccelDomain(c: CompiledBuffers, sys: number, domain: number): AccelDomain | null {
  if (!Number.isInteger(domain) || domain < 0 || domain >= ACCEL_DOMAINS || sys < 0 || sys >= c.sys.len) return null;
  const s = c.sys, linked = s.gpuLinked[sys] === 1;
  if (domain === POOL_DOMAIN) {
    if (!linked) return null;
    let gpuCores = 0, vramBits = 0, opsPerS = 0, tensorOpsPerS = 0, cards = 0;
    for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
      const p = sys * MAX_ACCELS + slot;
      if (s.accelKind[p] !== 1) continue;
      cards += 1; gpuCores += s.accelCores[p]!; vramBits += s.accelVram[p]!;
      opsPerS += s.accelOps[p]!; tensorOpsPerS += s.accelTensorOps[p]!;
    }
    return cards === 0 ? null : { kind: 'gpu', gpuCores, vramBits, opsPerS, tensorOpsPerS };
  }
  const p = sys * MAX_ACCELS + domain, kind = s.accelKind[p];
  if (kind !== 1 && kind !== 2 || kind === 1 && linked) return null;
  return {
    kind: kind === 1 ? 'gpu' : 'npu', gpuCores: kind === 1 ? s.accelCores[p]! : 0,
    vramBits: s.accelVram[p]!, opsPerS: kind === 1 ? s.accelOps[p]! : 0, tensorOpsPerS: s.accelTensorOps[p]!,
  };
}

const rateFor = (d: AccelDomain, n: AccelNeed): number => n.tensor ? d.tensorOpsPerS : d.opsPerS;
const permitted = (d: AccelDomain, n: AccelNeed): boolean => (d.kind === 'gpu' || n.tensor) && rateFor(d, n) > 0;

/** Static capacity ignores temporary holds. Busy compatible cards remain valid routing targets. */
export function accelGate(c: CompiledBuffers, sys: number, need: AccelNeed): number {
  if (!need.required) return ACCEL_GATE.ok;
  let hardware = false, cores = false;
  for (let domain = 0; domain < ACCEL_DOMAINS; domain += 1) {
    const d = readAccelDomain(c, sys, domain);
    if (!d || !permitted(d, need)) continue;
    hardware = true;
    if (d.gpuCores < need.gpuCores) continue;
    cores = true;
    if (d.vramBits >= need.vramBits) return ACCEL_GATE.ok;
  }
  return !hardware ? ACCEL_GATE.gpu : !cores ? ACCEL_GATE.gpuCores : ACCEL_GATE.vram;
}

/** Largest compatible uncontended rate wins; equal rates retain physical/domain order. */
export function chooseAccel(c: CompiledBuffers, hot: HotBuffers | null, sys: number, need: AccelNeed, maxTake: number): AccelChoice | null {
  if (!(maxTake >= 1)) return null;
  if (!need.required) return { domain: -1, take: Math.floor(maxTake), opsPerS: 0 };
  let best: AccelChoice | null = null;
  for (let domain = 0; domain < ACCEL_DOMAINS; domain += 1) {
    const d = readAccelDomain(c, sys, domain);
    if (!d || !permitted(d, need) || d.gpuCores < need.gpuCores || d.vramBits < need.vramBits) continue;
    const free = d.vramBits - (hot?.sys.accelUsedVram[sys * ACCEL_DOMAINS + domain] ?? 0);
    const take = Math.min(Math.floor(maxTake), need.vramBits > 0 ? Math.floor(free / need.vramBits) : Math.floor(maxTake));
    if (take < 1) continue;
    const opsPerS = rateFor(d, need);
    if (!best || opsPerS > best.opsPerS) best = { domain, take, opsPerS };
  }
  return best;
}
