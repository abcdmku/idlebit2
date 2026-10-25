import { describe, expect, it } from 'vitest';
import { advanceGame, applyAction, createInitialState, type GameState } from '../index';
import { G } from '../core/buffers';
import { slaWindow } from '../core/sla';
import { SPILL_FLEETS } from '../testkit/spillFixtures';
import { researchId } from '../types/ids';

/**
 * D28 bookkeeping: SLA counts every resolved task once (a split task once, a late task once, a timed-out
 * head once), never dismissals or research, and the 80% check waits for 10 resolved tasks.
 */

/** Steps `state` by 100 ms ticks, summing the sim's own met / failed events per round, and checks the counters every tick. */
function audit(start: GameState, ticks: number, act?: (s: GameState, i: number) => GameState) {
  let s = start, seen = s.events.nextSeq, met = s.hot.g[G.met]!, failed = s.hot.g[G.failed]!;
  let rounds = 0, lates = 0, timeouts = 0, splits = 0;
  for (let i = 0; i < ticks; i += 1) {
    if (act) s = act(s, i);
    if (s.round.phase !== 'running') {
      const r = applyAction(s, { type: 'returnToMarket' });
      if (r.ok) s = r.state;
    }
    const next = advanceGame(s, 100).state;
    for (const e of next.events.entries) {
      if (e.seq < seen) continue;
      if (e.kind === 'roundStarted') { met = 0; failed = 0; }
      if (e.kind === 'met') met += e.count;
      if (e.kind === 'failed') { failed += e.count; if (e.cause === 'late') lates += e.count; if (e.cause === 'timeout') timeouts += e.count; }
      if (e.kind === 'roundEnded') rounds += 1;
    }
    seen = next.events.nextSeq;
    for (let p = 0; p < next.hot.parent.len; p += 1) if (next.hot.parent.placed[p]! > 1) splits += 1;
    if (next.round.phase === 'running' && next.round.index === s.round.index) {
      expect([next.hot.g[G.met], next.hot.g[G.failed]]).toEqual([met, failed]);
      const win = slaWindow(next.hot.g);
      expect(win.met + win.failed).toBe(Math.min(50, met + failed));
    }
    s = next;
  }
  return { s, rounds, lates, timeouts, splits };
}

describe('SLA bookkeeping (D28)', () => {
  it('counts each split, late and timed-out task once, never dismissals or research', () => {
    let start = SPILL_FLEETS.spillRack();
    // Research in line and running: it is not a task, so it never counts.
    const completed = start.research.completed.filter((id) => id !== 'hotPages');
    start = { ...start, research: { ...start.research, completed, active: researchId('hotPages'), activeProgress: 0 } };
    const dismissAt = new Set([5, 40, 120]);
    const { rounds, lates, timeouts, splits } = audit(start, 1_200, (s, i) => {
      if (!dismissAt.has(i) || s.round.phase !== 'running') return s;
      const head = s.market.window[0]!;
      const before = [s.hot.g[G.met], s.hot.g[G.failed], s.hot.g[G.slaLen], s.hot.g[G.slaMet]];
      const out = applyAction(s, { type: 'dismissTask', task: { epoch: s.epoch, roundIndex: s.market.roundIndex, taskId: head.taskId } });
      if (!out.ok) return s;
      expect([out.state.hot.g[G.met], out.state.hot.g[G.failed], out.state.hot.g[G.slaLen], out.state.hot.g[G.slaMet]]).toEqual(before);
      return out.state;
    });
    // The fixture exercises what the audit claims.
    expect(splits).toBeGreaterThan(0);
    expect(lates + timeouts + rounds).toBeGreaterThan(0);
  }, 120_000);

  it('waits for 10 resolved tasks before the 80% check can end a round', () => {
    // The un-upgraded boot core: Can't run · cache heads fail early, but the round outlives its first failures.
    let s = createInitialState(42);
    let firstFail = -1;
    for (let i = 0; i < 1_200 && s.round.phase === 'running'; i += 1) {
      s = advanceGame(s, 100).state;
      if (firstFail < 0 && s.hot.g[G.failed]! > 0) firstFail = s.clock.tick;
      const resolved = s.hot.g[G.met]! + s.hot.g[G.failed]!;
      if (resolved < 10) expect(s.round.phase).toBe('running');
    }
    expect(firstFail).toBeGreaterThan(0);
    const report = s.round.reports.at(-1)!;
    expect(report.met + Object.values(report.failedByCause).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10);
    expect(report.met / (report.met + Object.values(report.failedByCause).reduce((a, b) => a + b, 0))).toBeLessThan(0.8);
  });
});
