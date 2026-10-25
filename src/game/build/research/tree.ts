import type { CeilingId, FilterId, PartId, ResearchDef, RuleId, StrategyId } from '../../types/catalog';
import { researchId, type ResearchId } from '../../types/ids';
import { CREDITS_ONLY, CREDITS_PER_DATA, TREE_ROWS, WORK_TIER_OPS } from './tree.data';
import { amount } from '../../amount';
import { EFFECT_TEXT, SHORT_TEXT } from './tree.text';
import { deferredHardwareResearch } from './runtimeCompatibility';

const creditsOnly = new Set(CREDITS_ONLY);

/**
 * The research tree (docs/research.md §9). Work volume comes from the node's tier. D32: a node priced
 * D costs D Data plus 10 × D Credits; power, cooling and operations nodes cost the Credits only.
 */
export const RESEARCH: readonly ResearchDef[] = TREE_ROWS.map(([id, name, category, requires, level, era, tier, price, effects, answers]) => {
  const runtime = deferredHardwareResearch(id);
  return {
    id: researchId(id), name, category, requires: requires.map(researchId), level: level === 'cpu' ? 'chip' : level, era, tier,
    data: creditsOnly.has(id) ? 0 : price,
    work: WORK_TIER_OPS[tier], creditCost: amount((BigInt(price) * BigInt(CREDITS_PER_DATA)).toString()), effects: runtime?.effects ?? effects,
    effect: runtime?.effect ?? EFFECT_TEXT[id] ?? '', summary: SHORT_TEXT[id] ?? '', answers, implemented: true,
  };
});

const BY_ID = new Map<string, ResearchDef>(RESEARCH.map((node) => [node.id, node]));
/** Tree order index, used for deterministic effect merging. */
export const TREE_INDEX = new Map<string, number>(RESEARCH.map((node, i) => [node.id, i]));

export const researchDef = (id: ResearchId | string): ResearchDef | undefined => BY_ID.get(id);
export const effectText = (id: ResearchId | string): string => researchDef(id)?.effect ?? '';

/* ---------- Which node grants what (lock reasons name the first missing node) ---------- */

const genNode = new Map<string, ResearchDef>();
const ruleNode = new Map<RuleId, ResearchDef>();
const optionNode = new Map<string, ResearchDef>();
const ceilingNodes = new Map<CeilingId, { value: number; node: ResearchDef }[]>();
for (const node of RESEARCH) {
  for (const e of node.effects) {
    if (e.kind === 'gen' && !genNode.has(`${e.part}:${e.gen}`)) genNode.set(`${e.part}:${e.gen}`, node);
    else if (e.kind === 'rule' && !ruleNode.has(e.id)) ruleNode.set(e.id, node);
    else if ((e.kind === 'strategy' || e.kind === 'filter') && !optionNode.has(e.id)) optionNode.set(e.id, node);
    else if (e.kind === 'ceiling') {
      const list = ceilingNodes.get(e.key) ?? [];
      list.push({ value: e.value, node });
      ceilingNodes.set(e.key, list);
    }
  }
}
for (const list of ceilingNodes.values()) list.sort((a, b) => a.value - b.value);

export const nodeForGen = (part: PartId, gen: number): ResearchDef | null => genNode.get(`${part}:${gen}`) ?? null;
export const nodeForRule = (rule: RuleId): ResearchDef | null => ruleNode.get(rule) ?? null;
export const nodeForOption = (id: StrategyId | FilterId): ResearchDef | null => optionNode.get(id) ?? null;
/** The first node whose ceiling effect reaches `value`. */
export const nodeForCeiling = (key: CeilingId, value: number): ResearchDef | null =>
  ceilingNodes.get(key)?.find((c) => c.value >= value)?.node ?? null;
