import { FAMILIES, inputLoadAt } from '../market/families';
import { recipeTotals, workRecipe } from '../market/recipes';
import type { Amount } from '../amount';
import type { FamilyId } from '../types/ids';
import type { WorkTreeNode } from '../types/tasks';

export interface WorkBreakdownRow extends WorkTreeNode { readonly depth: number }

/** The complete recipe DAG, once per operation type, with exact cumulative repetition counts. */
export function selectTaskBreakdown(family: FamilyId, size: number): readonly WorkBreakdownRow[] {
  const def = FAMILIES[family]!, order: string[] = [], depths = new Map<string, number>(), visited = new Set<string>();
  const visit = (key: string, depth: number) => {
    depths.set(key, Math.min(depths.get(key) ?? Infinity, depth));
    if (visited.has(key)) return;
    visited.add(key);
    for (const part of workRecipe(key).parts) visit(part.key, depth + 1);
    order.push(key);
  };
  visit(def.key, 0);
  const counts = new Map<string, bigint>([[def.key, BigInt(size)]]);
  for (const key of [...order].reverse()) for (const part of workRecipe(key).parts)
    counts.set(part.key, (counts.get(part.key) ?? 0n) + (counts.get(key) ?? 0n) * BigInt(part.count));
  const rows = [...order].reverse().filter(key => key !== def.key).map(key => {
    const recipe = workRecipe(key), count = counts.get(key) ?? 0n;
    return { key, label: recipe.label, icon: recipe.icon, band: recipe.band, primitive: recipe.primitive !== null,
      count: count.toString() as Amount, ops: (BigInt(recipeTotals(key).ops) * count).toString() as Amount, depth: depths.get(key)! };
  });
  const load = BigInt(inputLoadAt(def, size));
  if (load > 0n) rows.unshift({ key: 'input-load', label: 'Input reads', icon: 'type:memory', band: null, primitive: true,
    count: load.toString() as Amount, ops: load.toString() as Amount, depth: 1 });
  return rows.length ? rows : [{ key: def.key, label: def.name, icon: def.key, band: def.band, primitive: true,
    count: BigInt(size).toString() as Amount, ops: (BigInt(recipeTotals(def.key).ops) * BigInt(size)).toString() as Amount, depth: 0 }];
}
