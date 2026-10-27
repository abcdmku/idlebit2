import { partName } from '../../game';
import type { CoolTech, PartId, PartSlotKind, UnitKind } from '../../game';

/** Player-facing names and one-line notes. Copy only: no rule here decides anything. */

export { ROUTE_NAMES, FILTER_NAMES, QUEUE_NAMES, rackLetter, zoneLetter, regionName } from '../../game';

export const COOL_TECH: Readonly<Record<CoolTech, string>> = { air: 'Air', water: 'Water', closedLoop: 'Closed loop' };

/** Plate title per part slot kind. */
export const SLOT_TITLE: Readonly<Record<PartSlotKind, string>> = {
  cpu: 'CPU', clock: 'Clock', l1: 'L1 cache', l2: 'L2 cache', l3: 'L3 cache', core: 'Core', scheduler: 'Scheduler', psu: 'Power supply',
  ram: 'RAM', gpu: 'GPU', drive: 'Storage', rackCooler: 'Rack cooling', pdu: 'Rack PDU', lb: 'Load balancer', switch: 'Switch',
  roomCooler: 'Room cooling', roomLb: 'Room load balancer', roomSwitch: 'Network rack', ups: 'UPS', dataPlane: 'Data plane', grid: 'Site grid',
  backbone: 'Backbone link', globalScheduler: 'Global scheduler',
  powerCtl: 'Power control', roomStart: 'Room start control', globalStart: 'Global start control', generation: 'Generation',
};

/** Noun for "New …" and "Add …" on the configuration plate. */
export const UNIT_NOUN: Readonly<Record<UnitKind | 'zone', string>> = { system: 'server', rack: 'rack', room: 'zone', zone: 'zone', site: 'site' };
export const COPY_FROM: Readonly<Record<UnitKind, string>> = {
  system: 'Copy a server in this rack', rack: 'Copy a rack in this zone', room: 'Copy a zone at this site', site: 'Copy a site',
};

/** Barebones tier labels (TierId = CPU generation). */
export const TIER_LABELS = ['Hz', 'kHz', 'MHz', 'GHz', 'THz'] as const;
export const tierLabel = (tier: number) => TIER_LABELS[tier] ?? `Tier ${tier + 1}`;

/** A generation's display name from the catalog, e.g. "100 kHz switch". */
export const genName = (part: PartId, generation: number) => partName(part, generation);
