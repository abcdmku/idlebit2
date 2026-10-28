import type { CeilingId, FilterId, PartId, RuleId, StrategyId } from '../types/catalog';
import type { LockReason } from '../types/quotes';
import type { Unlocks } from '../types/state';
import { isLadder, LADDERS, levelMax, PARTS, type LeveledPartId } from './catalog';
import { genUnlocked, hasRule } from './research/unlocks';
import { nodeForCeiling, nodeForGen, nodeForOption, nodeForRule } from './research/tree';
import { MAX_SCHED_K, MAX_SCHED_Q } from '../core/constants';

/** Lock reasons name the first missing research node (spec §13.3), e.g. "Needs Rear-door water". */
const needs = (node: { id: LockReason['node'] & string; name: string } | null, fallback: string): LockReason =>
  ({ code: 'research', node: node?.id ?? null, text: `Needs ${node?.name ?? fallback}` });

export function genLock(u: Unlocks, part: PartId, g: number): LockReason | null {
  if (genUnlocked(u, part, g)) return null;
  const bits = u.gens[part] ?? 0;
  const missing = (bits & 1) === 0 && g > 0 ? 0 : g;
  return needs(nodeForGen(part, missing), 'research');
}

export function ceilingLock(u: Unlocks, key: CeilingId, value: number): LockReason | null {
  if (value <= u.ceilings[key]) return null;
  const node = nodeForCeiling(key, value);
  return node ? needs(node, key) : { code: 'cap', node: null, text: 'Max' };
}

export const ruleLock = (u: Unlocks, rule: RuleId): LockReason | null => (hasRule(u, rule) ? null : needs(nodeForRule(rule), 'research'));

export function optionLock(u: Unlocks, id: StrategyId | FilterId, kind: 'queue' | 'route' | 'filter'): LockReason | null {
  const have = kind === 'queue' ? (u.queueStrategies as readonly string[]) : kind === 'route' ? (u.routeStrategies as readonly string[])
    : (u.filters as readonly string[]);
  return have.includes(id) ? null : needs(nodeForOption(id), 'research');
}

/** Highest level a leveled part may reach: the curve range plus research bonuses (spec §12.1). */
export function maxLevel(u: Unlocks, part: LeveledPartId, g: number, ecc = false): number {
  if (part === 'gpu') return 6;
  const row = PARTS[part];
  const bonus = part === 'ram' && ecc ? u.ceilings.ramLevelBonus : part === 'l3' ? u.ceilings.l3LevelBonus : 0;
  let top = levelMax(row, g, bonus);
  if (part === 'scheduler') top = Math.min(top, Math.floor(MAX_SCHED_K / row.base[g]!), Math.ceil(MAX_SCHED_Q / (row.base2?.[g] ?? 1)));
  return top;
}

/** The lock that stops level `level` of a part: a ceiling or the end of the range. */
export function levelLock(u: Unlocks, part: PartId, g: number, level: number, ecc = false): LockReason | null {
  if (isLadder(part)) return level <= LADDERS[part].topK[g]! ? null : { code: 'ceiling', node: null, text: 'Max' };
  if (!(part in PARTS)) return { code: 'ceiling', node: null, text: 'Max' };
  const id = part as LeveledPartId;
  if (level <= maxLevel(u, id, g, ecc)) return null;
  const row = PARTS[id];
  if (id === 'ram' && ecc && level <= levelMax(row, g, 4)) return ceilingLock(u, 'ramLevelBonus', level - levelMax(row, g));
  if (id === 'l3' && level <= levelMax(row, g, 2)) return ceilingLock(u, 'l3LevelBonus', level - levelMax(row, g));
  return { code: 'ceiling', node: null, text: 'Max' };
}
