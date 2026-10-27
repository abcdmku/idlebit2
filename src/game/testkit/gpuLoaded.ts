import { G } from '../core/buffers';
import { MAX_ACCELS } from '../core/constants';
import { barebonesSystem } from '../core/defaults';
import { allocRecord } from '../core/pool';
import { compileAll } from '../core/topology';
import { commitWorld, openWorld } from '../core/world';
import { enqueue } from '../exec/alloc';
import { noteAdmitted } from '../exec/slots';
import { FAMILIES, payoutAt } from '../market/families';
import type { GameState } from '../types/state';
import { buildState } from './builders';

/** Synthetic pre-admitted work, not a campaign. Actual catalog specs, no compiled overrides.
 * Each ray-trace task fills one G1590 card's HBM VRAM.
 * Eight independent cards/system keep all 18-clock scans and all physical duty columns relevant.
 */
export function gpuLoadedState(fullFleet = false): GameState {
  const base = buildState({
    seed: 42, sites: fullFleet ? 8 : 1, zonesPerSite: fullFleet ? 3 : 1,
    racksPerZone: fullFleet ? 24 : 1, serversPerRack: fullFleet ? 12 : 1,
    unlocks: 'max', credits: '1000000000000000000000000000000',
    system: (id, rack, slot) => {
      const bare = barebonesSystem(id, rack, slot);
      return { ...bare, spec: { ...bare.spec, board: 'accelerator',
        cpu: { ...bare.spec.cpu!, cores: Array.from({length:8},()=>({gen:0,level:1})) },
        scheduler: { gen: 1, level: 4, strategy: 'fifo' },
        accels: Array.from({ length: MAX_ACCELS }, () => ({ kind: 'gpu', model: '1590' })),
        psu: { gen: 4, level: 1, capped: false },
      } };
    },
    // D8 card watts: one G1590 server draws about 14 MW, a full rack about 0.17 GW. These real
    // catalog tiers leave headroom, so every card stays powered and every lump stays cool.
    rack: (r) => ({ ...r, cooler: { gen: 2, level: 1, setpointF: 70 }, pdu: { gen: 2, level: 1, capped: false } }),
    room: (m) => ({ ...m, cooler: { gen: 2, level: 1, setpointF: 70 }, ups: [{ gen: 2, level: 1, capped: false }] }),
  });
  // Independent cards exercise real concurrency; keep all other fixture unlocks unchanged.
  const research = { ...base.research, completed: base.research.completed.filter((id) => id !== 'gpuLink'), unlocks: { ...base.research.unlocks,
    rules: base.research.unlocks.rules.filter((rule) => rule !== 'gpuLink') } };
  // Compilation must observe the independent-domain setting before any work is admitted.
  const w = openWorld({ ...base, research, compiled: compileAll(base.build, research) });
  const family = FAMILIES.find((f) => f.key === 'rayTrace')!;
  const scale = 2 ** 23;
  for (let sys = 0; sys < w.compiled.sys.len; sys++) for (let slot = 0; slot < MAX_ACCELS; slot++) {
    const r = allocRecord(w.hot), rec = w.hot.rec;
    rec.family[r] = family.id; rec.count[r] = 1; rec.units[r] = scale;
    rec.stage[r] = 0;
    rec.taskId[r] = w.hot.g[G.nextTaskId]!; w.hot.g[G.nextTaskId] = w.hot.g[G.nextTaskId]! + 1;
    rec.payout[r] = payoutAt(family, scale);
    enqueue(w, sys, r); noteAdmitted(w, sys, 1);
  }
  // The synthetic card load is the only work: no drawn queue joins in, so no head can time out on full slots.
  w.market.window = [];
  return commitWorld(base, w, 0);
}
