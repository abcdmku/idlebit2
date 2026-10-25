import { FAIL_CAUSES } from '../types/events';
import { advanceGame } from '../core/advance';
import { allocHot, cloneHot } from '../core/buffers';
import { MODE } from '../core/timers';
import { RATE_RING_TICKS } from '../core/constants';
import { createInitialState } from '../core/state';
import { familyId } from '../types/ids';
import type { QueuedTask } from '../types/state';
import { feedSnapshot, recentOutcomes } from './feed';
import { feedRates } from './feedRates';

const hotWithRing = (rows: { at: number; taken: number; met?: number; failed?: number; cause?: number }[]) => {
  const hot = allocHot({ systems: 0, racks: 0, rooms: 0, sites: 0, links: 0 });
  for (const r of rows) {
    const i = r.at % RATE_RING_TICKS;
    hot.ring.at[i] = r.at; hot.ring.taken[i] = r.taken; hot.ring.met[i] = r.met ?? 0; hot.ring.failed[i] = r.failed ?? 0;
    if (r.cause !== undefined) hot.ring.failBy[i * FAIL_CAUSES.length + r.cause] = r.failed ?? 0;
  }
  return hot;
};

describe('feed rates', () => {
  it('measures takes over the trailing 10 s and met and failed over 2 s, per second', () => {
    const rows = Array.from({ length: 100 }, (_, k) => ({ at: 199 - k, taken: 3, met: k < 20 ? 2 : 9, failed: k === 0 ? 4 : 0, cause: 1 }));
    expect(feedRates(hotWithRing(rows), 200)).toEqual({ takes: 30, met: 20, fail: 2, failBin: { cause: 'cantRun', perSec: 2 } });
  });

  it('ignores ring rows from skipped ticks or an earlier round', () => {
    const hot = hotWithRing([{ at: 199, taken: 5 }]);
    hot.ring.at[95] = -5; hot.ring.taken[95] = 50;
    expect(feedRates(hot, 200).takes).toBe(0.5);
  });
});

describe('the queue window and transfers (spec §16.2)', () => {
  it('clears every queue gate between rounds even though hardware is paused', () => {
    const base = createInitialState(42);
    const hot = cloneHot(base.hot);
    hot.sys.mode.fill(MODE.paused);
    for (const phase of ['ended', 'between'] as const) {
      const feed = feedSnapshot({ ...base, hot, round: { ...base.round, phase } }, null, false);
      expect(feed.blockedBy).toBeNull();
      expect(feed.window.every(task => task.blockedBy === null)).toBe(true);
    }
    expect(feedSnapshot({ ...base, hot }, null, false).blockedBy).toBe('cache');
  });

  it('shows the five next tasks with their work and transfer time, and the head clock', () => {
    const s = createInitialState(42);
    const feed = feedSnapshot(s, null, false);
    expect(feed).toMatchObject({ timing: 'running', roundIndex: 1, headDeadlineTick: 99, blockedBy: null, transfers: [] });
    expect(feed.window.map((t) => [t.task.taskId, t.label, t.work, t.transferS, t.dismissible])).toEqual(
      [1, 2, 3, 4, 5].map((id) => [id, 'Bit Flip', 1, 0.001, true]));
  });

  it('publishes a pipe transfer with its bits sent, size and speed while it travels', () => {
    const base = createInitialState(42);
    const head: QueuedTask = { ...base.market.window[0]!, size: 1500 };
    const s = advanceGame({ ...base, market: { ...base.market, window: [head, ...base.market.window.slice(1)] } }, 500).state;
    const feed = feedSnapshot(s, null, false);
    expect(feed.transfers).toEqual([{
      taskId: 1, family: head.family, systemId: 0, link: 'pipe', bitsSent: 500, bits: 1500, speed: 1000,
      shard: 0, shards: 1, units: 1500, from: null, to: { level: 'system', id: 0 }, key: 256,
    }]);
    expect(feed.inTransfer).toBe(1);
    // Only one transfer at a time and the core waits: #2 is the head, untaken.
    expect(feed.window[0]!.task.taskId).toBe(2);
  });

  it('lists the newest met and failed cohorts with their detail word, newest last', () => {
    const outcomes = recentOutcomes({
      nextSeq: 3,
      entries: [
        { kind: 'met', family: familyId(1), count: 2, system: null, rack: null, room: null, site: null, seq: 0, tick: 5 },
        { kind: 'roundStarted', round: 2, seq: 1, tick: 6 },
        { kind: 'failed', family: familyId(3), count: 1, cause: 'cantRun', detail: 'ram', seq: 2, tick: 7 },
      ],
    });
    expect(outcomes).toEqual([
      { family: 1, count: 2, outcome: 'met', detail: null, tick: 5 },
      { family: 3, count: 1, outcome: 'cantRun', detail: 'ram', tick: 7 },
    ]);
  });
});
