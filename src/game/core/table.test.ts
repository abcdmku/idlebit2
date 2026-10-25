import { allocTable, cloneTable, copyRow, ensureRows, growTable, resetRow } from './table';

const LAYOUT = { a: { t: 'f64' }, b: { t: 'i32', fill: -1 }, c: { t: 'u8', stride: 3 } } as const;

describe('SoA tables', () => {
  it('allocates with fills and strides', () => {
    const t = allocTable(LAYOUT, 2, 1);
    expect([t.len, t.cap]).toEqual([1, 2]);
    expect([...t.b]).toEqual([-1, -1]);
    expect(t.c.length).toBe(6);
  });

  it('grows by doubling, keeps data and fills new rows', () => {
    const t = allocTable(LAYOUT, 2);
    t.a[1] = 5; t.c[5] = 9;
    growTable(LAYOUT, t, 3);
    expect(t.cap).toBe(4);
    expect(t.a[1]).toBe(5);
    expect(t.c[5]).toBe(9);
    expect([...t.b]).toEqual([-1, -1, -1, -1]);
    ensureRows(LAYOUT, t, 7);
    expect([t.len, t.cap]).toEqual([7, 8]);
  });

  it('clones deeply and copies or resets rows', () => {
    const t = allocTable(LAYOUT, 2, 2);
    t.a[0] = 1; t.b[0] = 2; t.c[0] = 3; t.c[2] = 4;
    const copy = cloneTable(t);
    copy.a[0] = 100;
    expect(t.a[0]).toBe(1);
    copyRow(LAYOUT, t, 0, 1);
    expect([t.a[1], t.b[1], t.c[3], t.c[5]]).toEqual([1, 2, 3, 4]);
    resetRow(LAYOUT, t, 1);
    expect([t.a[1], t.b[1], t.c[3]]).toEqual([0, -1, 0]);
  });
});
