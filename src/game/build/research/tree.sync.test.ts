import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Keeps the generated reference research files in step with docs/research.md (§9 appendix, §5 effect
 * column). On drift this test fails; regenerate with:
 *   WRITE_TREE=1 npx vitest run src/game/build/research/tree.sync.test.ts
 */
const DOC = join(__dirname, '../../../../docs/research.md');
const DATA_FILE = join(__dirname, 'tree.data.ts');
const TEXT_FILE = join(__dirname, 'tree.text.ts');

const doc = readFileSync(DOC, 'utf8');
const appendix = doc.slice(doc.indexOf('## 9. Machine-readable appendix'));

const block = (name: string): string => {
  const match = appendix.match(new RegExp(`export const ${name}[^=]*= (\\{[\\s\\S]*?\\});`));
  if (!match) throw new Error(`docs/research.md §9: ${name} not found`);
  return match[1]!;
};
const nodeLines = appendix.split('\n').filter((line) => /^\s*n\("/.test(line)).map((line) => `  ${line.trim()}`);
const milestones = appendix.match(/export const MILESTONE_IDS = (\[[^\]]*\])/)![1]!;

const effectText = new Map<string, string>();
const shortText = new Map<string, string>();
const treeSection = doc.slice(doc.indexOf('## 5. The tree'), doc.indexOf('## 6.'));
for (const line of treeSection.split('\n')) {
  const cells = line.split('|').map((cell) => cell.trim());
  const id = cells[1]?.match(/^`([A-Za-z0-9]+)`$/)?.[1];
  if (id && cells.length >= 9) { effectText.set(id, cells[6]!); shortText.set(id, cells[7]!); }
}

const HEADER = '// GENERATED from docs/research.md by tree.sync.test.ts (WRITE_TREE=1). Do not edit by hand.';

const dataSource = `${HEADER}
import type { CeilingId, FilterId, PartId, PlacementId, ResearchEffect, RuleId, Scope, StrategyId, WorkTier } from '../../types/catalog';
import type { LevelId } from '../../types/ids';
import type { TreeRow } from './treeRow';

export const DATA_BY_TIER: Readonly<Record<WorkTier, number>> = ${block('DATA_BY_TIER')};
export const WORK_TIER_OPS: Readonly<Record<WorkTier, number>> = ${block('WORK_TIER_OPS')};
export const RESEARCH_CREDITS: Readonly<Record<string, string>> = ${block('RESEARCH_CREDITS')};
export const MILESTONE_DATA_FACTOR = 3;
export const MILESTONE_IDS: readonly string[] = ${milestones};

const gen = (part: PartId, g: number): ResearchEffect => ({ kind: 'gen', part, gen: g });
const cap = (key: CeilingId, value: number): ResearchEffect => ({ kind: 'ceiling', key, value });
const strat = (scope: Scope, id: StrategyId): ResearchEffect => ({ kind: 'strategy', scope, id });
const filt = (scope: Scope, id: FilterId): ResearchEffect => ({ kind: 'filter', scope, id });
const place = (scope: Scope, id: PlacementId): ResearchEffect => ({ kind: 'placement', scope, id });
const view = (level: LevelId): ResearchEffect => ({ kind: 'view', level });
/** Reference rule ids may precede runtime RULE_IDS; tree.ts applies deferred hardware overrides. */
const rule = (id: RuleId | (string & {}), params?: Record<string, number>): ResearchEffect => (params ? { kind: 'rule', id: id as RuleId, params } : { kind: 'rule', id: id as RuleId });
const chipGen = (g: number) => (['core', 'clock', 'l1', 'l2', 'l3', 'scheduler', 'cpu'] as const).map((p) => gen(p, g));
const n = (...row: TreeRow): TreeRow => row;

export const TREE_ROWS: readonly TreeRow[] = [
${nodeLines.join('\n')}
];
`;

const textSource = `${HEADER}
/** One-line effect per node, from the Effect column of docs/research.md §5. */
export const EFFECT_TEXT: Readonly<Record<string, string>> = {
${[...effectText].map(([id, text]) => `  ${id}: ${JSON.stringify(text)},`).join('\n')}
};

/** R45: the short effect line, at most about 40 characters, from the Short column of §5. */
export const SHORT_TEXT: Readonly<Record<string, string>> = {
${[...shortText].map(([id, text]) => `  ${id}: ${JSON.stringify(text)},`).join('\n')}
};
`;

const read = (file: string) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };

describe('research tree sync with docs/research.md', () => {
  if (process.env.WRITE_TREE === '1') {
    writeFileSync(DATA_FILE, dataSource);
    writeFileSync(TEXT_FILE, textSource);
  }
  it('finds 162 nodes in the appendix', () => expect(nodeLines.length).toBe(162));
  it('has an effect line for every node', () => {
    const ids = nodeLines.map((line) => line.match(/n\("([^"]+)"/)![1]!);
    expect(ids.filter((id) => !effectText.has(id))).toEqual([]);
  });
  it('has a short line of at most 40 characters for every node (R45)', () => {
    const ids = nodeLines.map((line) => line.match(/n\("([^"]+)"/)![1]!);
    expect(ids.filter((id) => !shortText.get(id) || shortText.get(id)!.length > 40)).toEqual([]);
  });
  it('tree.data.ts matches the doc', () => expect(read(DATA_FILE)).toBe(dataSource));
  it('tree.text.ts matches the doc', () => expect(read(TEXT_FILE)).toBe(textSource));
});
