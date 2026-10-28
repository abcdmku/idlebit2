import type { CompiledBuffers } from '../core/buffers';
import { canRunFleet, isEligibleMode } from '../market/fleet';
import type { FamilyDef } from '../types/catalog';
import type { GameState } from '../types/state';

interface CapabilityMemo {
  readonly eligible: Uint8Array;
  readonly gates: Map<FamilyDef, Map<number, number>>;
  entries: number;
}
const memos = new WeakMap<CompiledBuffers, CapabilityMemo>();

/** Hardware gates ignore load. Reuse them until hardware or the static capability set changes. */
export function fleetGates(state: GameState): (family: FamilyDef, size: number) => number {
  const c = state.compiled;
  let memo = memos.get(c);
  if (!memo) {
    memo = { eligible: new Uint8Array(c.sys.len), gates: new Map(), entries: 0 };
    memos.set(c, memo);
  }
  let changed = false, eligible = 0;
  for (let s = 0; s < c.sys.len; s += 1) {
    const next = c.sys.alive[s] === 1 && c.sys.kind[s] === 0 && isEligibleMode(state.hot.sys.mode[s]!) ? 1 : 0;
    if (memo.eligible[s] !== next) { memo.eligible[s] = next; changed = true; }
    eligible += next;
  }
  if (changed || memo.entries > 256) { memo.gates.clear(); memo.entries = 0; }
  // With no eligible server, every task has the same live outage reason. Read it once per queue snapshot.
  if (eligible === 0) {
    let outage: number | undefined;
    return (family, size) => outage ??= canRunFleet(state, family, size);
  }
  return (family, size) => {
    let sizes = memo.gates.get(family);
    const hit = sizes?.get(size);
    if (hit !== undefined) return hit;
    const gate = canRunFleet(state, family, size);
    if (!sizes) { sizes = new Map(); memo.gates.set(family, sizes); }
    sizes.set(size, gate); memo.entries += 1;
    return gate;
  };
}
