import type { ActionOutcome } from '../types/actions';
import type { HandlerMap } from './actions';
import { setOnline } from './online';
import { createInitialState } from './state';
import { declareBankruptcy } from './bankruptcy';

/** Core-owned actions: reset, and the online switch (one boot time, D1.8). */
export const coreHandlers: HandlerMap = {
  reset: (state): ActionOutcome => ({ ok: true, state: { ...createInitialState(state.seed), epoch: state.epoch + 1 } }),
  setOnline,
  declareBankruptcy,
};
