import type { UnitRef } from '../types/ids';
import type { GameState } from '../types/state';
import type { FilterId, QueueStrategyId, RouteStrategyId } from '../types/catalog';

/** Shared display copy for routing controls, research and canvas LCDs. */
export const ROUTE_NAMES: Readonly<Record<RouteStrategyId, { name: string; short: string; note: string; blind: boolean }>> = {
  firstFit: { name: 'First fit', short: 'FIT', note: '', blind: true },
  roundRobin: { name: 'Round robin', short: 'RR', note: 'Next destination in turn.', blind: true },
  leastConn: { name: 'Least connections', short: 'LC', note: 'Fewest tasks in flight.', blind: true },
  weighted: { name: 'Weighted', short: 'WGT', note: 'Shares tasks by destination speed.', blind: true },
  leastWork: { name: 'Least work left', short: 'LW', note: 'Sends each task where the least work waits.', blind: true },
  binPack: { name: 'Bin packing', short: 'PACK', note: 'Fills busy destinations so idle ones sleep.', blind: true },
  latency: { name: 'Latency-aware', short: 'LAT', note: 'Least backbone latency plus queue time.', blind: true },
  price: { name: 'Price-aware', short: 'PRC', note: 'Cheapest energy that can take the task.', blind: true },
  affinity: { name: 'Workload affinity', short: 'AFF', note: 'GPU and big-memory work to accelerator hardware first.', blind: false },
  linkAware: { name: 'Link-aware', short: 'LINK', note: 'Splits by what each link and destination can absorb.', blind: true },
};

export const FILTER_NAMES: Readonly<Record<FilterId, { name: string; note: string }>> = {
  region: { name: 'Region-aware', note: 'Only where the task may run.' },
  capability: { name: 'Capability-aware', note: 'Never sends a task where it cannot run.' },
  health: { name: 'Health checks', note: 'Skips units in an overload or crash countdown.' },
  power: { name: 'Power-aware', note: 'Skips units whose supply is near its limit.' },
  thermal: { name: 'Thermal-aware', note: 'Steers work off hot units.' },
  local: { name: 'Zone-aware', note: 'Keeps a task in one rack, zone or site when it fits there whole.' },
};

export const QUEUE_NAMES: Readonly<Record<QueueStrategyId, string>> = {
  fifo: 'FIFO', sjf: 'Shortest job first', timeSlice: 'Time slicing', priority: 'Priority', mlfq: 'Multilevel feedback',
};

/** Unit letters use their position within the parent, never a saved id. */
export const rackLetter = (slot: number): string => slot < 26 ? String.fromCharCode(65 + slot) : String(slot + 1);
export const zoneLetter = rackLetter;

/** A region id in running text: "us-east" becomes "US East". */
export function regionName(id: string): string {
  const [area = '', ...rest] = id.split('-');
  return [area.toUpperCase(), ...rest.map(w => w.charAt(0).toUpperCase() + w.slice(1))].join(' ');
}

/** Short in-world name of a unit: "System", "Server 3", "Rack B", "Zone B", "EU West". */
export function unitLabel(state: GameState, unit: UnitRef): string {
  const b = state.build;
  switch (unit.kind) {
    case 'system': {
      const s = b.systems[unit.id];
      if (!s || !b.racks[s.rack]?.opened) return 'System';
      return `${s.spec.kind === 'storageNode' ? 'Storage' : 'Server'} ${s.slot + 1}`;
    }
    case 'rack': return `Rack ${rackLetter(b.racks[unit.id]?.slot ?? 0)}`;
    case 'room': return `Zone ${zoneLetter(b.rooms[unit.id]?.zone ?? 0)}`;
    case 'site': return b.sites[unit.id] ? regionName(b.sites[unit.id]!.region) : 'Site';
  }
}
