import { MILESTONES, nextMilestone, runwayMark } from '../build/research/runway';
import { researchDef } from '../build/research/tree';
import type { FrontierView, RunwayPace, RunwayView } from '../types/frontier';
import type { RoundReport } from '../types/report';
import type { GameState } from '../types/state';

/**
 * The tier ladder of tasks completed in one round (D40): 10, 15, 20, 30, 50, 75, 100, 150 … six steps per ×10,
 * without end. A round's task count grows from tens to millions over the campaign (docs/tasks.md §3), so the
 * report always has a next tier to show.
 */
const TIER_STEPS = [1, 1.5, 2, 3, 5, 7.5];
/** Tier i's task count, i ≥ 1. */
export const tierValue = (i: number): number => TIER_STEPS[(i - 1) % TIER_STEPS.length]! * 10 ** (1 + Math.floor((i - 1) / TIER_STEPS.length));
/** The highest tier `met` tasks reach; 0 below the first. */
export function tierOf(met: number): number {
  let i = 0;
  while (tierValue(i + 1) <= met) i += 1;
  return i;
}

let memo: { reports: readonly RoundReport[]; best: number; view: FrontierView } | null = null;

/** The report's frontier: the best and every kept round's reach. The same reference until a round ends. */
export function frontierView(state: GameState): FrontierView {
  const { reports, frontier } = state.round;
  if (memo && memo.reports === reports && memo.best === frontier.bestI) return memo.view;
  const view: FrontierView = { bestI: frontier.bestI, bestRound: frontier.bestRound, reaches: reports.map(r => ({ round: r.index, peak: r.peakIntensity })) };
  memo = { reports, best: frontier.bestI, view };
  return view;
}

/** The pace toward the next milestone at the average of the last three reports (D40). */
function runwayPace(reports: readonly RoundReport[], node: string, data: number, credits: number, needData: number, needCredits: number): RunwayPace | null {
  const last = reports.slice(-3);
  if (!last.length) return null;
  const mean = (f: (r: RoundReport) => number) => last.reduce((s, r) => s + f(r), 0) / last.length;
  const avgData = mean(r => Number(r.data)), avgNet = mean(r => Number(r.net)), ms = mean(r => r.durationMs);
  const roundsFor = (left: number, per: number) => (left <= 0 ? 0 : per > 0 ? Math.ceil(left / per) : Infinity);
  const dataRounds = roundsFor(needData - data, avgData), creditRounds = roundsFor(needCredits - credits, avgNet);
  const worst = Math.max(dataRounds, creditRounds);
  const binding = worst === 0 ? null : dataRounds >= creditRounds ? 'data' : 'credits';
  const f = reports.at(-1)!.frontier;
  const lastGain = f.runwayStart && f.runwayEnd && f.runwayStart.node === node && f.runwayEnd.node === node
    && f.runwayStart.phase === 'saving' && f.runwayEnd.phase === 'saving' ? f.runwayEnd.progress - f.runwayStart.progress : null;
  return { samples: last.length, data: avgData, net: avgNet, ms, binding, rounds: Number.isFinite(worst) ? worst : null, lastGain };
}

/** The era ribbon and the next milestone's runway: its real costs against the wallet (D40). */
export function selectRunway(state: GameState): RunwayView {
  const r = state.research;
  const cpuTiers = ['Hz','kHz','MHz','GHz'].map((name,tier)=>({tier,name,done: (r.unlocks.gens.cpu & (1 << tier)) !== 0}));
  // Data-driven: any milestone added to the tree (docs/research.md §3.1) joins the ribbon with its own name and line.
  const eras = MILESTONES.map(node => ({ node, name: researchDef(node)?.name ?? node, summary: researchDef(node)?.summary ?? '', done: r.completed.includes(node) }));
  const node = nextMilestone(r.completed), def = node ? researchDef(node) : undefined;
  if (!node || !def) return { eras, cpuTiers, next: null, pace: null };
  const data = Number(state.wallet.data), credits = Number(state.wallet.credits);
  const mark = runwayMark(r, data, credits)!, paid = mark.phase === 'research';
  return {
    eras,
    cpuTiers,
    next: {
      node, name: def.name, data: def.data, credits: def.creditCost, work: def.work,
      needs: def.requires.filter(id => !r.completed.includes(id)).map(id => ({ node: id, name: researchDef(id)?.name ?? id })),
      mark, paid, progressOps: paid ? (r.active === node ? r.activeProgress : r.parked[node] ?? 0) : 0,
    },
    pace: paid ? null : runwayPace(state.round.reports, node, data, credits, def.data, Number(def.creditCost)),
  };
}
