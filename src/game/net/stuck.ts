import type { CompiledBuffers } from '../core/buffers';
import { MAX_SHARDS } from '../core/constants';
import { eligibility } from '../core/modes';
import type { World } from '../core/world';
import { FAMILIES } from '../market/families';
import { DETAIL_CODE, gateOnClass, isEligibleMode } from '../market/fleet';
import { someSystem } from './metrics';
import { floorShards } from './floor';
import { GLOBAL } from './scope';

/** Calls `visit` for every live system below router (kind, id) until it returns true. */
function anySystemBelow(w: World, kind: number, id: number, visit: (s: number) => boolean): boolean {
  if (kind !== GLOBAL) return someSystem(w, kind + 1, id, visit);
  for (let site = 0; site < w.compiled.site.len; site += 1) if (someSystem(w, GLOBAL, site, visit)) return true;
  return false;
}

/**
 * Can some system below router (kind, id) ever run a piece of this entry (spec §6.3, static: modes
 * in the capability set, gates per shard)? 0 = yes, else the first failing gate (market/fleet
 * DETAIL code). The smallest piece the router could cut is `units` over every capable system below,
 * at most 256 and never below the effective grain of the task's `size`. A router-queue entry that
 * fails this can never dispatch, so it must not hold its queue (net/hops.ts).
 */
export function gateBelow(w: World, kind: number, id: number, family: number, units: number, size: number, whole: boolean): number {
  const m = ASKED[((id * 131 + kind * 7 + family * 31 + (whole ? 1 : 0)) >>> 0) % ASKED.length]!;
  if (m.kind === kind && m.id === id && m.family === family && m.units === units && m.size === size && m.whole === whole
    && m.compiled === w.compiled && m.mode === w.hot.sys.mode && m.changes === eligibility.changes) return m.gate;
  const gate = scanBelow(w, kind, id, family, units, size, whole);
  m.kind = kind; m.id = id; m.family = family; m.units = units; m.size = size; m.whole = whole;
  m.compiled = w.compiled; m.mode = w.hot.sys.mode; m.changes = eligibility.changes; m.gate = gate;
  return gate;
}

/**
 * The last answers, by router, family and `whole`. A blocked queue entry asks the same question
 * every tick it is tried again. The answer reads the compiled buffers (replaced, never written)
 * and which systems are in the capability set, so it stands while the buffers, the mode column and
 * the eligibility count are the same.
 */
interface Asked {
  kind: number; id: number; family: number; units: number; size: number; whole: boolean;
  compiled: CompiledBuffers | null; mode: Uint8Array | null; changes: number; gate: number;
}
const ASKED: Asked[] = Array.from({ length: 256 }, () => ({
  kind: -1, id: -1, family: -1, units: 0, size: 0, whole: false, compiled: null, mode: null, changes: -1, gate: 0,
}));

function scanBelow(w: World, kind: number, id: number, family: number, units: number, size: number, whole: boolean): number {
  const c = w.compiled, mode = w.hot.sys.mode, f = FAMILIES[family]!;
  const minSplit = whole && f.members > 1;
  let capable = 0, eligible = 0, first = 0;
  anySystemBelow(w, kind, id, (s) => {
    if (c.sys.kind[s] !== 0 || !isEligibleMode(mode[s]!)) return false;
    if (minSplit && c.rack.opened[c.sys.rack[s]!] !== 1) return false;
    eligible += 1;
    const gate = gateOnClass(c, s, f, 0);
    if (gate === 0) capable += 1; else if (first === 0) first = gate;
    return false;
  });
  // No system in the capability set: nothing to judge until one returns (a mode change wakes the router).
  if (eligible === 0) return 0;
  if (capable === 0) return first;
  if (minSplit && capable < f.members) return DETAIL_CODE.members;
  const grain = Math.max(1, f.grain, Math.ceil(size / MAX_SHARDS));
  const most = Math.min(capable, MAX_SHARDS, Math.max(1, Math.floor(units / grain)), Math.max(minSplit ? f.members : 1, floorShards(c, kind, id, family, units)));
  const piece = Math.ceil(units / most);
  let fit = false, sized = 0;
  anySystemBelow(w, kind, id, (s) => {
    if (c.sys.kind[s] !== 0 || !isEligibleMode(mode[s]!)) return false;
    const gate = gateOnClass(c, s, f, piece);
    if (gate === 0) { fit = true; return true; }
    if (sized === 0) sized = gate;
    return false;
  });
  return fit ? 0 : sized;
}
