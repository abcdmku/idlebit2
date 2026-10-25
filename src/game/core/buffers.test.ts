import { allocCompiled, allocHot, cloneCompiled, cloneHot, SYS_HOT } from './buffers';
import { ACCEL_CLOCKS, ACCEL_DOMAINS, MAX_ACCELS } from './constants';
import { ensureRows, resetRow } from './table';

describe('accelerator buffer lifecycle', () => {
  it('allocates all physical, domain and clock strides with empty sentinels', () => {
    const size = { systems: 2, racks: 1, rooms: 1, sites: 1, links: 0 };
    const c = allocCompiled(size), h = allocHot(size);
    expect(c.sys.accelKind).toHaveLength(2 * MAX_ACCELS);
    expect(h.sys.accelHolders).toHaveLength(2 * ACCEL_DOMAINS);
    expect(h.sys.accelWAnchor).toHaveLength(2 * ACCEL_CLOCKS);
    expect([...h.sys.accelHead]).toEqual(Array(36).fill(-1));
    expect([...h.sys.accelDue]).toEqual(Array(36).fill(Infinity));
    expect([...h.rec.accelDomain]).toEqual(Array(h.rec.cap).fill(-1));
    c.sys.accelVram[8] = 123; h.sys.accelUsedVram[9] = 45; h.sys.accelTaskS[8] = 0.05;
    const cc = cloneCompiled(c), hh = cloneHot(h);
    expect(cc).toEqual(c); expect(hh).toEqual(h);
    cc.sys.accelVram[8] = 0; hh.sys.accelUsedVram[9] = 0;
    expect(c.sys.accelVram[8]).toBe(123); expect(h.sys.accelUsedVram[9]).toBe(45);
    resetRow(SYS_HOT, hh.sys, 1);
    expect(hh.sys.accelTaskS[8]).toBe(0); expect(hh.sys.accelDue[18]).toBe(Infinity);
    ensureRows(SYS_HOT, hh.sys, 5);
    expect(hh.sys.accelHead[4 * ACCEL_CLOCKS]).toBe(-1);
    expect(hh.sys.accelDue[4 * ACCEL_CLOCKS]).toBe(Infinity);
  });
});
