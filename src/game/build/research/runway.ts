import type { RunwayMark } from '../../types/frontier';
import type { ResearchId } from '../../types/ids';
import type { ResearchState } from '../../types/state';
import { MILESTONE_IDS } from './tree.data';
import { researchDef } from './tree';
import { researchCosts } from '../../rewards/research';

/** The milestone nodes in era order (docs/research.md §3.1). */
export const MILESTONES = MILESTONE_IDS as readonly ResearchId[];

/** The first milestone not completed, or null after Regions. */
export function nextMilestone(completed: readonly ResearchId[]): ResearchId | null {
  return MILESTONES.find(id => !completed.includes(id)) ?? null;
}

type Progress = Pick<ResearchState, 'completed' | 'active' | 'activeProgress' | 'parked'>;

/**
 * Progress toward the next milestone (D40). Once its project is paid (running or paused) it is the work
 * share; before that, the binding currency's share of its Data and Credit cost against the wallet.
 */
export function runwayMark(r: Progress, data: number, credits: number, claimed: readonly number[] = []): RunwayMark | null {
  const node = nextMilestone(r.completed);
  const def = node ? researchDef(node) : undefined;
  if (!node || !def) return null;
  const done = r.active === node ? r.activeProgress : r.parked[node];
  if (done !== undefined) return { node, phase: 'research', progress: Math.min(1, done / def.work) };
  const cost = researchCosts(def, { claimed });
  const share = (have: number, need: number) => (need > 0 ? Math.min(1, Math.max(0, have) / need) : 1);
  return { node, phase: 'saving', progress: Math.min(share(data, Number(cost.data)), share(credits, Number(cost.credits))) };
}
