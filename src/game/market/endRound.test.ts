import { describe, expect, it } from 'vitest';
import { advanceGame } from '../core/advance';
import { applyAction } from '../core/actions';
import { G } from '../core/buffers';
import { STALL_END_TICKS } from '../core/constants';
import { openWorld } from '../core/world';
import { roundPhase } from './rounds';
import { MODE } from '../core/timers';
import { createInitialState } from '../core/state';
import type { GameState } from '../types/state';
import type { GameAction } from '../types/actions';
import { researchId, systemId } from '../types/ids';
import { buildState } from '../testkit/builders';

const act = (s: GameState, type: 'endRound' | 'returnToMarket') => applyAction(s, { type });

/** User ask (25 Oct): "always have a way to end a round". Spec §4.1. */
describe('endRound action', () => {
  it('ends a running round mid-way with whole-round totals and leaves the game between rounds', () => {
    const mid = advanceGame(createInitialState(42), 30_000).state;
    expect(mid.round.phase).toBe('running');
    const met = mid.hot.g[G.met]!;
    expect(met).toBeGreaterThan(0);
    const out = act(mid, 'endRound');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const s = out.state;
    expect(s.round.phase).toBe('ended');
    expect(s.round.endTick).toBe(mid.clock.tick);
    const report = s.round.reports.at(-1)!;
    expect(report.endedBy).toBe('player');
    expect(report.index).toBe(1);
    expect(report.durationTicks).toBe(300);
    expect(report.met).toBe(met);
    expect([report.gross, report.energy, report.data]).toEqual([mid.round.gross, mid.round.energy, mid.round.data]);
    // No extra fee: the wallet is untouched by ending.
    expect(s.wallet).toEqual(mid.wallet);
    // Hardware pauses and the next round's queue starts from the beginning (D30).
    expect(s.hot.sys.mode[0]).toBe(MODE.paused);
    expect(s.market.roundIndex).toBe(2);
    expect(s.market.intensity).toBe(createInitialState(42).market.intensity);
    // Between rounds it rejects; Return to market starts round 2.
    expect(act(s, 'endRound').ok).toBe(false);
    const back = act(s, 'returnToMarket');
    expect(back.ok && back.state.round.index).toBe(2);
  });
});

/** User ask (25 Oct): pick which units are on the market between rounds with setOnline (spec §4.4). */
describe('choosing the on-market units between rounds', () => {
  const rack3 = () => buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 3, credits: '1000000' });
  const ok = (s: GameState, a: GameAction): GameState => {
    const out = applyAction(s, a);
    if (!out.ok) throw new Error(out.rejection.reason);
    return out.state;
  };
  const off = (id: number): GameAction => ({ type: 'setOnline', unit: { kind: 'system', id: systemId(id) }, online: false });
  const modes = (s: GameState) => [...s.hot.sys.mode.subarray(0, 3)];

  it('applies at once and free between rounds; the next round runs only the on-market system', () => {
    const between = ok(advanceGame(rack3(), 5_000).state, { type: 'endRound' });
    const picked = ok(ok(between, off(1)), off(2));
    expect([...picked.hot.sys.timer.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect(picked.wallet).toEqual(between.wallet);
    const back = ok(picked, { type: 'returnToMarket' });
    // No 10 s transition: the round opens with system 0 on the market and the others offline.
    expect(modes(back)).toEqual([MODE.onMarket, MODE.offline, MODE.offline]);
    const later = advanceGame(back, 20_000).state;
    expect(later.hot.g[G.taken]).toBeGreaterThan(back.hot.g[G.taken]!);
    for (const s of [1, 2]) {
      expect(later.hot.sys.mode[s]).toBe(MODE.offline);
      expect(later.hot.sys.busyThreads[s]).toBe(0);
      expect(later.hot.sys.drawW[s]).toBe(0);
    }
  });

  it('keeps the one boot time while a round runs', () => {
    const s = ok(rack3(), off(1));
    expect(modes(s)).toEqual([MODE.onMarket, MODE.goingOffline, MODE.onMarket]);
    expect(s.hot.sys.timer[1]).toBe(s.research.unlocks.bootTicks);
  });
});

describe('research between rounds', () => {
  it('runs only on systems the player keeps online', () => {
    const base = buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 3, credits: '1000000' });
    const funded = { ...base, wallet: { ...base.wallet, data: '100000' as never } };
    const between = applyAction(advanceGame(funded, 5_000).state, { type: 'endRound' });
    if (!between.ok) throw new Error('endRound');
    let s = between.state;
    for (const a of [
      { type: 'setOnline', unit: { kind: 'system', id: systemId(1) }, online: false },
      { type: 'startResearch', project: researchId('cstateC1') },
    ] as const satisfies readonly GameAction[]) {
      const out = applyAction(s, a);
      if (!out.ok) throw new Error(out.rejection.reason);
      s = out.state;
    }
    const later = advanceGame(s, 200).state;
    expect(later.hot.sys.researchThreads[0]).toBeGreaterThan(0);
    expect(later.hot.sys.researchThreads[2]).toBeGreaterThan(0);
    expect(later.hot.sys.researchThreads[1]).toBe(0);
    expect(later.hot.sys.drawW[1]).toBe(0);
    expect(later.hot.sys.drawW[0]).toBeGreaterThan(0);
  });
});

/** D33 (user, 25 Oct): a running round also ends when no task has been met for 120 s. */
describe('stall end', () => {
  it('ends the round as stalled after 120 s without a met task, not one tick sooner', () => {
    const base = advanceGame(createInitialState(42), 1_000).state;
    const at = (tick: number) => {
      const w = openWorld(base);
      w.hot.g[G.lastMetTick] = 100;
      w.tick = tick;
      roundPhase(w);
      return w;
    };
    expect(at(100 + STALL_END_TICKS - 1).round.phase).toBe('running');
    const ended = at(100 + STALL_END_TICKS);
    expect(ended.round.phase).toBe('ended');
    expect(ended.round.reports.at(-1)!.endedBy).toBe('stall');
  });
});
