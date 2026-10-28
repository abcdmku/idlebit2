import { amountCompare } from '../../amount';
import { accept, debitCredits, debitData, reject, type HandlerMap } from '../../core/actions';
import type { ActionOutcome } from '../../types/actions';
import type { ResearchId } from '../../types/ids';
import type { GameState, ResearchState } from '../../types/state';
import { withoutKey } from './projects';
import { researchDef } from './tree';
import { deriveUnlocks } from './effects';
import { compileAll, syncHotSizes } from '../../core/topology';
import { commitWorld, openWorld } from '../../core/world';
import { pushEvent } from '../../core/events';
import { researchCosts } from '../../rewards/research';
import { roundRewardBonuses } from '../../rewards/bonuses';

/** Level purchases apply their rule now and leave any processor research running. */
function purchase(state: GameState, id: ResearchId): ActionOutcome {
  const def = researchDef(id)!;
  const lock = researchLock(state.research, id, [], state.roundRewards.claimed);
  if (lock) return reject(state, lock.code, lock.reason);
  const paid = debitCredits(state, def.creditCost);
  if (!paid.ok) return paid;
  const completed = [...state.research.completed, id];
  const research = { ...state.research, completed, unlocks: deriveUnlocks(completed) };
  const systems = def.purchase?.series === 'cstate' && def.purchase.level === 1
    ? state.build.systems.map(s => s && ({ ...s, spec: { ...s.spec, settings: { ...s.spec.settings, cStateLimit: 1 as const } } }))
    : state.build.systems;
  const build = { ...state.build, systems, revision: state.build.revision + 1 };
  const compiled = compileAll(build, research, state.roundRewards);
  const next = { ...paid.state, research, build, compiled };
  const w = openWorld(next);
  syncHotSizes(w.hot, compiled);
  pushEvent(w, { kind: 'researchCompleted', project: id });
  w.report.researchCompleted.push(id);
  return accept(commitWorld(next, w, next.clock.carryMs));
}

/** Why `id` can't be researched now, or null. Prerequisites may be satisfied by `pending` (active or queued earlier). */
export function researchLock(r: ResearchState, id: ResearchId, pending: readonly ResearchId[] = [], claimed: readonly number[] = []): { code: 'invalid' | 'locked'; reason: string; node: ResearchId | null } | null {
  const def = researchDef(id);
  if (!def || !def.implemented) return { code: 'invalid', reason: 'No such project', node: null };
  if (r.completed.includes(id)) return { code: 'invalid', reason: 'Already researched', node: null };
  if (def.rewardMilestone && !claimed.includes(def.rewardMilestone))
    return { code: 'locked', reason: `Claim the ${def.rewardMilestone}-task reward`, node: null };
  const missing = def.requires.find((p) => !r.completed.includes(p) && !pending.includes(p));
  if (missing) return { code: 'locked', reason: `Needs ${researchDef(missing)?.name ?? missing}`, node: missing };
  return null;
}

const withResearch = (state: GameState, research: Partial<ResearchState>): GameState => ({ ...state, research: { ...state.research, ...research } });
const solvent = (state: GameState) => amountCompare(state.wallet.credits, 0) >= 0;

/** Resumes paid progress free; a first start atomically pays Data and its optional Credit fee. */
function start(state: GameState, id: ResearchId): ActionOutcome {
  if (researchDef(id)?.purchase) return purchase(state, id);
  const r = state.research;
  if (r.active === id) return accept(state);
  const lock = researchLock(r, id, [], state.roundRewards.claimed);
  if (lock) return reject(state, lock.code, lock.reason);
  let next = state;
  if (r.parked[id] === undefined) {
    const def = researchDef(id)!;
    const costs = researchCosts(def, state.roundRewards), fee = costs.credits;
    const credits = amountCompare(fee, 0) > 0 ? debitCredits(state, fee) : accept(state);
    if (!credits.ok) return credits;
    const paid = debitData(credits.state, costs.data);
    if (!paid.ok) return reject(state, paid.rejection.code, paid.rejection.reason);
    next = paid.state;
  }
  const parked = r.active !== null ? { ...withoutKey(r.parked, id), [r.active]: r.activeProgress } : withoutKey(r.parked, id);
  return accept(withResearch(next, {
    active: id, activeProgress: r.parked[id] ?? 0, parked, queue: r.queue.filter((q) => q !== id),
    needsData: false, stoppedInsolvent: !solvent(state),
  }));
}

export const researchHandlers: HandlerMap = {
  startResearch: (state, action) => start(state, action.project),

  /** Adds a project to the queue (researchQueue ceiling counts active + queued). With nothing active it starts. */
  queueResearch: (state, action) => {
    if (researchDef(action.project)?.purchase) return purchase(state, action.project);
    const r = state.research;
    const id = action.project;
    if (r.active === id || r.queue.includes(id)) return accept(state);
    const pending = [...(r.active ? [r.active] : []), ...r.queue];
    const lock = researchLock(r, id, pending, state.roundRewards.claimed);
    if (lock) return reject(state, lock.code, lock.reason);
    if (pending.length >= r.unlocks.ceilings.researchQueue + roundRewardBonuses(state.roundRewards.claimed).researchSlots)
      return reject(state, 'cap', 'Research queue is full');
    if (r.active === null && r.queue.length === 0) {
      const started = start(state, id);
      if (started.ok || started.rejection.code !== 'funds') return started;
      return accept(withResearch(state, { queue: [id], needsData: true }));
    }
    return accept(withResearch(state, { queue: [...r.queue, id] }));
  },

  /** Removes a queued project and every queued project that depends on it. */
  unqueueResearch: (state, action) => {
    const r = state.research;
    if (!r.queue.includes(action.project)) return reject(state, 'invalid', 'Not queued');
    const dropped = new Set<ResearchId>([action.project]);
    const queue = r.queue.filter((q) => {
      if (dropped.has(q)) return false;
      if (researchDef(q)!.requires.some((p) => dropped.has(p))) { dropped.add(q); return false; }
      return true;
    });
    return accept(withResearch(state, { queue, needsData: queue.length > 0 && r.needsData && queue[0] === r.queue[0] }));
  },

  /** Stops the active project; its progress and paid status are kept (spec §11.1). */
  cancelResearch: (state) => {
    const r = state.research;
    if (r.active === null) return reject(state, 'invalid', 'No active project');
    return accept(withResearch(state, { active: null, activeProgress: 0, parked: { ...r.parked, [r.active]: r.activeProgress }, stoppedInsolvent: false }));
  },

  /** Resumes a project stopped for insolvency, once the wallet is non-negative (spec §11.4). */
  resumeResearch: (state) => {
    if (!state.research.stoppedInsolvent) return accept(state);
    if (!solvent(state)) return reject(state, 'funds', 'Credits are negative');
    return accept(withResearch(state, { stoppedInsolvent: false }));
  },
};
