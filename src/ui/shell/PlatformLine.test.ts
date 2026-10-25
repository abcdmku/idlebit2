import { describe, expect, it } from 'vitest';
import { familyId, type GameEvent, type FailureView } from '../../game';
import { baseSnapshot, editSnapshot } from '../hooks/testShell';
import { failureText, newsSince } from './PlatformLine';

const fail = (seq: number, tick: number): FailureView => ({ seq, tick, tau: 0, taskId: seq, type: 'compute' as never, family: familyId(0), cause: 'cantRun' });
const cohort = (seq: number, tick: number): GameEvent => ({ seq, tick, kind: 'failed', family: familyId(0), count: 1, cause: 'cantRun', detail: 'cache' });

describe('platform line news (A11, A16)', () => {
  it('names the newest failure with its cause and detail, once', () => {
    const s = editSnapshot(baseSnapshot(), { failures: [fail(1, 40), fail(2, 41)] as never, events: [cohort(7, 41)] as never });
    const news = newsSince(s, { failure: 0, event: 0 });
    expect(news.failure && failureText(news.failure)).toBe('✕ Bit Flip · Can\'t run · cache');
    expect(news.seen).toEqual({ failure: 2, event: 7 });
    expect(newsSince(s, news.seen).failure).toBeNull();
  });
  it('announces a new round', () => {
    const s = editSnapshot(baseSnapshot(), { events: [{ seq: 3, tick: 0, kind: 'roundStarted', round: 2 }] as never });
    expect(newsSince(s, { failure: 0, event: 0 }).round).toBe(2);
  });
});

describe('platform notices in player words', () => {
  it('a save reset reads as a one-time player message; other notices pass through', async () => {
    const { noticeText } = await import('./PlatformLine');
    expect(noticeText('Save reset: Save version 8 is not 10')).toEqual({ text: 'New version: your save was reset.', once: true });
    expect(noticeText('Saving is off')).toEqual({ text: 'Saving is off', once: false });
    expect(noticeText(null)).toBeNull();
  });
});
