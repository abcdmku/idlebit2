import type { CompiledBuffers } from '../core/buffers';
import { openWorld, type World } from '../core/world';
import { buildState, type FleetSpec } from '../testkit/builders';
import type { GameState } from '../types/state';
import { powerPhase } from './power';
import { thermalPhase } from './thermal';

/**
 * Test fixtures for phys: testkit fleets whose phys-relevant compiled columns are overwritten
 * with known numbers, so tests do not depend on catalog balance. Not imported by the sim.
 */
export function physState(spec: Partial<FleetSpec> = {}, edit?: (c: CompiledBuffers) => void): GameState {
  const state = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, round: 'running', ...spec });
  const c = state.compiled;
  for (let s = 0; s < c.sys.len; s += 1) {
    c.sys.cores[s] = 1;
    c.sys.coreIdleW[s] = 0; c.sys.coreLoadW[s] = 0; c.sys.clockIdleW[s] = 0; c.sys.clockLoadW[s] = 0;
    for (let r = 0; r < 4; r += 1) { c.sys.idleW[s * 4 + r] = 0; c.sys.loadW[s * 4 + r] = 0; }
    c.sys.psuCapW[s] = 0; c.sys.psuLoss[s] = 0;
  }
  for (let r = 0; r < c.rack.len; r += 1) {
    c.rack.pduCapW[r] = 0; c.rack.pduLoss[r] = 0; c.rack.lbIdleW[r] = 0; c.rack.lbLoadW[r] = 0;
    c.rack.coolerQc[r] = 0; c.rack.coolerIdleW[r] = 0; c.rack.coolerLoadW[r] = 0; c.rack.coolerTau[r] = 60; c.rack.leak[r] = 0.1;
  }
  for (let m = 0; m < c.room.len; m += 1) {
    c.room.upsCapW.fill(0); c.room.upsLoss.fill(0); c.room.lbIdleW[m] = 0; c.room.lbLoadW[m] = 0;
    c.room.coolerQc[m] = 0; c.room.coolerIdleW[m] = 0; c.room.coolerLoadW[m] = 0; c.room.coolerTau[m] = 300; c.room.leak[m] = 0.1;
  }
  for (let s = 0; s < c.site.len; s += 1) { c.site.gridCapW[s] = 0; c.site.gridLoss[s] = 0; }
  c.link.idleW.fill(0); c.link.loadW.fill(0);
  // Transfers land at the τ they start, and no drawn window joins in: tests put exact work at the queue front.
  c.sys.pipeSpeed.fill(Infinity); c.sys.pipeWPerBit.fill(0);
  edit?.(c);
  return { ...state, market: { ...state.market, window: [] } };
}

/** Runs the two phys phases for `n` ticks on a world, advancing its tick. Clears the bill each tick. */
export function physTicks(w: World, n: number, each?: (w: World) => void): void {
  for (let i = 0; i < n; i += 1) {
    w.hot.bill.fill(0);
    powerPhase(w);
    thermalPhase(w);
    each?.(w);
    w.tick += 1;
  }
}

export const physWorld = (state: GameState): World => openWorld(state);
