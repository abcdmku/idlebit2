import type { Amount } from '../../amount';
import type { StageDef } from '../../types/catalog';
import type { RecipeTotals, WorkRecipe } from '../../types/tasks';
import { recipes as base } from './base';
import { recipes as bits } from './bits';
import { recipes as ints } from './ints';
import { recipes as threads } from './threads';
import { recipes as ram } from './ram';
import { recipes as gpu } from './gpu';
import { recipes as storage } from './storage';
import { recipes as rack } from './rackDist';
import { recipes as room } from './roomDist';
import { recipes as zones } from './multiAz';
import { recipes as region } from './region';

export const TASK_RECIPES: readonly WorkRecipe[] = [...bits, ...ints, ...threads, ...ram, ...gpu, ...storage, ...rack, ...room, ...zones, ...region];
const byKey = new Map([...base, ...TASK_RECIPES].map(recipe => [recipe.key, recipe]));
const compiled = new Map<string, RecipeTotals>();
const visiting = new Set<string>();

export function workRecipe(key: string): WorkRecipe {
  const recipe = byKey.get(key);
  if (!recipe) throw new Error(`Unknown work recipe: ${key}`);
  return recipe;
}

/** Compile shared recipes once, without expanding repetitions or converting rewards through floats. */
export function recipeTotals(key: string): RecipeTotals {
  const hit = compiled.get(key);
  if (hit) return hit;
  if (visiting.has(key)) throw new Error(`Cyclic work recipe: ${key}`);
  visiting.add(key);
  const recipe = workRecipe(key);
  let ops = recipe.primitive ? 1n : 0n;
  let cpu = recipe.primitive === 'compute' ? 1 : 0, gpuOps = 0;
  let read = key === 'op:read' ? 1 : 0, write = key === 'op:write' ? 1 : 0;
  for (const part of recipe.parts) {
    if (!Number.isSafeInteger(part.count) || part.count < 1) throw new Error(`Invalid repetition in ${key}`);
    const child = recipeTotals(part.key);
    ops += BigInt(child.ops) * BigInt(part.count);
    cpu += child.cpu * part.count; gpuOps += child.gpu * part.count;
    read += child.read * part.count; write += child.write * part.count;
  }
  // Compatible kernels move arithmetic to the accelerator; the underlying CPU-equivalent work stays the same.
  if (recipe.band === 'gpu') { gpuOps += cpu; cpu = 0; }
  if (ops < 1n) throw new Error(`Empty work recipe: ${key}`);
  const result: RecipeTotals = { ops: ops.toString() as Amount, cpu, gpu: gpuOps, read, write };
  visiting.delete(key); compiled.set(key, result);
  return result;
}

/** Batched read, CPU, accelerator and write volumes. Memory placement determines their real tier rates. */
export function recipeStages(key: string): readonly StageDef[] {
  const totals = recipeTotals(key), stages: StageDef[] = [];
  for (const [resource, count] of [['mem', totals.read], ['compute', totals.cpu], ['gpu', totals.gpu], ['mem', totals.write]] as const) {
    if (count <= 0) continue;
    const last = stages.at(-1);
    if (last?.resource === resource) stages[stages.length - 1] = { resource, work: { fixed: 0, perSize: last.work.perSize + count } };
    else stages.push({ resource, work: { fixed: 0, perSize: count } });
  }
  return stages;
}

for (const recipe of TASK_RECIPES) recipeTotals(recipe.key);
