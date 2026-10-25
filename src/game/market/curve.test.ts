import { nextIntensity, taskSize, tasksPerUnit } from './curve';
import { advanceGame } from '../core/advance';
import { applyAction } from '../core/actions';
import { createInitialState } from '../core/state';

describe('intensity curve (D30, D20, tasks.md §3)', () => {
  it('advances I one task at a time: k(I) = 9 + 0.3 I + 0.03 I² tasks per unit', () => {
    expect([tasksPerUnit(0), tasksPerUnit(10), tasksPerUnit(20)]).toEqual([9, 15, 27]);
    expect(nextIntensity(0)).toBeCloseTo(1 / 9, 12);
    let I = 0;
    for (let n = 0; n < 9; n += 1) I = nextIntensity(I);
    // k grows with I, so nine draws fall just short of one unit.
    expect(I).toBeGreaterThan(0.98);
    expect(I).toBeLessThan(1);
  });

  it('starts every round from I = 0 and advances only when a task is drawn, never with time', () => {
    const boot = createInitialState(42);
    // The five visible tasks were drawn from I = 0, one step each; the next draw is the sixth.
    let fifth = 0;
    for (let n = 0; n < 5; n += 1) fifth = nextIntensity(fifth);
    expect(boot.market.intensity).toBeCloseTo(fifth, 12);
    // A head that nothing takes holds I still: only its failure draws a replacement.
    const dismissed = applyAction(boot, { type: 'dismissTask', task: { epoch: 0, roundIndex: 1, taskId: 1 } });
    if (!dismissed.ok) throw new Error('dismiss');
    expect(dismissed.state.market.intensity).toBeCloseTo(nextIntensity(fifth), 12);
    // Round 2 opens at the beginning again, whatever round 1 reached.
    let s = boot;
    for (let i = 0; i < 6000 && s.round.index === 1; i += 1) s = advanceGame(s, 100).state;
    expect(s.round.reports[0]!.peakIntensity).toBeGreaterThan(1);
    expect(s.market.intensity).toBeCloseTo(fifth, 12);
  });

  it('sizes tasks in whole units, at least 1; a minimum split at least members × grain (D25.6)', () => {
    expect(taskSize(0, 0.8, 1, 4096)).toBe(1);
    expect(taskSize(10, 1, 1, 4096)).toBe(362);
    expect(taskSize(0, 1, 4, 64)).toBe(256);
    expect(taskSize(10, 1, 4, 64)).toBe(362);
  });
});
