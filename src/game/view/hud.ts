import { G } from '../core/buffers';
import { TICK_MS } from '../core/constants';
import { netPerMinute } from '../core/ledger';
import { slaPercent } from '../core/sla';
import type { HudSnapshot, RoundSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';

export { slaPercent };

const autoReturnInMs = (state: GameState): number | null => {
  const at = state.round.autoReturnTick;
  return at === null ? null : Math.max(0, at - state.clock.tick) * TICK_MS;
};

/** The HUD. Reuses `prev` when every value is unchanged, so consumers can compare by reference. */
export function hudSnapshot(state: GameState, prev: HudSnapshot | null): HudSnapshot {
  const g = state.hot.g;
  const met = g[G.met]!, failed = g[G.failed]!;
  const delivered = g[G.deliveredWork]!, failedWork = g[G.failedWork]!, grace = state.round.grace;
  const round = state.round;
  const end = round.phase === 'running' ? state.clock.tick : (round.endTick ?? state.clock.tick);
  const elapsed = Math.max(0, end - round.startTick) * TICK_MS;
  const credits = state.wallet.credits, data = state.wallet.data, net = netPerMinute(state);
  const auto = autoReturnInMs(state);
  const sameSla = prev !== null && prev.sla.met === met && prev.sla.failed === failed && prev.sla.deliveredWork === delivered
    && prev.sla.failedWork === failedWork && prev.sla.grace === grace;
  if (prev && sameSla && prev.credits === credits && prev.data === data && prev.netPerMinute === net
    && prev.roundState === round.phase && prev.roundIndex === round.index
    && prev.roundElapsedMs === elapsed && prev.autoReturnInMs === auto) return prev;
  return {
    credits, data, netPerMinute: net,
    sla: prev && sameSla ? prev.sla
      : { met, failed, percent: slaPercent(delivered, failedWork, grace), deliveredWork: delivered, failedWork, grace },
    roundState: round.phase, roundIndex: round.index, roundElapsedMs: elapsed, autoReturnInMs: auto,
  };
}

export function roundSnapshot(state: GameState, prev: RoundSnapshot | null): RoundSnapshot {
  const round = state.round;
  const lastReport = round.reports.at(-1) ?? null;
  const available = state.research.unlocks.rules.includes('autoReturn');
  const inMs = autoReturnInMs(state);
  const canReturn = round.phase !== 'running';
  if (prev && prev.index === round.index && prev.state === round.phase && prev.lastReport === lastReport && prev.canReturn === canReturn
    && prev.autoReturn.available === available && prev.autoReturn.on === round.autoReturnOn && prev.autoReturn.inMs === inMs) return prev;
  return { index: round.index, state: round.phase, lastReport, canReturn, autoReturn: { available, on: round.autoReturnOn, inMs } };
}
