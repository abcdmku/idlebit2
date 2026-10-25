import { describe, expect, it } from 'vitest';
import { causeText, feedView, payoutText, sizeText, taskKey, transferText } from './feedModel';
import { headFraction } from './headClock';
import { blockedText, requirementText } from './taskRequirements';
import { baseSnapshot, editSnapshot, entry } from './testShell';
import { clockText, slaFill, wholeText } from './format';

describe('published task queue', () => {
  it('reads the window head first, the head clock and the transfer on the pipe', () => {
    const s = baseSnapshot();
    const v = feedView(s);
    expect(v.head).toBe(s.feed.window[0]);
    expect(v.running).toBe(true);
    expect(v.transfer).toBeNull();
    expect(feedView(editSnapshot(s, { feed: { timing: 'onReturn', headDeadlineTick: null } })).running).toBe(false);
    expect(taskKey({ epoch: 2, roundIndex: 3, taskId: 42 })).toBe('2:3:42');
  });
  it('runs only the head clock: 10 s from its deadline tick, none between rounds', () => {
    expect(headFraction(99, 0)).toBe(1);
    expect(headFraction(99, 3000)).toBeCloseTo(0.7, 6);
    expect(headFraction(99, 12_000)).toBe(0);
    expect(headFraction(null, 0)).toBeNull();
  });
  it('words a task: payout, size, transfer time', () => {
    expect([payoutText({ work: 1000 }), payoutText({ work: 28_400 })]).toEqual(['+1,000', '+28.4k']);
    expect(sizeText({ work: 2, workingSetBits: 1 })).toBe('2 ops · 1 bit');
    expect(sizeText({ work: 1, workingSetBits: 16 })).toBe('1 op · 16 bits');
    expect([transferText(0.001), transferText(0.25), transferText(1), transferText(12.5)]).toEqual(['1 ms', '0.25 s', '1.00 s', '12.5 s']);
  });
  it('shows exact small capacities and separate work, thread, GPU and member facts', () => {
    const task = { ...entry(1), stages: [{ resource: 'cpu' as const, work: 2 }, { resource: 'ram' as const, work: 8 }],
      threads: 4, workingSetBits: 2, gpuCoresMin: 64, vramBits: 1024, members: 8, blockedBy: 'cache' as const };
    const text = requirementText(task);
    for (const fact of ['CPU 2 ops', 'RAM 8 bits', '2 bits cache / RAM', '4 threads max', '64 GPU cores', '1024 bits VRAM', '8 members']) expect(text).toContain(fact);
    expect(blockedText(task)).toBe('Needs 2 bits cache');
    expect(causeText('cantRun', 'gpuCores')).toBe("Can't run · GPU cores");
  });
});
describe('formatting', () => {
  it('prints whole numbers only', () => {
    expect([wholeText(1239), wholeText(28_400), wholeText(1_480_000), wholeText(413_000_000), wholeText(9999.6)])
      .toEqual(['1,239', '28.4k', '1.48M', '413M', '10k']);
    expect([clockText(38_000), clockText(845_000), clockText(3_729_000)]).toEqual(['0:38', '14:05', '1:02:09']);
    expect([slaFill(80), slaFill(100), slaFill(50)]).toEqual([50, 100, 0]);
    expect(causeText('timeout', 'link')).toBe('Timed out · Link');
  });
});
