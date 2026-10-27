import type { Amount } from '../amount';
import type { BandId, Resource } from './catalog';

export interface RecipePart { readonly key: string; readonly count: number }
export interface WorkRecipe {
  readonly key: string;
  readonly label: string;
  readonly band: BandId | null;
  readonly note: string;
  /** Existing family art, or a task-type silhouette for a new recipe. */
  readonly icon: string;
  readonly parts: readonly RecipePart[];
  /** One CPU-equivalent operation; reads and writes execute on the memory hierarchy. */
  readonly primitive: Resource | null;
}
export interface RecipeTotals {
  readonly ops: Amount;
  readonly cpu: number;
  readonly gpu: number;
  readonly read: number;
  readonly write: number;
}
export interface WorkTreeNode {
  readonly key: string;
  readonly label: string;
  readonly icon: string;
  readonly band: BandId | null;
  readonly count: Amount;
  readonly ops: Amount;
  readonly primitive: boolean;
}
export interface TaskWorkTree {
  readonly root: WorkTreeNode;
  readonly current: WorkTreeNode;
  readonly note: string;
  readonly path: readonly string[];
  readonly ancestors: readonly WorkTreeNode[];
  readonly children: readonly WorkTreeNode[];
}
