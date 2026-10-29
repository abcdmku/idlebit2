import { researchId as r } from '../../types/ids';
import type { CatalogRow } from './types';

/** Rack and room infrastructure (spec Appendix A.2, post-D5). Supplies draw only their loss. */
export const RACK_COOLER: CatalogRow = {
  id: 'rackCooler', scope: 'rack', names: ['Fan tray', 'High-flow air', 'Rear-door water', 'Direct-to-chip water'],
  gates: [r('rack'), r('rackAir2'), r('rackWater'), r('rackWater2')], curve: 'flow',
  // ×10 for the CSV energy ratio (hardware-progression.md §3): a native kHz server draws about 10× its old watts.
  base: [5e6, 5e7, 5e10, 5e13], watts: { kind: 'cooler', wpw: [0.01, 0.008, 0.004, 0.003] },
  tech: ['air', 'air', 'water', 'water'], tau: [60, 60, 6, 6],
  price: [2.4e6, 1.2e7, 4.3e11, 3.7e14], upgrade: [1.5e6, 1.5e6, 1.8e10, 9e13],
};
export const PDU: CatalogRow = {
  id: 'pdu', scope: 'rack', names: ['Basic PDU', 'Metered PDU', 'Switched PDU'], gates: [r('rack'), r('meteredPdu'), r('switchedPdu')],
  // Starter allocation is 1 view W. Rack exposes upgrades to this shared budget (D67).
  curve: 'flow', base: [1e6, 2e9, 5e15], watts: { kind: 'supply', loss: [0.04, 0.03, 0.02], lossPerLevel: 0.005 },
  price: [2.4e6, 1.2e7, 1.4e11], upgrade: [1.5e6, 1.5e6, 1.8e10],
};
/**
 * Load balancers have no routing capacity (D12.5): transfer speed is the only throttle. One
 * generation, no levels, a fixed idle draw **(s)**. D18.3 deleted the L4 and ASIC generations,
 * whose only effect was routing capacity. Strategies, filters and placements come from research.
 */
export const LB: CatalogRow = {
  id: 'lb', scope: 'rack', names: ['Load balancer'], gates: [r('rack')], curve: 'fixed',
  base: [0], watts: { kind: 'idle', idle: [160] }, price: [2.4e6], upgrade: [0],
};
export const ROOM_LB: CatalogRow = {
  id: 'roomLb', scope: 'room', names: ['Room load balancer'], gates: [r('room')], curve: 'fixed',
  base: [0], watts: { kind: 'idle', idle: [2560] }, price: [9.5e10], upgrade: [0],
};
/** Rows: linear, L = rows; 8 rack slots per row. The nth row costs upgradePrice(row, L = n − 1). */
export const ROW: CatalogRow = {
  id: 'row', scope: 'room', names: ['Row'], gates: [r('room')], curve: 'linear',
  base: [8], watts: { kind: 'idle', idle: [1e4] }, price: [0], upgrade: [2.4e11],
};
export const ROOM_COOLER: CatalogRow = {
  id: 'roomCooler', scope: 'room',
  names: ['CRAC', 'High-flow CRAC', 'Chilled water', 'High-delta chilled water', 'Closed loop', 'Two-phase closed loop'],
  gates: [r('room'), r('roomAir2'), r('chilledWater'), r('chilledWater2'), r('closedLoop'), r('closedLoop2')], curve: 'flow',
  base: [2e10, 2e11, 2e12, 2e14, 2e15, 2e16], watts: { kind: 'cooler', wpw: [2e-5, 1.6e-5, 8e-6, 6e-6, 4e-6, 3e-6] },
  tech: ['air', 'air', 'water', 'water', 'closedLoop', 'closedLoop'], tau: [300, 300, 30, 30, 30, 30],
  price: [9.5e10, 3.8e11, 7.1e11, 1.1e15, 6.7e15, 1.8e16], upgrade: [7e10, 7e10, 7e10, 3.7e14, 3.7e14, 1.5e15],
};
export const UPS: CatalogRow = {
  id: 'ups', scope: 'room', names: ['Standby UPS', 'Online UPS', 'Lithium UPS'], gates: [r('room'), r('upsOnline'), r('upsLithium')],
  curve: 'flow', base: [5e10, 2e11, 5e14], watts: { kind: 'supply', loss: [0.12, 0.06, 0.03], lossPerLevel: 0.005 },
  price: [9.5e10, 2.9e11, 6.7e15], upgrade: [7e10, 7e10, 3.7e14],
};
/**
 * D31.3 Power control, the fifth rack slot under the cooler: a battery (capacity J) and the rack start
 * controller, one part. L1 holds about 60 s of a filled era rack's measured draw (kHz: four Rack-era servers
 * at about 1.7e8 W, scripts/balance/powerctl.ts); capacity ×2 per level. Install ≈ 40 × capacity × the home
 * price (0.01 Credits/J), so a battery pays back in about 50 covered openings. Starting values **(s)**.
 */
export const POWER_CTL: CatalogRow = {
  id: 'powerCtl', scope: 'rack', names: ['Lead-acid power control', 'Li-ion power control', 'LFP power control'],
  gates: [r('powerCtl'), r('powerCtlLiIon'), r('powerCtlLfp')], curve: 'flow',
  base: [1e10, 2e12, 5e18], watts: { kind: 'idle', idle: [50, 500, 5000] },
  price: [4e9, 8e11, 2e18], upgrade: [2e9, 4e11, 1e18],
};
/** D31.2 room start controller on the UPS: no capacity; linear levels L1–5 cut the rack power-on time. **(s)** */
export const ROOM_START: CatalogRow = {
  id: 'roomStart', scope: 'room', names: ['Room start control', 'Predictive room start'], gates: [r('roomStart'), r('startPredict')],
  curve: 'linear', levelMax: 5, base: [1, 1], watts: { kind: 'idle', idle: [200, 200] },
  price: [5e10, 2e11], upgrade: [2e10, 2e10],
};
/** D31.2 global start controller on the scheduler: no capacity; linear levels L1–5 cut the site online time. **(s)** */
export const GLOBAL_START: CatalogRow = {
  id: 'globalStart', scope: 'global', names: ['Global start control', 'Predictive global start'], gates: [r('globalStart'), r('startPredict')],
  curve: 'linear', levelMax: 5, base: [1, 1], watts: { kind: 'idle', idle: [1000, 1000] },
  price: [1e15, 4e15], upgrade: [5e14, 5e14],
};
/**
 * D31.4 site generation (W output): solar and wind × the region's sun and wind factors; fuel cell and own
 * plant constant, with fuel at 0.4 and 0.25 × the region price. L1 is 10% of the gen-0 grid feed; ×2 per
 * level. Install ≈ 4 h × output × the home price; renewables 1.5× the fuel kinds. Starting values **(s)**.
 */
export const GENERATION: CatalogRow = {
  id: 'generation', scope: 'site', names: ['Solar farm', 'Wind farm', 'Fuel cell', 'Own plant'],
  gates: [r('solarFarm'), r('windFarm'), r('fuelCell'), r('ownPlant')], curve: 'flow',
  base: [1e14, 1e14, 1e14, 4e14], watts: { kind: 'idle', idle: [0, 0, 0, 0] },
  price: [2.16e16, 2.16e16, 1.44e16, 5.76e16], upgrade: [1.08e16, 1.08e16, 7.2e15, 2.88e16],
};
/** D31.4: generation fuel as a share of the region price (renewables burn none). */
export const GENERATION_FUEL = [0, 0, 0.4, 0.25] as const;
/** D31.2: wake latency by controller level (s): L1–5 give 2, 1.5, 1, 0.5, 0.25; above L5 0.25. */
export const wakeLatencyS = (level: number): number => [2, 1.5, 1, 0.5, 0.25][Math.min(5, Math.max(1, level)) - 1]!;
