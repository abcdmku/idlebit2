import type { PartId, RuleId } from '../../types/catalog';
import type { Unlocks } from '../../types/state';

/** Pure reads of research unlocks. */
export const hasRule = (unlocks: Unlocks, rule: RuleId): boolean => unlocks.rules.includes(rule);
export const ruleParam = (unlocks: Unlocks, rule: RuleId, key: string, fallback: number): number =>
  unlocks.ruleParams[rule]?.[key] ?? fallback;
/** Generation g needs its own bit and generation zero's. NPU bits come from its explicit AND gates. */
export function genUnlocked(unlocks: Unlocks, part: PartId, g: number): boolean {
  // These native controllers are included with their container; no separate
  // generation research exists for them in the tree.
  if (g === 0 && (part === 'roomLb' || part === 'roomSwitch') && unlocks.levels.room) return true;
  if (g === 0 && part === 'globalScheduler' && (unlocks.gens.site & 1) !== 0) return true;
  const bits = unlocks.gens[part] ?? 0;
  return (bits & (1 << g)) !== 0 && (bits & 1) !== 0;
}
/** Highest buyable generation below `count`, or -1. */
export function newestGen(unlocks: Unlocks, part: PartId, count: number): number {
  for (let g = count - 1; g >= 0; g -= 1) if (genUnlocked(unlocks, part, g)) return g;
  return -1;
}
