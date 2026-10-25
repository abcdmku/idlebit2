import { advanceGame } from '../core/advance';
import { applyAction } from '../core/actions';
import { eventPhase, tallyMet } from '../core/events';
import { G } from '../core/buffers';
import { slaValue } from '../core/sla';
import { MODE } from '../core/timers';
import { commitWorld, openWorld } from '../core/world';
import { deserializeSave, serializeSave } from '../save/serialize';
import { feedSnapshot } from '../view/feed';
import { FAIL_DETAILS } from '../types/events';
import type { GameState } from '../types/state';
import { roundPhase } from './rounds';
import { failTasks } from './sla';
import { BOOT_CAPS, marketState } from './testState';
import { FAMILIES } from './families';
import { dismissAt } from './queue';

const withAutoReturn = (s: GameState, delay = 150): GameState => ({
  ...s,
  research: { ...s.research, unlocks: { ...s.research.unlocks, rules: [...s.research.unlocks.rules, 'autoReturn'], autoReturnDelayTicks: delay } },
});

/** Ends the round of `s` at tick 50 with three "Can't run · RAM" failures of 100 ops each, at peak I. */
function endedAt50(s: GameState, peak = 0): GameState {
  const w = openWorld(s);
  w.tick = 50;
  w.round.peakIntensity = peak;
  failTasks(w, 0, 'cantRun', 3, 300, FAIL_DETAILS.indexOf('ram'));
  roundPhase(w);
  eventPhase(w);
  w.tick += 1;
  return commitWorld(s, w, 0);
}

describe('work-weighted SLA (program D10.6, spec §4.2)', () => {
  it('weights by ops with a grace prior of 10 opening tasks', () => {
    const s = marketState();
    // The boot curve opens on 1-op Bit Flips: G = 10.
    expect(s.round.grace).toBe(10);
    expect(slaValue(0, 0, 10)).toBe(1);
    expect(slaValue(30, 10, 10)).toBe(0.8);
    expect(slaValue(1e6, 1, 10)).toBeGreaterThan(0.99);
  });

  it('keeps the round at exactly 80% and ends it below, inside the SLA step', () => {
    const w = openWorld(marketState());
    w.tick = 40;
    w.hot.g[G.deliveredWork] = 30;
    failTasks(w, 0, 'timeout', 1, 10);
    roundPhase(w);
    expect(w.round.phase).toBe('running');
    failTasks(w, 0, 'timeout', 1, 1);
    roundPhase(w);
    expect(w.round.phase).toBe('ended');
    expect(w.round.endTick).toBe(41);
  });

  it('lets many small failures pass that one large failure of equal count would not', () => {
    const run = (work: number) => {
      const w = openWorld(marketState());
      w.hot.g[G.deliveredWork] = 1000;
      failTasks(w, 0, 'timeout', 1, work);
      roundPhase(w);
      return w.round.phase;
    };
    expect(run(100)).toBe('running');
    expect(run(400)).toBe('ended');
  });
});

describe('round end and return (spec §4.1, §4.6, §4.7, D12.1)', () => {
  it('freezes per-type work and dismissals across a mid-round save, then resets the next round', () => {
    const initial = marketState(), w = openWorld(initial);
    const memory = FAMILIES.findIndex(f => f.band === 'ram');
    tallyMet(w, 0, 3, 0, 30);
    failTasks(w, memory, 'cantRun', 2, 300);
    dismissAt(w, 0);
    w.ledger.roundGross = 120n;
    w.ledger.roundEnergy = 40n;
    const saved = deserializeSave(serializeSave(commitWorld(initial, w, 0)));
    if (!saved.ok) throw new Error(saved.error);
    const resumed = openWorld(saved.state);
    roundPhase(resumed);
    const report = resumed.round.reports.at(-1)!;
    expect(report).toMatchObject({ gross: '120', energy: '40', net: '80' });
    expect(report.byType).toEqual([
      { type: 'compute', metWork: 30, failedWork: 0, dismissed: 1 },
      { type: 'memory', metWork: 0, failedWork: 300, dismissed: 0 },
    ]);
    expect(report.byType.reduce((sum, t) => sum + t.metWork, 0)).toBe(report.deliveredWork);
    expect(report.byType.reduce((sum, t) => sum + t.failedWork, 0)).toBe(report.failedWork);
    expect(report.byType.reduce((sum, t) => sum + t.dismissed, 0)).toBe(report.dismissed);
    const returned = applyAction(commitWorld(saved.state, resumed, 0), { type: 'returnToMarket' }).state;
    expect(returned.hot.fam.metWorkRound.every(n => n === 0)).toBe(true);
    expect(returned.hot.fam.failedWorkRound.every(n => n === 0)).toBe(true);
    expect(returned.hot.fam.dismissedRound.every(n => n === 0)).toBe(true);
    expect(returned.round.reports.at(-1)!.byType).toEqual(report.byType);
  });

  it('drops the queue uncounted, pauses hardware and freezes the report', () => {
    const s = endedAt50(marketState());
    expect(s.round.phase).toBe('ended');
    expect(s.hot.g[G.recUsed]).toBe(0);
    expect(s.hot.g[G.frontLen]).toBe(0);
    expect(s.hot.sys.mode[0]).toBe(MODE.paused);
    const report = s.round.reports.at(-1)!;
    expect(report).toMatchObject({ index: 1, startTick: 0, durationTicks: 51, durationMs: 5100, met: 0, dismissed: 0, failedWork: 300 });
    expect(report.failedByCause.cantRun).toBe(3);
    expect(report.details).toEqual([{ cause: 'cantRun', detail: 'ram', count: 3 }]);
    expect(s.round.autoReturnTick).toBeNull();
    expect(s.events.entries.some((e) => e.kind === 'roundEnded' && e.round === 1)).toBe(true);
  });

  it('opens the next round at max(0, peak I − 6) and draws its preview there (D12.1)', () => {
    expect(endedAt50(marketState(), 4).market.intensity).toBe(0);
    const ended = endedAt50(marketState(), 20);
    expect(ended.market).toMatchObject({ roundIndex: 2, intensity: 14 });
    const back = applyAction(ended, { type: 'returnToMarket' }).state;
    expect(back.round).toMatchObject({ phase: 'running', index: 2, startTick: 51, peakIntensity: 14 });
    // Opening tasks at I = 14 are far larger than Bit Flips, and so is the grace prior.
    expect(back.round.grace).toBeGreaterThan(100);
    expect(back.market.headTick).toBe(51);
  });

  it('rejects Return to market while the round runs', () => {
    const out = applyAction(marketState(), { type: 'returnToMarket' });
    expect(out.ok ? null : out.rejection.code).toBe('roundState');
  });

  it('starts the prepared queue as is: same IDs, no reseed, SLA reset', () => {
    const ended = endedAt50(marketState());
    const s = applyAction(ended, { type: 'returnToMarket' }).state;
    expect([s.hot.g[G.met], s.hot.g[G.failed], s.hot.g[G.failedWork], s.hot.g[G.deliveredWork]]).toEqual([0, 0, 0, 0]);
    expect(s.hot.sys.mode[0]).toBe(MODE.onMarket);
    expect(s.market.window).toEqual(ended.market.window);
    expect(s.hot.rng).toEqual(ended.hot.rng);
    expect(s.hot.g[G.rngDraws]).toEqual(ended.hot.g[G.rngDraws]);
    expect(s.hot.detailRound.every((n) => n === 0)).toBe(true);
  });

  it('leaves units switched offline out of the market', () => {
    const base = marketState();
    const compiled = { ...base.compiled, sys: { ...base.compiled.sys, intent: base.compiled.sys.intent.slice() } };
    compiled.sys.intent[0] = 0;
    const s = applyAction(endedAt50({ ...base, compiled }), { type: 'returnToMarket' }).state;
    expect(s.hot.sys.mode[0]).toBe(MODE.offline);
  });

  it('jitters weights and Data ratios per round, the same for the same seed and round', () => {
    const a = marketState().hot.fam, b = marketState().hot.fam;
    expect([...a.weightJitter]).toEqual([...b.weightJitter]);
    expect(a.weightJitter[0]).not.toBe(1);
    expect(a.dataRatio[0]).toBeGreaterThanOrEqual(12 * 0.9);
    expect(a.dataRatio[0]).toBeLessThanOrEqual(12 * 1.1);
    expect(endedAt50(marketState()).hot.fam.weightJitter[0]).not.toBe(a.weightJitter[0]);
  });

  it('auto-returns after its delay once researched, and the switch can cancel it', () => {
    const ended = endedAt50(withAutoReturn(marketState(BOOT_CAPS), 150));
    expect(ended.round.autoReturnTick).toBe(51 + 150);
    const off = applyAction(ended, { type: 'setAutoReturn', on: false }).state;
    expect(off.round.autoReturnTick).toBeNull();
    expect(advanceGame(off, 60_000).state.round.phase).toBe('ended');
    const rejoined = advanceGame(ended, 15_100).state;
    expect(rejoined.round).toMatchObject({ index: 2, startTick: 201 });
    expect(rejoined.market.headTick).toBe(201);
  });

  it('keeps the preview IDs and dismissals across saves, manual Return and auto-return', () => {
    const ended = endedAt50(withAutoReturn(marketState(), 20));
    const feed = feedSnapshot(ended, null, false);
    expect(feed).toMatchObject({ timing: 'onReturn', roundIndex: 2, headDeadlineTick: null });
    expect(feed.window).toHaveLength(5);
    const dismissed = applyAction(ended, { type: 'dismissTask', task: feed.window[0]!.task }).state;
    // The replacement is drawn at the same start I, at the back.
    expect(dismissed.market.window.map((t) => t.taskId)).toEqual([...ended.market.window.slice(1).map((t) => t.taskId), ended.market.window[4]!.taskId + 1]);
    const loaded = deserializeSave(serializeSave(dismissed));
    if (!loaded.ok) throw new Error(loaded.error);
    const returned = applyAction(loaded.state, { type: 'returnToMarket' }).state;
    expect(returned.market.window).toEqual(dismissed.market.window);
    expect(advanceGame(dismissed, 1900).state.market.window).toEqual(dismissed.market.window);
    const auto = advanceGame(dismissed, 2100).state;
    expect(auto.round.index).toBe(2);
    expect(auto.hot.g[G.taken]).toBeGreaterThan(0);
    const pieces = [17, 883, 1100, 19, 81];
    expect(pieces.reduce((s, ms) => advanceGame(s, ms).state, dismissed)).toEqual(auto);
  });

  it('dismisses the report into between', () => {
    const s = applyAction(endedAt50(marketState()), { type: 'dismissReport' }).state;
    expect(s.round.phase).toBe('between');
    expect(applyAction(s, { type: 'returnToMarket' }).ok).toBe(true);
  });
});
