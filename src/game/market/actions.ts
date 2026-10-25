import { LOC } from '../core/buffers';
import { accept, reject, type HandlerMap } from '../core/actions';
import { commitWorld, openWorld } from '../core/world';
import type { GameState } from '../types/state';
import { dismissAt, windowIndexOf } from './queue';
import { endRound, startRound } from './rounds';

/**
 * Market actions (spec §4.1, §4.6). Return to market is all-or-nothing: every online unit rejoins
 * together, and units switched offline stay out.
 */
function withWorld(state: GameState, edit: (w: ReturnType<typeof openWorld>) => void): GameState {
  const w = openWorld(state);
  edit(w);
  return commitWorld(state, w, state.clock.carryMs);
}

export const marketHandlers: HandlerMap = {
  /** Any uncommitted window task leaves for free (spec §5.2); committed work and stale IDs reject. */
  dismissTask: (state, { task }) => {
    if (task.epoch !== state.epoch) return reject(state, 'invalid', 'Task belongs to an earlier game');
    if (task.roundIndex !== state.market.roundIndex) return reject(state, 'invalid', 'Task belongs to another round');
    const i = windowIndexOf(state.market.window, task.taskId);
    if (i < 0) {
      const rec = state.hot.rec;
      for (let r = 0; r < rec.len; r += 1) {
        if (rec.loc[r] !== LOC.free && rec.loc[r] !== LOC.probe && rec.taskId[r] === task.taskId)
          return reject(state, 'invalid', 'Task is already committed to execution');
      }
      return reject(state, 'invalid', 'Task is no longer in the queue');
    }
    return accept(withWorld(state, (w) => dismissAt(w, i)));
  },
  returnToMarket: (state) => {
    if (state.round.phase === 'running') return reject(state, 'roundState', 'The round is running');
    return accept(withWorld(state, startRound));
  },
  /** The player ends the running round on purpose: the same as an SLA end, no extra cost (spec §4.1). */
  endRound: (state) => {
    if (state.round.phase !== 'running') return reject(state, 'roundState', 'No round is running');
    return accept(withWorld(state, (w) => endRound(w, 'player')));
  },
  dismissReport: (state) => {
    if (state.round.phase !== 'ended') return accept(state);
    return accept({ ...state, round: { ...state.round, phase: 'between' } });
  },
  setAutoReturn: (state, action) => {
    const round = state.round;
    const unlocks = state.research.unlocks;
    const arm = action.on && round.phase !== 'running' && round.autoReturnTick === null && unlocks.rules.includes('autoReturn');
    const autoReturnTick = !action.on ? null : arm ? state.clock.tick + unlocks.autoReturnDelayTicks : round.autoReturnTick;
    return accept({ ...state, round: { ...round, autoReturnOn: action.on, autoReturnTick } });
  },
};
