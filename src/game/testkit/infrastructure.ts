import type { GameState } from '../types/state';
import { MAX_UPS } from '../core/constants';

/** Synthetic capacity headroom for the maximum-population workload, not purchasable hardware.
 * Keep real component watts and loss fractions. D8's pushed G9990 fleet exceeds catalog infra
 * even at idle, and no legal build exceeds its PDU, UPS or grid (spec §9.2), so every hand-built
 * fleet gets supplies that carry it. `coolers: false` keeps the fixture's own coolers, for racks
 * that run hot. Takes a freshly built fixture, before any caller can share its compiled buffers.
 */
export function provisionInfrastructure(state: GameState, coolers = true): GameState {
  const c = state.compiled;
  const racks = new Float64Array(c.rack.len), rooms = new Float64Array(c.room.len), sites = new Float64Array(c.site.len);
  for (let s = 0; s < c.sys.len; s++) {
    let watts = c.sys.coreIdleW[s]! + 2 * c.sys.coreLoadW[s]! + c.sys.clockIdleW[s]!;
    for (let resource = 0; resource < 4; resource++) {
      const at = s * 4 + resource;
      watts += c.sys.idleW[at]! + c.sys.loadW[at]!;
    }
    const rack = c.sys.rack[s]!;
    racks[rack] = racks[rack]! + watts;
  }
  for (let r = 0; r < c.rack.len; r++) {
    const watts = racks[r]! + c.rack.coolerIdleW[r]! + 2 * c.rack.coolerLoadW[r]!;
    if (coolers) c.rack.coolerQc[r] = Math.max(c.rack.coolerQc[r]!, 4 * watts);
    c.rack.pduCapW[r] = Math.max(c.rack.pduCapW[r]!, 4 * watts);
    const room = c.rack.room[r]!;
    rooms[room] = rooms[room]! + watts * (1 + c.rack.pduLoss[r]!);
  }
  for (let m = 0; m < c.room.len; m++) {
    const watts = rooms[m]! + c.room.coolerIdleW[m]! + 2 * c.room.coolerLoadW[m]!;
    if (coolers) c.room.coolerQc[m] = Math.max(c.room.coolerQc[m]!, 4 * watts);
    // Each feed can carry the room alone, including its supply loss upstream.
    let loss = 0;
    for (let feed = 0; feed < c.room.upsCount[m]!; feed++) {
      const at = m * MAX_UPS + feed;
      c.room.upsCapW[at] = Math.max(c.room.upsCapW[at]!, 4 * watts);
      loss = Math.max(loss, c.room.upsLoss[at]!);
    }
    const site = c.room.site[m]!;
    sites[site] = sites[site]! + watts * (1 + loss);
  }
  for (let s = 0; s < c.site.len; s++) c.site.gridCapW[s] = Math.max(c.site.gridCapW[s]!, 4 * sites[s]!);
  return state;
}
