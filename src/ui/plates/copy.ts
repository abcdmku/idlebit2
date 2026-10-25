import { partName } from '../../game';
import type { CoolTech, FilterId, PartId, PartSlotKind, QueueStrategyId, RouteStrategyId, UnitKind } from '../../game';

/** Player-facing names and one-line notes. Copy only: no rule here decides anything. */

export const ROUTE_NAMES: Readonly<Record<RouteStrategyId, { name: string; short: string; note: string; blind: boolean }>> = {
  firstFit: { name: 'FIFO first-fit', short: 'FIFO', note: 'Server 1 first; if full, server 2, and so on.', blind: true },
  roundRobin: { name: 'Round robin', short: 'RR', note: 'Next server in turn. Blind to what it can run.', blind: true },
  leastConn: { name: 'Least connections', short: 'LC', note: 'Fewest tasks in flight. Blind to capability.', blind: true },
  weighted: { name: 'Weighted', short: 'WGT', note: 'Shares tasks by each server’s speed.', blind: true },
  leastWork: { name: 'Least work left', short: 'LW', note: 'Sends each task where the least work waits.', blind: true },
  binPack: { name: 'Bin packing', short: 'PACK', note: 'Fills busy servers so idle ones sleep.', blind: true },
  latency: { name: 'Latency-aware', short: 'LAT', note: 'Least backbone latency plus queue time.', blind: true },
  price: { name: 'Price-aware', short: 'PRICE', note: 'Cheapest energy that can take the task.', blind: true },
  affinity: { name: 'Workload affinity', short: 'AFF', note: 'GPU and big-memory work to accelerator servers first.', blind: false },
  linkAware: { name: 'Link-aware', short: 'LINK', note: 'Splits by what each link and server can absorb.', blind: true },
};

export const FILTER_NAMES: Readonly<Record<FilterId, { name: string; note: string }>> = {
  region: { name: 'Region filter', note: 'Only where the task may run.' },
  capability: { name: 'Capability-aware', note: 'Never sends a task where it cannot run.' },
  health: { name: 'Health checks', note: 'Skips units in an overload or crash countdown.' },
  power: { name: 'Power-aware', note: 'Skips units whose supply is near its limit.' },
  thermal: { name: 'Thermal-aware', note: 'Steers work off hot units.' },
  local: { name: 'Keep local', note: 'Keeps a task in one rack, zone or site when it fits there whole.' },
};

export const QUEUE_NAMES: Readonly<Record<QueueStrategyId, string>> = {
  fifo: 'FIFO', sjf: 'Shortest job first', timeSlice: 'Time slicing', priority: 'Priority', mlfq: 'Multilevel feedback',
};

export const COOL_TECH: Readonly<Record<CoolTech, string>> = { air: 'Air', water: 'Water', closedLoop: 'Closed loop' };

/** Plate title per part slot kind. */
export const SLOT_TITLE: Readonly<Record<PartSlotKind, string>> = {
  cpu: 'CPU', clock: 'Clock', l1: 'L1 cache', l2: 'L2 cache', l3: 'L3 cache', core: 'Core', scheduler: 'Scheduler', psu: 'Board PSU',
  ram: 'RAM', gpu: 'GPU', drive: 'Storage', rackCooler: 'Rack cooling', pdu: 'Rack PDU', lb: 'Load balancer', switch: 'Switch',
  roomCooler: 'Room cooling', roomLb: 'Room load balancer', roomSwitch: 'Network rack', ups: 'UPS', dataPlane: 'Data plane', grid: 'Site grid',
  backbone: 'Backbone link', globalScheduler: 'Global scheduler',
};

/** Noun for "New …" and "Add …" on the configuration plate. */
export const UNIT_NOUN: Readonly<Record<UnitKind | 'zone', string>> = { system: 'server', rack: 'rack', room: 'zone', zone: 'zone', site: 'site' };
export const COPY_FROM: Readonly<Record<UnitKind, string>> = {
  system: 'Copy a server in this rack', rack: 'Copy a rack in this room', room: 'Copy a zone at this site', site: 'Copy a site',
};

/** Barebones tier labels (TierId = CPU generation). */
export const TIER_LABELS = ['Hz', 'kHz', 'MHz', 'GHz', 'THz'] as const;
export const tierLabel = (tier: number) => TIER_LABELS[tier] ?? `Tier ${tier + 1}`;

/** A generation's display name from the catalog, e.g. "100 kHz switch". */
export const genName = (part: PartId, generation: number) => partName(part, generation);

/** Rack letters: A..Z, then numbers. */
export const rackLetter = (slot: number) => (slot < 26 ? String.fromCharCode(65 + slot) : String(slot + 1));
export const zoneLetter = (zone: number) => 'abcdef'[zone] ?? String(zone + 1);

/** A region's display name: "us-west" → "US West", "ap-southeast" → "AP Southeast" (A23). */
export function regionName(id: string): string {
  const [area = '', ...rest] = id.split('-');
  return [area.toUpperCase(), ...rest.map(w => w.charAt(0).toUpperCase() + w.slice(1))].join(' ');
}
