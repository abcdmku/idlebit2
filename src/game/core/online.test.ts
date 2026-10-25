import { advanceGame } from './advance';
import { applyAction } from './actions';
import { MODE } from './timers';
import { buildState } from '../testkit/builders';
import { rackId, systemId } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';

const rack3 = (round: 'running' | 'between' = 'running') => buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 3, round });
const act = (state: GameState, action: GameAction): GameState => {
  const outcome = applyAction(state, action);
  if (!outcome.ok) throw new Error(outcome.rejection.reason);
  return outcome.state;
};
const modes = (s: GameState) => [...s.hot.sys.mode.subarray(0, 3)];
const off = (id: number): GameAction => ({ type: 'setOnline', unit: { kind: 'system', id: systemId(id) }, online: false });
const on = (id: number): GameAction => ({ type: 'setOnline', unit: { kind: 'system', id: systemId(id) }, online: true });

describe('setOnline', () => {
  it('takes one boot time to go offline mid-round, then rests offline', () => {
    const s = act(rack3(), off(1));
    expect(modes(s)).toEqual([MODE.onMarket, MODE.goingOffline, MODE.onMarket]);
    expect(s.hot.sys.timer[1]).toBe(100);
    expect(s.compiled.sys.intent[1]).toBe(0);
    expect(modes(advanceGame(s, 9_900).state)[1]).toBe(MODE.goingOffline);
    expect(modes(advanceGame(s, 10_000).state)[1]).toBe(MODE.offline);
  });

  it('boots for one boot time when switched back online', () => {
    const offline = advanceGame(act(rack3(), off(0)), 10_000).state;
    const booting = act(offline, on(0));
    expect(modes(booting)[0]).toBe(MODE.boot);
    expect(modes(advanceGame(booting, 10_000).state)[0]).toBe(MODE.onMarket);
  });

  it('starts the opposite transition when toggled mid-transition', () => {
    const going = advanceGame(act(rack3(), off(2)), 4_000).state;
    const back = act(going, on(2));
    expect([back.hot.sys.mode[2], back.hot.sys.timer[2]]).toEqual([MODE.boot, 100]);
  });

  it('applies at once between rounds', () => {
    const s = act(rack3('between'), off(1));
    expect(modes(s)).toEqual([MODE.paused, MODE.paused, MODE.paused]);
    expect(s.hot.sys.timer[1]).toBe(0);
    expect(s.compiled.sys.intent[1]).toBe(0);
  });

  it('switches every system below a rack and leaves the input untouched', () => {
    const start = rack3();
    const s = act(start, { type: 'setOnline', unit: { kind: 'rack', id: rackId(0) }, online: false });
    expect(modes(s)).toEqual([MODE.goingOffline, MODE.goingOffline, MODE.goingOffline]);
    expect(s.build.racks[0]!.online).toBe(false);
    expect(s.build.revision).toBe(start.build.revision + 1);
    expect(modes(start)).toEqual([MODE.onMarket, MODE.onMarket, MODE.onMarket]);
    expect(start.compiled.sys.intent[0]).toBe(1);
  });

  it('drains instead of killing with gracefulDrain, and cancels the drain when switched back', () => {
    const base = rack3();
    const rules = [...base.research.unlocks.rules, 'gracefulDrain' as const];
    const drainable: GameState = { ...base, research: { ...base.research, unlocks: { ...base.research.unlocks, rules } } };
    const draining = act(drainable, off(0));
    expect(draining.hot.sys.mode[0]).toBe(MODE.draining);
    expect(act(draining, on(0)).hot.sys.mode[0]).toBe(MODE.onMarket);
  });

  it('rejects a missing unit', () => {
    const outcome = applyAction(rack3(), off(99));
    expect(!outcome.ok && outcome.rejection.code).toBe('invalid');
  });
});
