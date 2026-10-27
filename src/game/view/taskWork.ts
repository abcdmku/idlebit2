import type { Amount } from '../amount';
import { FAMILIES, inputLoadAt, payoutCreditsAt } from '../market/families';
import { recipeTotals, workRecipe } from '../market/recipes';
import type { FamilyId } from '../types/ids';
import type { TaskWorkTree, WorkTreeNode } from '../types/tasks';

const whole = (value: bigint): Amount => value.toString() as Amount;
function node(key: string, count: bigint): WorkTreeNode {
  const recipe = workRecipe(key);
  return { key, label: recipe.label, icon: recipe.icon, band: recipe.band, count: whole(count),
    ops: whole(BigInt(recipeTotals(key).ops) * count), primitive: recipe.primitive !== null };
}

/** One level of the real recipe, with cumulative counts in the whole contract. No expanded operation lists. */
export function selectTaskWork(family: FamilyId, size: number, requested: readonly string[] = []): TaskWorkTree {
  const def = FAMILIES[family]!, load = BigInt(inputLoadAt(def, size));
  const root: WorkTreeNode = { ...node(def.key, BigInt(size)), ops: payoutCreditsAt(def, size) };
  let current = root, note = def.note;
  const ancestors: WorkTreeNode[] = [], path: string[] = [];
  const loadNode: WorkTreeNode = { key: 'input-load', label: 'Load input', icon: 'type:memory', band: null,
    count: whole(1n), ops: whole(load), primitive: false };
  function children(): WorkTreeNode[] {
    if (current.key === 'input-load') return [node('op:read', load)];
    const recipe = workRecipe(current.key), count = BigInt(current.count);
    const parts = recipe.parts.map(part => node(part.key, BigInt(part.count) * count));
    return path.length === 0 && load > 0n ? [loadNode, ...parts] : parts;
  }
  for (const key of requested) {
    const child = children().find(part => part.key === key);
    if (!child) break;
    ancestors.push(current); path.push(key); current = child;
    note = key === 'input-load' ? 'Read the task input into its working set.' : workRecipe(key).note;
  }
  return { root, current, note, path, ancestors, children: children() };
}
