import { describe, expect, it } from 'vitest';
import { entry } from '../hooks/testShell';
import { advanceConveyor, type Conveyor, type ConveyorInput } from './conveyor';

const win = (...ids: number[]) => ids.map(id => entry(id));
const input = (ids: number[], taken = 0, dismissed = 0, round = '1:1:running', frozen = false): ConveyorInput => ({ window: win(...ids), taken, dismissed, round, frozen });
const none = new Set<string>();
const view = (c: Conveyor) => c.items.map(i => `${i.task.task.taskId}@${i.slot}${i.leave ? `:${i.leave}` : ''}`);

describe('queue conveyor', () => {
  const first = advanceConveyor(null, input([1, 2, 3, 4, 5]), none);

  it('starts still: the first window has no motion', () => {
    expect(first.animate).toBe(false);
    expect(view(first)).toEqual(['1@0', '2@1', '3@2', '4@3', '5@4']);
  });

  it('a taken head leaves into the pipe and the rest move one slot toward the head', () => {
    const next = advanceConveyor(first, input([2, 3, 4, 5, 6], 1), none);
    expect(next.animate).toBe(true);
    expect(view(next)).toEqual(['1@0:taken', '2@0', '3@1', '4@2', '5@3', '6@4']);
    expect(next.from.get('1:1:2')).toBe(1);
    expect(next.from.has('1:1:6')).toBe(false);
  });

  it('names a dismissal and a failure from the round counters', () => {
    expect(view(advanceConveyor(first, input([2, 3, 4, 5, 6], 0, 1), none))[0]).toBe('1@0:dismissed');
    expect(view(advanceConveyor(first, input([2, 3, 4, 5, 6]), none))[0]).toBe('1@0:failed');
    // Two leave in one publish: one taken, then one timed out behind it.
    expect(view(advanceConveyor(first, input([3, 4, 5, 6, 7], 1), none)).slice(0, 3)).toEqual(['1@0:taken', '2@1:failed', '3@0']);
  });

  it('keeps a leaving task until its exit expires, and is idempotent', () => {
    const next = advanceConveyor(first, input([2, 3, 4, 5, 6], 1), none);
    const again = advanceConveyor(next, input([2, 3, 4, 5, 6], 1), none);
    expect(view(again)).toEqual(view(next));
    expect(view(advanceConveyor(first, input([2, 3, 4, 5, 6], 1), none))).toEqual(view(next));
    const done = advanceConveyor(next, input([2, 3, 4, 5, 6], 1), new Set(['1:1:1']));
    expect(view(done)).toEqual(['2@0', '3@1', '4@2', '5@3', '6@4']);
    expect([...done.from.values()]).toEqual([0, 1, 2, 3, 4]);
  });

  it('swaps without motion when the round changes or the whole window turns over', () => {
    expect(advanceConveyor(first, input([1, 2, 3, 4, 5], 0, 0, '1:2:running'), none).animate).toBe(false);
    // between rounds the next round's queue is frozen: a change never slides
    expect(advanceConveyor(first, input([2, 3, 4, 5, 6], 1, 0, '1:1:running', true), none).animate).toBe(false);
    const flood = advanceConveyor(first, input([11, 12, 13, 14, 15], 5), none);
    expect(flood.animate).toBe(false);
    expect(view(flood)).toEqual(['11@0', '12@1', '13@2', '14@3', '15@4']);
  });

  it('returned work that comes back to the front is no longer leaving, and pushes the last task out', () => {
    const next = advanceConveyor(first, input([2, 3, 4, 5, 6], 1), none);
    // and the task it displaces is pushed out of the back
    expect(view(advanceConveyor(next, input([1, 2, 3, 4, 5], 1), none))).toEqual(['6@4:pushed', '1@0', '2@1', '3@2', '4@3', '5@4']);
  });
});
