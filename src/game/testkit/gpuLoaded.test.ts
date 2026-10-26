import { accelNeed, chooseAccel } from '../core/accelerators';
import { MAX_ACCELS } from '../core/constants';
import { FAMILIES } from '../market/families';
import { gpuLoadedState } from './gpuLoaded';

describe('powered GPU stress fixture preparation', () => {
  it('uses real paired devices, fitting lifetime holds and enough catalog power before any advance', () => {
    const s = gpuLoadedState(), c = s.compiled.sys;
    expect(c.gpuLinked[0]).toBe(0);
    expect(s.hot.sys.queueLen[0]).toBe(MAX_ACCELS);
    // D34: every core (thread) runs a task, so the running limit is the thread count.
    expect(c.keff[0]).toBe(c.threads[0]);
    expect(s.build.systems[0]!.spec.accels).toEqual(Array.from({ length: 8 }, () => ({ kind: 'gpu', model: '1530', upgrades: 5 })));
    const family = FAMILIES.find((f) => f.key === 'rayTrace')!, need = accelNeed(family, 2 ** 23);
    const choice = chooseAccel(s.compiled, null, 0, need, 8)!;
    expect(choice.take).toBe(1);
    expect(need.vramBits).toBe(c.accelVram[0]);
    const fullW = c.coreIdleW[0]! + c.coreLoadW[0]! + c.clockIdleW[0]!
      + [0, 1, 2, 3].reduce((n, r) => n + c.idleW[r]! + c.loadW[r]!, 0)
      + Array.from({ length: MAX_ACCELS }, (_, p) => c.accelIdleW[p]! + c.accelLoadW[p]!).reduce((n, w) => n + w, 0);
    expect(fullW).toBeGreaterThan(7e7);
    expect(fullW).toBeLessThan(c.psuCapW[0]!);
    expect(fullW * 12).toBeLessThan(s.compiled.rack.coolerQc[0]!);
    expect(fullW * 12 * 1.3 + s.compiled.rack.coolerIdleW[0]! + s.compiled.rack.coolerLoadW[0]!)
      .toBeLessThan(s.compiled.rack.pduCapW[0]!);
  });
});
