import { formatHertz } from '../format';
import { planPowerPart } from './powerParts';
import type { BoardPartKind } from '../types/actions';
import { GENERAL_MAX_GPUS, MAX_ACCELS } from '../core/constants';
import type { CpuBuild, PartLevel, SystemSpec } from '../types/build';
import type { PartRef, SystemId } from '../types/ids';
import type { GameState, Unlocks } from '../types/state';
import {
  capacity, ECC_PRICE_FACTOR, EXTRA_CORE_GROWTH, installPrice, isLadder, LADDERS, partName, PARTS, networkStepPrice,
  scalePrice, upgradePrice, upgradesBetween, gpuModel, ladderSpeed, type LeveledPartId,
} from './catalog';
import { ceilingLock, genLock, levelLock, maxLevel, ruleLock } from './locks';
import { coldScope, cpuCount, readPart, withSpec, writePart, POWER_SLOTS } from './partAccess';
import { coldScopes, fail, locked, planned, type Plan } from './plan';
import { cpuCores, cpuPrice, extraFactor } from './pricing';
import { newestGen } from './research/unlocks';
import { planGpuUpgrade } from './gpuPlans';

export function planReplaceCpu(state: GameState, system: SystemId): Plan {
  const spec = specOf(state, system);
  const cpu = spec?.cpu;
  if (!spec || !cpu) return fail('invalid', 'No CPU');
  const u = state.research.unlocks;
  const g = newestGen(u, 'cpu', PARTS.cpu.base.length);
  const label = `Replace CPU · ${partName('cpu', g)}`;
  if (g <= cpu.cpu.gen) return fail('invalid', 'Already the newest CPU', label);
  const keep = (id: LeveledPartId, p: PartLevel): PartLevel | null => {
    const row = PARTS[id];
    const need = capacity(row, p.gen, p.level);
    const top = maxLevel(u, id, g);
    for (let level = 1; level <= top; level += 1) if (capacity(row, g, level) >= need) return { gen: g, level };
    return null;
  };
  const cores = cpu.cores.map((c) => keep('core', c));
  const cache = keep('cache', cpu.cache);
  if (cores.some((c) => !c) || !cache) return fail('cap', 'A part would lose capacity', label);
  const next: CpuBuild = { cpu: { gen: g, level: 1 }, cores: cores as PartLevel[], clock: { gen: g, level: 1 }, cache };
  const price = cpuPrice(next, 1) * BigInt(spec.cpuCount);
  return planned({ build: withSpec(state.build, system, { ...spec, cpu: next }), price, cold: coldScopes(state, { kind: 'system', id: system }) }, label);
}

const specOf = (state: GameState, id: SystemId): SystemSpec | null => state.build.systems[id]?.spec ?? null;
const eccOf = (state: GameState, ref: PartRef): boolean =>
  ref.unit.kind === 'system' && ref.slot.kind === 'ram' ? specOf(state, ref.unit.id)?.ram[ref.slot.index]?.ecc ?? false : false;
/** D34: a clock's upgrades cost × the cores it drives. */
const drivenBy = (state: GameState, ref: PartRef): number =>
  ref.unit.kind === 'system' && ref.slot.kind === 'clock' ? cpuCores(specOf(state, ref.unit.id)?.cpu ?? { cores: [] } as unknown as CpuBuild) : 1;
/** Data plane steps cost × zones in the site (spec §12.5). */
const zonesOf = (state: GameState, ref: PartRef): number =>
  ref.unit.kind === 'site' ? Math.max(1, state.build.sites[ref.unit.id]?.zones.filter((z) => z !== null).length ?? 1) : 1;

/** Board slot limits (D7.3, D7.4, D7.6; a general board holds at most 2 GPUs). */
export function boardLimit(spec: SystemSpec, u: Unlocks, kind: 'socket' | 'ram' | 'gpu' | 'core' | 'drive'): number {
  const accel = spec.board === 'accelerator';
  switch (kind) {
    case 'socket': return accel ? 2 : Math.min(4, u.ceilings.cpuSockets);
    case 'ram': return accel ? 8 : Math.min(4, u.ceilings.ramSlots);
    case 'gpu': return accel ? MAX_ACCELS : Math.min(GENERAL_MAX_GPUS, u.ceilings.gpuSlots);
    case 'core': return Math.min(32, u.ceilings.coreSites);
    case 'drive': return u.ceilings.driveSlots;
  }
}

/** Hot level + 1 (spec §4.5). Chip parts apply to every CPU at price × CPU count (D7.3). */
export function planUpgrade(state: GameState, ref: PartRef): Plan {
  const part = readPart(state.build, ref);
  if (!part) return fail('invalid', 'No such part');
  if (part.id === 'gpu') return planGpuUpgrade(state, ref);
  const u = state.research.unlocks;
  if (isLadder(part.id)) {
    if (part.id === 'switch' || part.id === 'roomSwitch') return fail('invalid', 'Use the switch plate');
    const row = LADDERS[part.id];
    const k = part.level + 1;
    const label = `${partName(part.id, part.gen)} · ${formatHertz(ladderSpeed(k))}`;
    const price = networkStepPrice(row, part.level, false, zonesOf(state, ref));
    if (k > row.topK[part.gen]!) return locked({ code: 'ceiling', node: null, text: 'Max' }, label);
    const build = writePart(state.build, ref, part.gen, k)!;
    return planned({ build, price }, label);
  }
  const id = part.id as LeveledPartId;
  const ecc = eccOf(state, ref);
  const level = part.level + 1;
  const label = `${partName(id, part.gen)} · L${level}`;
  const price = scalePrice(upgradePrice(PARTS[id], part.gen, part.level, drivenBy(state, ref)) * BigInt(cpuCount(state.build, ref)), ecc ? ECC_PRICE_FACTOR : 1);
  const lock = levelLock(u, id, part.gen, level, ecc);
  if (lock) return locked(lock, label, price);
  return planned({ build: writePart(state.build, ref, part.gen, level)!, price }, label);
}

/**
 * Several levels at once (the blocked task's "Buy X" key): every level from the current one up to `level`,
 * atomically, for the summed price. Rejected at the first locked level; hot like a single upgrade.
 */
export function planUpgradeTo(state: GameState, ref: PartRef, level: number): Plan {
  const part = readPart(state.build, ref);
  if (!part) return fail('invalid', 'No such part');
  if (part.id === 'gpu' || part.id === 'core' || isLadder(part.id)) return fail('invalid', 'Upgrade this part one step at a time');
  if (!Number.isInteger(level) || level <= part.level) return fail('invalid', 'Already at that level');
  const id = part.id as LeveledPartId;
  const ecc = eccOf(state, ref);
  const label = `${partName(id, part.gen)} · L${part.level} → L${level}`;
  const driven = drivenBy(state, ref);
  let sum = 0n;
  for (let l = part.level; l < level; l += 1) {
    const lock = levelLock(state.research.unlocks, id, part.gen, l + 1, ecc);
    if (lock) return locked(lock, label, scalePrice(sum * BigInt(cpuCount(state.build, ref)), ecc ? ECC_PRICE_FACTOR : 1));
    sum += upgradePrice(PARTS[id], part.gen, l, driven);
  }
  const price = scalePrice(sum * BigInt(cpuCount(state.build, ref)), ecc ? ECC_PRICE_FACTOR : 1);
  return planned({ build: writePart(state.build, ref, part.gen, level)!, price }, label);
}

/**
 * Cold replace with generation g (spec §12.4): levelOne, or with `preserveCapacity` the lowest native
 * level whose primary capacity holds the current one, priced as install plus the upgrades to it.
 */
export function planReplace(state: GameState, ref: PartRef, g: number, preserveCapacity: boolean, minimumCapacity = 0): Plan {
  if (!Number.isFinite(minimumCapacity) || minimumCapacity < 0) return fail('invalid', 'Invalid capacity');
  if (POWER_SLOTS.includes(ref.slot.kind)) return planPowerPart(state, ref, g);
  const part = readPart(state.build, ref);
  if (!part) return fail('invalid', 'No such part');
  if (part.id === 'gpu') return fail('invalid', 'Choose a GPU model');
  if (isLadder(part.id)) return fail('invalid', 'Use the switch plate');
  const id = part.id as LeveledPartId;
  const row = PARTS[id];
  const u = state.research.unlocks;
  const label = partName(id, g);
  // User, 25 Oct: "you shouldnt be given a 'replace with' a lower tier". A replace only moves up.
  if (g <= part.gen || g >= row.base.length) return fail('invalid', 'Only a newer generation', label);
  const ecc = eccOf(state, ref);
  let level = 1;
  if ((preserveCapacity || minimumCapacity > 0) && row.curve !== 'fixed') {
    const need = Math.max(minimumCapacity, preserveCapacity ? capacity(row, part.gen, part.level) : 0);
    const top = maxLevel(u, id, g, ecc);
    while (level <= top && capacity(row, g, level) < need) level += 1;
    if (level > top) return fail('cap', 'Too small even at max level', label);
  }
  const driven = drivenBy(state, ref);
  const price = scalePrice((installPrice(row, g) + upgradesBetween(row, g, 1, level, driven)) * BigInt(cpuCount(state.build, ref)), ecc ? ECC_PRICE_FACTOR : 1);
  const lock = genLock(u, id, g);
  if (lock) return locked(lock, label, price);
  const build = writePart(state.build, ref, g, level)!;
  return planned({ build, price, cold: coldScopes(state, coldScope(ref), ref) }, preserveCapacity ? `${label} · L${level}` : label);
}

/** Add into an empty slot, always hot (spec §4.5, §6.1, §12.3). A new CPU copies CPU 1 (D7.3). Cores go into every CPU. */
export function planAdd(state: GameState, system: SystemId, kind: BoardPartKind, g: number, ecc = false): Plan {
  if (kind === 'gpu') return fail('invalid', 'Choose a GPU model');
  const spec = specOf(state, system);
  if (!spec) return fail('invalid', 'No such system');
  const u = state.research.unlocks;
  const n = spec.cpuCount;
  const cpu = spec.cpu;
  const commit = (next: SystemSpec, price: bigint, label: string, cap: { have: number; limit: number; key?: Parameters<typeof ceilingLock>[1] } | null, part: LeveledPartId | null): Plan => {
    if (part) { const lock = genLock(u, part, g); if (lock) return locked(lock, label, price); }
    if (cap && cap.have + 1 > cap.limit) {
      const lock = cap.key ? ceilingLock(u, cap.key, cap.have + 1) : null;
      return locked(lock ?? { code: 'cap', node: null, text: 'No free slot' }, label, price);
    }
    return planned({ build: withSpec(state.build, system, next), price }, label);
  };
  const levelOne: PartLevel = { gen: g, level: 1 };
  if (kind === 'socket') {
    if (!cpu) return fail('invalid', 'No CPU');
    return commit({ ...spec, cpuCount: n + 1 }, cpuPrice(cpu), `CPU ${n + 1}`, { have: n, limit: boardLimit(spec, u, 'socket'), key: 'cpuSockets' }, null);
  }
  if (kind === 'core') {
    if (!cpu) return fail('invalid', 'No CPU');
    const price = scalePrice(installPrice(PARTS.core, g), extraFactor(cpu.cores.length, EXTRA_CORE_GROWTH)) * BigInt(n);
    return commit({ ...spec, cpu: { ...cpu, cores: [...cpu.cores, levelOne] } }, price, `${partName('core', g)}`, { have: cpu.cores.length, limit: boardLimit(spec, u, 'core'), key: 'coreSites' }, 'core');
  }
  if (kind === 'scheduler') {
    if (spec.scheduler) return fail('occupied', 'Scheduler already built');
    return commit({ ...spec, scheduler: { ...levelOne, strategy: 'fifo' } }, installPrice(PARTS.scheduler, g), partName('scheduler', g), null, 'scheduler');
  }
  if (kind === 'ram') {
    const price = scalePrice(scalePrice(installPrice(PARTS.ram, g), extraFactor(spec.ram.length)), ecc ? ECC_PRICE_FACTOR : 1);
    if (ecc) { const lock = ruleLock(u, 'ecc'); if (lock) return locked(lock, 'ECC', price); }
    return commit({ ...spec, ram: [...spec.ram, { ...levelOne, ecc }] }, price, partName('ram', g), { have: spec.ram.length, limit: boardLimit(spec, u, 'ram'), key: 'ramSlots' }, 'ram');
  }
  if (kind === 'npu') {
    const have = spec.accels.filter((a) => a.kind === kind).length;
    const price = scalePrice(installPrice(PARTS[kind], g), extraFactor(have));
    return commit({ ...spec, accels: [...spec.accels, { ...levelOne, kind }] }, price, partName(kind, g), { have: spec.accels.length, limit: boardLimit(spec, u, 'gpu'), key: 'gpuSlots' }, kind);
  }
  const price = scalePrice(installPrice(PARTS.storage, g), extraFactor(spec.drives.length));
  return commit({ ...spec, drives: [...spec.drives, levelOne] }, price, partName('storage', g), { have: spec.drives.length, limit: boardLimit(spec, u, 'drive'), key: 'driveSlots' }, 'storage');
}

/** Cold remove, scrapped (spec §4.5). A CPU's package, clock, levelOne, last core and the PSU stay. */
export function planRemove(state: GameState, ref: PartRef): Plan {
  if (ref.unit.kind !== 'system') return fail('invalid', 'Only board parts can be removed');
  const id = ref.unit.id;
  const spec = specOf(state, id);
  if (!spec || !readPart(state.build, ref)) return fail('invalid', 'No such part');
  const slot = ref.slot;
  const cpu = spec.cpu;
  const drop = <T>(list: readonly T[], i: number) => list.filter((_, j) => j !== i);
  let next: SystemSpec | null = null;
  if (slot.kind === 'cpu' && spec.cpuCount > 1) next = { ...spec, cpuCount: spec.cpuCount - 1 };
  else if (slot.kind === 'core' && cpu && cpu.cores.length > 1) next = { ...spec, cpu: { ...cpu, cores: drop(cpu.cores, slot.index) } };
  else if (slot.kind === 'scheduler') next = { ...spec, scheduler: null };
  else if (slot.kind === 'ram') next = { ...spec, ram: drop(spec.ram, slot.index) };
  else if (slot.kind === 'gpu') next = { ...spec, accels: drop(spec.accels, slot.index) };
  else if (slot.kind === 'drive') next = { ...spec, drives: drop(spec.drives, slot.index) };
  if (!next) return fail('invalid', 'This part cannot be removed');
  return planned({ build: withSpec(state.build, id, next), price: 0n, cold: coldScopes(state, ref.unit, ref),
    ...(slot.kind === 'gpu' ? { kill: [ref.unit] } : {}) }, 'Remove');
}

/** Hot: every RAM module, GPU/NPU or drive of generation g one level up; price is the sum (spec §12.3). */
export function planUpgradeAll(state: GameState, system: SystemId, kind: 'ram' | 'gpu' | 'drive', g: number): Plan {
  const spec = specOf(state, system);
  if (!spec) return fail('invalid', 'No such system');
  const list = kind === 'ram' ? spec.ram : kind === 'gpu' ? spec.accels : spec.drives;
  let build = state.build;
  let price = 0n;
  let count = 0;
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index]!;
    const generation = 'kind' in entry && entry.kind === 'gpu' ? gpuModel(entry.model)!.generation - 1 : entry.gen;
    if (generation !== g) continue;
    const plan = planUpgrade({ ...state, build }, { unit: { kind: 'system', id: system }, slot: { kind, index } });
    if (!plan.ok) return plan;
    build = plan.change.build;
    price += plan.change.price;
    count += 1;
  }
  if (count === 0) return fail('invalid', 'Nothing of that generation');
  return planned({ build, price }, `Upgrade all ${count}`);
}

