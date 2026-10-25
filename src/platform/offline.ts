import { advanceGameOwned, applyAction, copyGameState, type AdvanceReport, type GameAction, type GameState } from '../game';
import type { OfflineEngine } from './offlineHandler';
import { createOfflineRunner, wrapBrowserWorker, type OfflineRunner } from './offlineRunner';
import { mergeReports } from './reports';

export type GameOfflineRunner = OfflineRunner<GameState, AdvanceReport, GameAction>;

/** The real sim behind every offline path: browser worker, main-thread fallback and bench worker. */
export const gameOfflineEngine: OfflineEngine<GameState, AdvanceReport, GameAction> = {
  // Every session owns its state (offlineHandler, offlineRunner), so no slice copies the hot buffers.
  advance: (state, elapsedMs) => advanceGameOwned(state, elapsedMs),
  own: copyGameState,
  merge: mergeReports,
  // A rejected action leaves the state as it was, as a rejected dispatch would.
  apply: (state, action) => applyAction(state, action).state,
};

export function createGameOfflineRunner(): GameOfflineRunner {
  const canUseWorker = typeof Worker !== 'undefined';
  return createOfflineRunner({
    engine: gameOfflineEngine,
    createWorker: canUseWorker
      ? () => wrapBrowserWorker(new Worker(new URL('./offline.worker.ts', import.meta.url), { type: 'module' }))
      : undefined,
  });
}
