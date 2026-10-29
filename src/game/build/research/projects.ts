import { G } from '../../core/buffers';
import { pushEvent } from '../../core/events';
import { compileAll, syncHotSizes } from '../../core/topology';
import type { World } from '../../core/world';
import type { ResearchId } from '../../types/ids';
import type { ResearchState } from '../../types/state';
import { deriveUnlocks, openContainers } from './effects';
import { researchDef } from './tree';
import { reconcileAccelerators } from '../../exec';
import { researchCosts } from '../../rewards/research';

/**
 * Research step (tick step 12, spec §11): exec has tallied this tick's research ops in
 * G.researchOps (R22); build consumes and zeroes them. Progress is float64 ops. A completed
 * project applies its effects from the next tick (w.build and w.compiled are replaced), and the
 * excess carries into the next queued project if it can start. A waiting queue head starts
 * when both Data and its additional Credit fee are available; needsData marks this wait.
 */
export function researchPhase(w: World): void {
  const previous = w.compiled;
  advanceResearch(w);
  if (previous !== w.compiled) reconcileAccelerators(w, previous);
}

function advanceResearch(w: World): void {
  const g = w.hot.g;
  const ops = g[G.researchOps]!;
  g[G.researchOps] = 0;
  const r = w.research;
  if (r.active === null) {
    if (r.queue.length > 0) startNext(w, 0);
    return;
  }
  if (r.stoppedInsolvent || !(ops > 0)) return;
  let progress = r.activeProgress + ops;
  for (;;) {
    const id: ResearchId = r.active!;
    const work = researchDef(id)!.work;
    if (progress < work) { r.activeProgress = progress; return; }
    progress -= work;
    complete(w, id);
    if (!startNext(w, progress)) return;
    progress = r.activeProgress;
  }
}

/** Applies a completed project's effects: unlocks, opened containers, recompile (spec §11.1). */
function complete(w: World, id: ResearchId): void {
  const r = w.research;
  r.completed = [...r.completed, id];
  r.active = null;
  r.activeProgress = 0;
  r.unlocks = deriveUnlocks(r.completed);
  const opened = openContainers(w.build, r.unlocks);
  w.build = { ...opened, revision: w.build.revision + 1 };
  w.compiled = compileAll(w.build, r, w.roundRewards);
  syncHotSizes(w.hot, w.compiled);
  pushEvent(w, { kind: 'researchCompleted', project: id });
  w.report.researchCompleted.push(id);
}

/** Starts a parked project free, otherwise pays both wallets once; short funds flag needsData. */
function startNext(w: World, carry: number): boolean {
  const r = w.research;
  const head = r.queue[0];
  if (head === undefined) { r.needsData = false; return false; }
  const def = researchDef(head)!;
  const parked = r.parked[head];
  if (parked === undefined) {
    const costs = researchCosts(def, w.roundRewards);
    const cost = BigInt(costs.data), credits = BigInt(costs.credits);
    if (w.ledger.data < cost || credits > 0n && w.ledger.credits < credits) { r.needsData = true; return false; }
    w.ledger.data -= cost;
    w.ledger.dataSpent += cost;
    w.ledger.credits -= credits;
    w.ledger.creditsSpent += credits;
  }
  r.queue = r.queue.slice(1);
  r.parked = withoutKey(r.parked, head);
  r.active = head;
  r.activeProgress = (parked ?? 0) + carry;
  r.needsData = false;
  return true;
}

export const withoutKey = (record: ResearchState['parked'], key: string): ResearchState['parked'] => {
  if (!(key in record)) return record;
  const { [key]: _drop, ...rest } = record;
  return rest;
};
