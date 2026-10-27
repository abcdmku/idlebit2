import { G } from '../core/buffers';
import { MAX_UPS, REGIONS } from '../core/constants';
import { PRE_SYSTEM_CPU_W } from '../phys/draw';
import { supplyLossW } from '../phys/supplies';
import type { GameState } from '../types/state';
import { researchInputWatts, workProfile } from './workEnergy';

/** CPU work of one held thread per system, plus device idle draw, at saved sleep settings. */
export function marketResearchCpuEnergy(state: GameState): number {
  let cost = 0;
  state.build.systems.forEach((s, id) => {
    if (!s || state.compiled.sys.intent[id] !== 1) return;
    const c = state.compiled.sys, p = workProfile(c, id, s.spec, state.research.unlocks);
    const used = 1 / Math.max(1, c.threads[id] ?? 1);
    const watts = p.cpuIdle * (used + (1 - used) * p.sleep) + p.cpuLoad * used + p.otherIdle;
    const site = c.site[id] ?? 0, price = REGIONS[state.compiled.site.region[site] ?? 0]!.energyPrice;
    cost += (watts + supplyLossW(watts, p.cap, p.loss)) * price;
  });
  return cost;
}

/** Paused CPU research plus the currently observed cooling, networking and supply overhead. Credits/s. */
export function pausedResearchEnergy(state: GameState): number {
  const c = state.compiled, h = state.hot;
  const input = (w: number, cap: number, loss: number, enabled = true) => w + (enabled ? supplyLossW(w, cap, loss) : 0);
  const systemNow = (s: number) => input(h.sys.drawW[s] ?? 0, c.sys.psuCapW[s] ?? 0, c.sys.psuLoss[s] ?? 0, state.research.unlocks.levels.rack);
  const rackNow = (r: number) => input(h.rack.drawW[r] ?? 0, c.rack.pduCapW[r] ?? 0, c.rack.pduLoss[r] ?? 0, c.rack.opened[r] === 1);
  const upsLoss = (room: number, watts: number) => {
    let cap = 0, loss = 0;
    for (let u = 0; u < (c.room.upsCount[room] ?? 0); u += 1) {
      const at = room * MAX_UPS + u; cap += c.room.upsCapW[at] ?? 0; loss = Math.max(loss, c.room.upsLoss[at] ?? 0);
    }
    return c.room.opened[room] === 1 ? supplyLossW(watts, cap, loss) : 0;
  };
  const roomNow = (m: number) => (h.room.drawW[m] ?? 0) + upsLoss(m, h.room.drawW[m] ?? 0);
  const rackInputs = new Float64Array(c.rack.len), roomInputs = new Float64Array(c.room.len);
  state.build.racks.forEach((rack, r) => {
    if (!rack) return;
    let wanted = 0, current = 0;
    for (const s of rack.servers) {
      if (s === null) continue;
      current += systemNow(s);
      const sys = state.build.systems[s];
      if (!sys || c.sys.intent[s] !== 1) continue;
      wanted += state.research.unlocks.levels.system ? researchInputWatts(workProfile(c.sys, s, sys.spec, state.research.unlocks)) : PRE_SYSTEM_CPU_W;
    }
    const overhead = c.rack.opened[r] === 1 ? Math.max(0, (h.rack.drawW[r] ?? 0) - current) : 0;
    rackInputs[r] = input(wanted + overhead, c.rack.pduCapW[r] ?? 0, c.rack.pduLoss[r] ?? 0, c.rack.opened[r] === 1);
  });
  state.build.rooms.forEach((room, m) => {
    if (!room) return;
    let wanted = 0, current = 0;
    for (const r of room.racks) if (r !== null) { wanted += rackInputs[r] ?? 0; current += rackNow(r); }
    const watts = wanted + (c.room.opened[m] === 1 ? Math.max(0, (h.room.drawW[m] ?? 0) - current) : 0);
    roomInputs[m] = watts + upsLoss(m, watts);
  });
  let total = 0;
  state.build.sites.forEach((site, s) => {
    if (!site) return;
    let wanted = 0, current = 0;
    for (const m of site.zones) if (m !== null) { wanted += roomInputs[m] ?? 0; current += roomNow(m); }
    const watts = wanted + (c.site.opened[s] === 1 ? Math.max(0, (h.site.drawW[s] ?? 0) - current) : 0);
    total += input(watts, c.site.gridCapW[s] ?? 0, c.site.gridLoss[s] ?? 0, c.site.opened[s] === 1) * REGIONS[c.site.region[s] ?? 0]!.energyPrice;
  });
  return total + (h.g[G.utilityW] ?? 0) * REGIONS[c.site.region[0] ?? 0]!.energyPrice;
}
