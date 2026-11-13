import type { FrontierView } from '../types/frontier';
import type { RoundReport } from '../types/report';
import type { GameState } from '../types/state';

/**
 * The tier ladder of tasks completed in one round (D40): 10, 15, 20, 30, 50, 75, 100, 150 … six steps per ×10,
 * without end. A round's task count grows from tens to millions over the campaign (docs/tasks.md §3), so the
 * report always has a next tier to show.
 */
export { tierOf, tierValue } from '../rewards/ladder';

let memo: { reports: readonly RoundReport[]; best: number; view: FrontierView } | null = null;

/** The report's frontier: the best and every kept round's reach. The same reference until a round ends. */
export function frontierView(state: GameState): FrontierView {
  const { reports, frontier } = state.round;
  if (memo && memo.reports === reports && memo.best === frontier.bestI) return memo.view;
  const view: FrontierView = { bestI: frontier.bestI, bestRound: frontier.bestRound, reaches: reports.map(r => ({ round: r.index, peak: r.peakIntensity })) };
  memo = { reports, best: frontier.bestI, view };
  return view;
}
