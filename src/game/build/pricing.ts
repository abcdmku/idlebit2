import type { CpuBuild, PartLevel, RackConfig, RoomConfig, SiteConfig, SwitchBuild, SystemSpec } from '../types/build';
import {
  ECC_PRICE_FACTOR, EXTRA_CORE_GROWTH, EXTRA_UNIT_GROWTH, installPrice, ladderInstall, LADDERS, portAddPrice, networkStepsBetween,
  PARTS, scalePrice, SHELLS, upgradePrice, upgradesBetween, type CatalogRow, type LadderDef,
} from './catalog';
import { gpuInstallPrice } from './catalog/gpuModels';
import { lbQueueStepsTo } from './catalog/network';

/**
 * Prices of building things from nothing (spec §12.3, §13.3), whole Credits as bigint.
 * Extra units: the n-th unit of a kind (n ≥ 1 already present) costs install × growth^(n − 1).
 */
export const extraFactor = (n: number, growth = EXTRA_UNIT_GROWTH): number => (n >= 1 ? growth ** (n - 1) : 1);

/** Cores a CPU's clock drives (spec §12.3 `drive`, D34). */
export const cpuCores = (cpu: CpuBuild): number => cpu.cores.length;

export const partFromNothing = (row: CatalogRow, p: PartLevel, nth = 0, growth = EXTRA_UNIT_GROWTH, driven = 1): bigint =>
  scalePrice(installPrice(row, p.gen), extraFactor(nth, growth)) + upgradesBetween(row, p.gen, 1, p.level, driven);

/**
 * One CPU: package, cores (extra-core growth), clock (priced per core driven), caches. D34: Replace CPU passes
 * coreGrowth 1, since each core's growth surcharge was paid when it was added; moving cores to a new generation
 * costs that generation's core price per core.
 */
export function cpuPrice(cpu: CpuBuild, coreGrowth = EXTRA_CORE_GROWTH): bigint {
  let total = partFromNothing(PARTS.cpu, cpu.cpu);
  cpu.cores.forEach((core, n) => { total += partFromNothing(PARTS.core, core, n, coreGrowth); });
  total += partFromNothing(PARTS.clock, cpu.clock, 0, EXTRA_UNIT_GROWTH, cpuCores(cpu));
  total += partFromNothing(PARTS.l1, cpu.l1);
  if (cpu.l2) total += partFromNothing(PARTS.l2, cpu.l2);
  if (cpu.l3) total += partFromNothing(PARTS.l3, cpu.l3);
  return total;
}

/** A whole system spec: CPUs × count, scheduler, RAM (ECC × 1.25), accelerators, drives, PSU, storage chassis. */
export function systemSpecPrice(spec: SystemSpec): bigint {
  let total = spec.cpu ? cpuPrice(spec.cpu) * BigInt(spec.cpuCount) : 0n;
  if (spec.kind === 'storageNode') total += BigInt(SHELLS.storageNode.price);
  if (spec.scheduler) total += partFromNothing(PARTS.scheduler, spec.scheduler);
  spec.ram.forEach((m, n) => { total += scalePrice(partFromNothing(PARTS.ram, m, n), m.ecc ? ECC_PRICE_FACTOR : 1); });
  const seen = { gpu: 0, npu: 0 };
  for (const a of spec.accels) {
    total += a.kind === 'gpu'
      ? gpuInstallPrice(a.model, seen.gpu)
      : partFromNothing(PARTS.npu, a, seen.npu);
    seen[a.kind] += 1;
  }
  spec.drives.forEach((d, n) => { total += partFromNothing(PARTS.storage, d, n); });
  total += partFromNothing(PARTS.psu, spec.psu);
  return total;
}

/** A switch from nothing: install, extra ports and uplinks at its generation, every port step above base. */
export function switchPrice(row: LadderDef, sw: SwitchBuild): bigint {
  const g = sw.gen;
  let total = ladderInstall(row, g);
  for (let j = 1; j <= sw.ports.length - row.minPorts; j += 1) total += portAddPrice(row, g, j);
  for (let j = 1; j < sw.uplinks.length; j += 1) total += portAddPrice(row, g, j);
  for (const k of sw.ports) total += networkStepsBetween(row, row.baseK[g]!, k);
  for (const k of sw.uplinks) total += networkStepsBetween(row, row.baseK[g]!, k, true);
  return total;
}

/** Rows beyond the two a zone shell includes: the n-th row costs upgradePrice(row, L = n − 1). */
export const rowsPrice = (rows: number): bigint => upgradesBetween(PARTS.row, 0, 2, rows);
export const nextRowPrice = (rows: number): bigint => upgradePrice(PARTS.row, 0, rows);

export const shellPrice = (kind: keyof typeof SHELLS, paidSiblings: number): bigint =>
  scalePrice(BigInt(SHELLS[kind].price), SHELLS[kind].escalation ** paidSiblings);

export function rackConfigPrice(cfg: RackConfig): bigint {
  let total = shellPrice('rack', 0);
  total += partFromNothing(PARTS.rackCooler, cfg.cooler) + partFromNothing(PARTS.pdu, cfg.pdu) + partFromNothing(PARTS.lb, cfg.lb);
  total += lbQueueStepsTo('rack', cfg.lb.queueLevel) + switchPrice(LADDERS.switch, cfg.switch);
  for (const s of cfg.servers) if (s) total += systemSpecPrice(s.spec);
  return total;
}

/** A zone; `paidZones` = zones already bought in the target site (escalation). */
export function roomConfigPrice(cfg: RoomConfig, paidZones: number): bigint {
  let total = shellPrice('zone', paidZones) + rowsPrice(cfg.rows);
  total += switchPrice(LADDERS.roomSwitch, cfg.switch) + partFromNothing(PARTS.roomLb, cfg.lb) + partFromNothing(PARTS.roomCooler, cfg.cooler);
  total += lbQueueStepsTo('room', cfg.lb.queueLevel);
  for (const u of cfg.ups) total += partFromNothing(PARTS.ups, u);
  for (const r of cfg.racks) if (r) total += rackConfigPrice(r);
  return total;
}

/** A site; `paidSites` = sites already bought (escalation). Its data plane steps cost × zones. */
export function siteConfigPrice(cfg: SiteConfig, paidSites: number): bigint {
  const dp = LADDERS.dataPlane;
  const zones = Math.max(1, cfg.zones.filter((z) => z).length);
  let total = shellPrice('site', paidSites) + ladderInstall(dp, cfg.dataPlane.gen);
  total += networkStepsBetween(dp, dp.baseK[cfg.dataPlane.gen]!, cfg.dataPlane.k, false, zones);
  total += partFromNothing(PARTS.grid, cfg.grid) + lbQueueStepsTo('site', cfg.dataPlane.router.queueLevel);
  cfg.zones.forEach((z, n) => { if (z) total += roomConfigPrice(z, n); });
  return total;
}
