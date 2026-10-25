// Preview and test scenes that match the approved mockup's level stages and
// profiles. Hand-built snapshots; no sim code runs. Dev and tests only.
import { FAMILIES, familyId, systemId } from '../../../game';
import type { ChipSnapshot, CoreView, FamilyDef, GpuStats, PartRef, PartView, Quote, SupplyView, SystemSnapshot, TaskRequirementsView } from '../../../game';

const ID = systemId(0), PARENT = { level: 'system', id: ID } as const;
const core = (lanes: number, busy: boolean, progress: number, research = 0): CoreView => ({
  socket: 0, lanes, generation: 0, level: lanes, busy: busy ? 1 : 0, family: busy ? 0 : null, taskId: busy ? 380 + lanes : null,
  progress, threads: 1, research, cstate: 0,
});
export function chipScene(stage: 'boot' | 'chip' | 'system', online: ChipSnapshot['online'] = 'onMarket'): ChipSnapshot {
  if (stage === 'boot') return {
    level: 'chip', parent: null, systemId: ID, cpuCount: 1, online, tier: 0, psu: psu(0.65), clock: { hz: 1, effectiveHz: 1, generation: 0, level: 1 }, coreSites: 1,
    cores: [core(1, false, 0, 0.36)], cache: { levels: [{ kind: 'l1', bits: 1, generation: 0, level: 1 }], usedBits: 0, capacityBits: 1 },
    scheduler: null, queue: [], researchShare: 0.36, pipe: { speed: 1000, transfer: null, waiting: false }, slots: [{ kind: 'core', index: 1, locked: true }, { kind: 'scheduler', index: 0, locked: true }],
  };
  const sys = stage === 'system';
  return {
    level: 'chip', parent: sys ? PARENT : null, systemId: ID, cpuCount: 1, online, tier: 0, psu: psu(5.5),
    clock: { hz: sys ? 8 : 4, effectiveHz: sys ? 8 : 4, generation: 0, level: sys ? 4 : 3 }, coreSites: sys ? 4 : 2,
    cores: sys ? [core(3, true, 0.3), core(3, true, 0.6), core(2, false, 0, 0.4), core(2, true, 0.2)] : [core(2, false, 0, 0.51), core(1, false, 0, 0.51)],
    cache: { levels: [{ kind: 'l1', bits: sys ? 64 : 8, generation: 0, level: sys ? 7 : 4 }], usedBits: sys ? 32 : 0, capacityBits: sys ? 64 : 8 },
    scheduler: { generation: 0, level: sys ? 3 : 2, strategy: 'fifo', q: sys ? 8 : 4, queued: sys ? 3 : 0, k: sys ? 4 : 2, running: sys ? 3 : 0, reserved: 0 },
    queue: sys ? [{ taskId: 390, family: familyId(1) }, { taskId: 391, family: familyId(2) }, { taskId: 392, family: familyId(0) }] : [],
    researchShare: 0.5, pipe: { speed: 1000, transfer: null, waiting: false }, slots: sys ? [] : [{ kind: 'core', index: 2, locked: true }],
  };
}

const part = (kind: PartView['kind'], slot: number, level: number, active: boolean): PartView => ({ slot, kind, generation: 0, level, active, resourceBusy: active ? 1 : 0,
  ...(kind === 'ram' ? { capacityBits: 8192 * 2 ** (level - 1), rateBits: 1000 * level } : kind === 'drive' ? { capacityBits: 131072 * level, rateBits: 4 * level } : {}) });
/** Explicit native catalog row, not a second simulation or inferred model. */
export const GPU_SCENE_STATS: GpuStats = {
  model: '1330', generation: 1, series: 3, tier: 30, upgrades: 0, cores: 4, vramBits: 8192,
  clockHz: 1000, opsPerS: 4000, tensorOpsPerS: 4000, idleW: 200, loadW: 2000,
  efficiencyOpsPerJ: 4000 / 2200, maxUpgrades: 5,
};
const gpu = (slot: number, active: boolean, held = active ? 2048 : 0): PartView => ({ ...part('gpu', slot, 1, active), gpu: GPU_SCENE_STATS, vramUsedBits: held });
const psu = (deliveredW: number): SupplyView => ({
  kind: 'psu', generation: 0, level: 1, capacityW: 64, deliveredW, usage: deliveredW / 64, overloadS: 0, failed: false, rebootMs: null,
  loss: 0.3, lossW: deliveredW * 0.3, capped: false, capFactor: 1, creditsPerMinute: 0,
});
/** Freeze catalog facts at a chosen per-member size for hand-built scenes. */
export function sceneTaskRequirements(family: FamilyDef, size: number): TaskRequirementsView {
  return {
    family: family.id, label: family.name,
    stages: family.stages.map(s => ({ resource: s.resource, work: s.work.fixed + s.work.perSize * size })),
    threads: family.threads, workingSetBits: family.workingSet.fixed + family.workingSet.perSize * size,
    gpuCoresMin: family.gpuCoresMin, vramBits: family.vramBits.fixed + family.vramBits.perSize * size,
    storageBits: family.storageBits.fixed + family.storageBits.perSize * size,
    members: family.members, minZones: family.minZones, region: family.region.kind === 'in' ? family.region.region : null,
    ecc: family.ecc, tensor: family.tensor,
  };
}
const RAM_TASK = sceneTaskRequirements(FAMILIES.find(f => f.key === 'mergeSort')!, 16);
const ACCEL_RAM_TASK = sceneTaskRequirements(FAMILIES.find(f => f.key === 'thumbnail')!, 2048);
const GPU_TASK = sceneTaskRequirements(FAMILIES.find(f => f.key === 'imageBlur')!, 2048);

export function systemScene(stage: 'boot' | 'system' | 'full', online: SystemSnapshot['online'] = 'onMarket'): SystemSnapshot {
  const boot = stage === 'boot', full = stage === 'full';
  return {
    level: 'system', parent: null, systemId: ID, kind: 'server', board: full ? 'accelerator' : 'general', cpuCount: 1,
    ramSlots: full ? 8 : boot ? 1 : 4, etaCfg: 1, chip: chipScene(boot ? 'boot' : 'system', online), cpuBusy: [boot ? 0 : 0.75],
    online, timerS: online === 'boot' ? 6 : null, timerTotalS: online === 'boot' ? 10 : null,
    cpu: part('cpu', 0, 1, true),
    ram: boot ? [] : full ? [0, 1, 2, 3, 4, 5].map(i => part('ram', i, 2, i < 2)) : [part('ram', 0, 2, true), part('ram', 1, 2, true)],
    gpu: boot ? [] : full ? Array.from({ length: 8 }, (_, i) => gpu(i, i === 6, i === 0 || i === 6 ? 2048 : 0)) : [gpu(0, false)],
    storage: boot ? [] : full ? [0, 1, 2, 3].map(i => part('drive', i, 3, i === 1)) : [part('drive', 0, 1, false)],
    psu: psu(boot ? 0.65 : 5.5),
    running: boot ? [] : full ? [
      { ...ACCEL_RAM_TASK, key: 1, count: 1, stage: 1, resource: 'ram', progress: 0.45, deadlineTick: null, accelDomain: 0 },
      { ...GPU_TASK, key: 2, count: 1, stage: 1, resource: 'gpu', progress: 0.85, deadlineTick: null, accelDomain: 6 },
    ] : [{ ...RAM_TASK, key: 1, count: 1, stage: 1, resource: 'ram', progress: 0.45, deadlineTick: null, accelDomain: null }],
    queue: { cap: 8, count: 3, sample: [] }, reserved: 0, rates: { ops: 8, ramBits: 4, gpuOps: 0, ioBits: 0 },
    capacities: { cache: 64, ram: 256, vram: 0, storage: 0 }, used: { memory: 32, vram: 0, storage: 0 }, drawW: 5.5, saveable: !boot,
    slots: boot ? [{ kind: 'ram', index: 0, locked: true }, { kind: 'drive', index: 0, locked: true }, { kind: 'gpu', index: 0, locked: true }]
      : full ? [] : [{ kind: 'ram', index: 2, locked: true }, { kind: 'gpu', index: 1, locked: true }, { kind: 'drive', index: 1, locked: true }],
  };
}

/** A tray quote that upgrades a chip block or board part. */
export function upgradeQuote(slot: PartRef['slot'], affordable: boolean): Quote {
  return {
    action: { type: 'upgradePart', part: { unit: { kind: 'system', id: ID }, slot } }, label: 'Upgrade', cost: '10' as Quote['cost'], currency: 'credits',
    affordable, locked: null, cold: false, downtimeMs: 0, effect: null, workOps: null,
  };
}
