import type { CompiledBuffers } from '../core/buffers';
import { MAX_UPS, secondsToTicks } from '../core/constants';
import type { BuildState, CoolerBuild, RouterBuild } from '../types/build';
import { FILTER_IDS, ROUTE_STRATEGY_IDS, type CoolTech } from '../types/catalog';
import { ROUTER_QUEUE_MAX } from '../core/constants';
import type { Unlocks } from '../types/state';
import { capacity, ladderSpeed, LADDERS, lossFraction, PARTS, partWatts, type CatalogRow } from './catalog';
import { hasRule, ruleParam } from './research/unlocks';

/*
 * Rack, room, site and global columns (spec §7, §9.2, §10.5):
 *   cooler*      Qc = base × x; tau by generation; idle/load W at level; tech 0 air, 1 water, 2 closed loop
 *   setpointF    the build's setpoint; hasSetpoint when rackSetpoint / roomSetpoint is researched
 *   leak         rack 0.1 × the roomLeak factor (hotColdAisle 0.6, containment 0.5); room 0.1
 *   *CapW, *Loss supply capacity W and final loss fraction (lossPerLevel folded in)
 *   lbStrategy   index in ROUTE_STRATEGY_IDS; lbFilters bit mask (no routing capacity, D12.5)
 *   lbQueueSlots the router queue's level L, 1–32 (D25.7)
 *   ports, uplinks  switch counts; 0 for a hidden container (no network before its level opens)
 *   dpSpeed, dpLatencyTicks  data plane k → bit/s; generation latency in whole ticks
 */
const TECH: Record<CoolTech, number> = { air: 0, water: 1, closedLoop: 2 };
const LEAK = 0.1;

type CoolerCols = Pick<CompiledBuffers['rack'], 'coolerQc' | 'coolerTau' | 'coolerIdleW' | 'coolerLoadW' | 'coolerTech' | 'setpointF' | 'hasSetpoint' | 'leak'>;
type RouterCols = Pick<CompiledBuffers['rack'], 'lbStrategy' | 'lbFilters' | 'lbQueueSlots' | 'lbIdleW' | 'lbLoadW'>;

/** A router's queue level as a compiled byte (D25.7). */
export const queueSlots = (lb: RouterBuild): number => Math.max(1, Math.min(ROUTER_QUEUE_MAX, Math.floor(lb.queueLevel || 1)));

const mask = <T extends string>(ids: readonly T[], on: readonly T[]) => on.reduce((m, id) => m | (1 << ids.indexOf(id)), 0);

function writeCooler(t: CoolerCols, i: number, row: CatalogRow, cooler: CoolerBuild, setpoint: boolean, leak: number): void {
  t.coolerQc[i] = capacity(row, cooler.gen, cooler.level);
  t.coolerTau[i] = row.tau![cooler.gen]!;
  const w = partWatts(row, cooler.gen, cooler.level);
  t.coolerIdleW[i] = w.idle;
  t.coolerLoadW[i] = w.load;
  t.coolerTech[i] = TECH[row.tech![cooler.gen]!];
  t.setpointF[i] = cooler.setpointF;
  t.hasSetpoint[i] = setpoint ? 1 : 0;
  t.leak[i] = leak;
}

export function writeRouter(t: RouterCols, i: number, row: CatalogRow, lb: RouterBuild): void {
  t.lbStrategy[i] = ROUTE_STRATEGY_IDS.indexOf(lb.strategy);
  t.lbFilters[i] = mask(FILTER_IDS, lb.filters);
  t.lbQueueSlots[i] = queueSlots(lb);
  const w = partWatts(row, lb.gen, lb.level);
  t.lbIdleW[i] = w.idle;
  t.lbLoadW[i] = w.load;
}

export function compileInfra(c: CompiledBuffers, build: BuildState, u: Unlocks): void {
  const rackLeak = LEAK * ruleParam(u, 'roomLeak', 'factor', 1);
  for (const rack of build.racks) {
    if (!rack) continue;
    const i = rack.id;
    const t = c.rack;
    writeCooler(t, i, PARTS.rackCooler, rack.cooler, hasRule(u, 'rackSetpoint'), rackLeak);
    t.pduCapW[i] = capacity(PARTS.pdu, rack.pdu.gen, rack.pdu.level);
    t.pduLoss[i] = lossFraction(PARTS.pdu, rack.pdu.gen, rack.pdu.level);
    t.pduCapSwitch[i] = rack.pdu.capped && hasRule(u, 'powerCap') ? 1 : 0;
    writeRouter(t, i, PARTS.lb, rack.lb);
    t.ports[i] = rack.opened ? rack.switch.ports.length : 0;
    t.uplinks[i] = rack.opened ? rack.switch.uplinks.length : 0;
  }
  for (const room of build.rooms) {
    if (!room) continue;
    const i = room.id;
    const t = c.room;
    writeCooler(t, i, PARTS.roomCooler, room.cooler, hasRule(u, 'roomSetpoint'), LEAK);
    t.upsCount[i] = room.ups.length;
    for (let k = 0; k < MAX_UPS; k += 1) {
      const ups = room.ups[k];
      t.upsCapW[i * MAX_UPS + k] = ups ? capacity(PARTS.ups, ups.gen, ups.level) : 0;
      t.upsLoss[i * MAX_UPS + k] = ups ? lossFraction(PARTS.ups, ups.gen, ups.level) : 0;
      t.upsGen[i * MAX_UPS + k] = ups ? ups.gen : 0;
    }
    writeRouter(t, i, PARTS.roomLb, room.lb);
    t.ports[i] = room.opened ? room.switch.ports.length : 0;
    t.uplinks[i] = room.opened ? room.switch.uplinks.length : 0;
  }
  for (const site of build.sites) {
    if (!site) continue;
    const i = site.id;
    const t = c.site;
    t.gridCapW[i] = capacity(PARTS.grid, site.grid.gen, site.grid.level);
    t.gridLoss[i] = lossFraction(PARTS.grid, site.grid.gen, site.grid.level);
    const dp = site.dataPlane;
    t.dpSpeed[i] = ladderSpeed(dp.k);
    t.dpLatencyTicks[i] = secondsToTicks(LADDERS.dataPlane.latency[dp.gen]!);
    t.dpStrategy[i] = ROUTE_STRATEGY_IDS.indexOf(dp.router.strategy);
    t.dpFilters[i] = mask(FILTER_IDS, dp.router.filters);
    t.dpQueueSlots[i] = queueSlots(dp.router);
  }
  const g = build.global.scheduler;
  if (g) writeRouter(c.global, 0, PARTS.globalScheduler, g);
}
