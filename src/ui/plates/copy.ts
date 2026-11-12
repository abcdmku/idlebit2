import { partName } from '../../game';
import type { CoolTech, FilterId, PartId, PartSlotKind, QueueStrategyId, RouteStrategyId, UnitKind } from '../../game';

/** Player-facing names and one-line notes. Copy only: no rule here decides anything. */

export { ROUTE_NAMES, FILTER_NAMES, QUEUE_NAMES, rackLetter, zoneLetter, regionName } from '../../game';

export const COOL_TECH: Readonly<Record<CoolTech, string>> = { air: 'Air', water: 'Water', closedLoop: 'Closed loop' };

/** Plate title per part slot kind. */
export const SLOT_TITLE: Readonly<Record<PartSlotKind, string>> = {
  cpu: 'CPU', clock: 'Clock', cache: 'Cache', core: 'Core', scheduler: 'Scheduler', psu: 'Power supply',
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

/** What a router's children are, for its copy: servers in a rack, racks in a zone, zones at a site, sites globally. */
export type RouteChild = 'server' | 'rack' | 'zone' | 'site';
const MANY: Readonly<Record<RouteChild, string>> = { server: 'servers', rack: 'racks', zone: 'zones', site: 'sites' };

/**
 * Spec §8.3 and §8.4 scope columns. Outside its scopes a strategy routes as First fit and a filter removes
 * nothing, so a router's plate offers neither there.
 */
export const routeInScope = (id: RouteStrategyId, child: RouteChild): boolean =>
  id === 'latency' || id === 'price' ? child === 'site' : id === 'linkAware' ? child !== 'server' : true;
export const filterInScope = (id: FilterId, child: RouteChild): boolean =>
  id === 'region' ? child === 'site' : id === 'thermal' || id === 'local' ? child !== 'server' : true;

/** What the selected network strategy does to a task's split (spec §8.3), in at most two plate lines. */
export function routeEffect(id: RouteStrategyId, child: RouteChild): string {
  const one = child, many = MANY[child];
  switch (id) {
    case 'firstFit': return `Equal shares to every ${one} with room, in order.`;
    case 'roundRobin': return `Equal shares. The first ${one} rotates each task.`;
    case 'leastConn': return `Emptiest ${many} first. Shares sized by free slots.`;
    case 'weighted': return `Shares sized by ${one} speed, to finish together.`;
    case 'leastWork': return 'Soonest finish first, counting backlog and links.';
    case 'binPack': return `Packs running slots first, so idle ${many} sleep.`;
    case 'linkAware': return `Shares sized by ${one} speed, capped by its uplink.`;
    case 'latency': return 'Whole task to the site with least latency and wait.';
    case 'price': return 'Whole task to the site with the cheapest energy.';
    case 'affinity': return 'Keeps accelerators free for GPU and big-memory work.';
  }
}

/** A filter's requirement (spec §8.4): a destination must pass every filter that is on. */
export function filterEffect(id: FilterId, child: RouteChild): string {
  switch (id) {
    case 'region': return "Task's region only";
    case 'capability': return 'Can run the task';
    case 'health': return 'No fault timer';
    case 'power': return 'Under 90% load';
    case 'thermal': return 'Under 90 °F';
    case 'local': return `One ${child} per task`;
  }
}

/** What a system queue order does (spec §8.1). */
export const QUEUE_EFFECT: Readonly<Record<QueueStrategyId, string>> = {
  fifo: 'Starts tasks in the order they were taken.',
  sjf: 'Shortest task first. Long tasks can wait.',
  timeSlice: 'Runs twice as many tasks, each one slower.',
  priority: 'Best payout per second starts first.',
  mlfq: 'Shortest first. A 3 s wait jumps the line.',
};

/** What a loading policy does with free cores (spec §6.4, D55). */
export const LOADING_EFFECT = {
  utilization: 'Start on free cores. Idle cores preload.',
  preload: 'Preload first. Tasks wait for all cores.',
} as const;
