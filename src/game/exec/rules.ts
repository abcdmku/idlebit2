import type { World } from '../core/world';
import type { RuleId } from '../types/catalog';
import type { Unlocks } from '../types/state';

const sets = new WeakMap<Unlocks, ReadonlySet<RuleId>>();
/** The last unlocks object asked about and its set: a tick asks many times of one object. */
let lastUnlocks: Unlocks | null = null, lastSet: ReadonlySet<RuleId> = new Set();

/** O(1) research rule check, memoized per unlocks object (spec Appendix C rules). */
export function hasRule(w: World, id: RuleId): boolean {
  const unlocks = w.research.unlocks;
  if (unlocks === lastUnlocks) return lastSet.has(id);
  let set = sets.get(unlocks);
  if (!set) sets.set(unlocks, (set = new Set(unlocks.rules)));
  lastUnlocks = unlocks; lastSet = set;
  return set.has(id);
}
