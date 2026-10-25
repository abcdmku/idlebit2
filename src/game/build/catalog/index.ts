import type { PartId } from '../../types/catalog';
import { RAM, GPU, NPU, PSU, STORAGE } from './board';
import { CLOCK, CORE, CPU, L1, L2, L3, SCHEDULER } from './chip';
import { GENERATION, GLOBAL_START, LB, PDU, POWER_CTL, RACK_COOLER, ROOM_COOLER, ROOM_LB, ROOM_START, ROW, UPS } from './infra';
import { BACKBONE, DATA_PLANE, ROOM_SWITCH, SWITCH } from './network';
import { GLOBAL_SCHEDULER, GRID } from './site';

export * from './curves';
export * from './gpuModels';
export { portSpeedPrice } from './network';
export type { NetworkLadderDef } from './network';
export type { CatalogRow, LadderDef, WattsRule } from './types';
import type { CatalogRow } from './types';
export { SHELLS } from './site';
export { TIER_COUNT, TIER_NAMES, tierName } from './tiers';

/** Leveled parts by id. */
export const PARTS = {
  cpu: CPU, core: CORE, clock: CLOCK, l1: L1, l2: L2, l3: L3, scheduler: SCHEDULER,
  ram: RAM, gpu: GPU, npu: NPU, storage: STORAGE, psu: PSU,
  rackCooler: RACK_COOLER, pdu: PDU, lb: LB, roomLb: ROOM_LB, row: ROW, roomCooler: ROOM_COOLER, ups: UPS,
  grid: GRID, globalScheduler: GLOBAL_SCHEDULER,
  powerCtl: POWER_CTL, roomStart: ROOM_START, globalStart: GLOBAL_START, generation: GENERATION,
} as const satisfies Partial<Record<PartId, CatalogRow>>;
export type LeveledPartId = keyof typeof PARTS;

/** Port-ladder parts by id. */
export const LADDERS = { switch: SWITCH, roomSwitch: ROOM_SWITCH, dataPlane: DATA_PLANE, backbone: BACKBONE } as const;
export type LadderPartId = keyof typeof LADDERS;

export const isLadder = (part: PartId): part is LadderPartId => part in LADDERS;
export const isLeveled = (part: PartId): part is LeveledPartId => part in PARTS;

/** Number of generations a part has (shells have one). */
export const genCount = (part: PartId): number =>
  isLeveled(part) ? PARTS[part].base.length : isLadder(part) ? LADDERS[part].baseK.length : 1;

const SHELL_NAMES: Partial<Record<PartId, string>> = { rack: 'Rack frame', storageNode: 'Storage node', zone: 'Zone', site: 'Site' };

/** Display name of a part generation (R12), e.g. "kHz core", "Rear-door water". */
export function partName(part: PartId, generation: number): string {
  const names = isLeveled(part) ? PARTS[part].names : isLadder(part) ? LADDERS[part].names : null;
  return names?.[generation] ?? SHELL_NAMES[part] ?? `Gen ${generation}`;
}
