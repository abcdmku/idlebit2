import type { World } from '../core/world';
import type { RuleId } from '../types/catalog';
import type { Unlocks } from '../types/state';

const sets = new WeakMap<Unlocks, ReadonlySet<RuleId>>();

/** O(1) research rule check, memoized per unlocks object (spec Appendix C rules). */
export function hasRule(w: World, id: RuleId): boolean {
  const unlocks = w.research.unlocks;
  let set = sets.get(unlocks);
  if (!set) sets.set(unlocks, (set = new Set(unlocks.rules)));
  return set.has(id);
}
