import { cloneHot } from '../core/buffers';
import type { GameState } from '../types/state';
import { graceOf, prepareQueue } from './queue';

/** Testkit hook: open the running round at an endgame intensity, as the offset start would (D12.1). */
export const PRIME_INTENSITY = 53;

/** Re-prepares the running round's queue at `intensity`: five tasks drawn there, the grace prior from them, a fresh head clock. */
export function primeMarket(state: GameState, intensity: number = PRIME_INTENSITY): GameState {
  if (state.round.phase !== 'running') throw new Error('primeMarket: the round must be running');
  const hot = cloneHot(state.hot);
  const { tasks: window, intensity: next } = prepareQueue(hot, state.seed, state.round.index, intensity);
  return {
    ...state, hot,
    round: { ...state.round, peakIntensity: Math.max(state.round.peakIntensity, intensity), grace: graceOf(window) },
    market: { ...state.market, window, intensity: next, headTick: state.clock.tick },
  };
}
