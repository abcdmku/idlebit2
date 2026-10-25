import { describe, expect, it, vi } from 'vitest';
import { advanceCooperatively, type OfflineAdvanceProgress } from './cooperativeAdvance';

describe('cooperative tick stepping', () => {
  it('yields on the wall deadline, reports progress and materializes once at the end', async () => {
    let wall = 0, tick = 0;
    const target = 10, yields = vi.fn(async () => {}), progress: OfflineAdvanceProgress[] = [];
    const materialize = vi.fn(() => ({ tick }));
    const result = await advanceCooperatively(shouldYield => {
      while (tick < target) { tick++; if (shouldYield()) return tick === target; }
      return true;
    }, materialize, { maxWallMs: 3, now: () => ++wall, yieldTask: yields,
      readProgress: () => ({ simulatedMs: tick * 100, totalMs: target * 100 }), onProgress: p => progress.push(p) });
    expect(result).toEqual({ tick: 10 });
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(progress.map(p => p.simulatedMs)).toEqual([300, 600, 900, 1000]);
    expect(yields).toHaveBeenCalledTimes(3);
  });

  it('cancels before materializing and rejects invalid wall budgets', async () => {
    const controller = new AbortController(), materialize = vi.fn();
    await expect(advanceCooperatively(() => false, materialize, { signal: controller.signal,
      yieldTask: async () => controller.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(materialize).not.toHaveBeenCalled();
    await expect(advanceCooperatively(() => true, materialize, { maxWallMs: 0 })).rejects.toThrow(RangeError);
  });
});
