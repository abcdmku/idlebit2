import { allocHot, G } from './buffers';
import { addSibling, allocParent, allocRecord, dropSibling, frontList, forEachInList, freeParent, freeRecord, insertBefore, pushBack, splitRecord, unlink } from './pool';

const hot = () => allocHot({ systems: 1, racks: 1, rooms: 1, sites: 1, links: 0 }, 2);
const listed = (h: ReturnType<typeof hot>) => { const out: number[] = []; forEachInList(h, frontList(h), (r) => out.push(r)); return out; };

describe('record pool and lists', () => {
  it('allocates, grows, frees and reuses records', () => {
    const h = hot();
    const ids = [allocRecord(h), allocRecord(h), allocRecord(h)];
    expect(ids).toEqual([0, 1, 2]);
    expect(h.rec.cap).toBe(4);
    expect(h.g[G.recUsed]).toBe(3);
    freeRecord(h, 1);
    expect(h.g[G.recUsed]).toBe(2);
    expect(allocRecord(h)).toBe(1);
    expect(h.rec.owner[1]).toBe(-1);
  });

  it('splits a cohort into an unlinked record with the same fields', () => {
    const h = hot();
    const r = allocRecord(h);
    h.rec.count[r] = 6; h.rec.family[r] = 3; h.rec.taken[r] = 17; h.rec.units[r] = 1.1; h.rec.taskId[r] = 100;
    pushBack(h, frontList(h), r);
    const s = splitRecord(h, r, 2);
    expect([h.rec.count[r], h.rec.count[s], h.rec.family[s], h.rec.taken[s], h.rec.units[s]]).toEqual([4, 2, 3, 17, 1.1]);
    expect([h.rec.prev[s], h.rec.next[s]]).toEqual([-1, -1]);
    expect([h.rec.taskId[s], h.rec.taskId[r]]).toEqual([100, 102]);
    expect(() => splitRecord(h, r, 4)).toThrow();
  });

  it('keeps head, tail and length through push, insert and unlink', () => {
    const h = hot();
    const [a, b, c] = [allocRecord(h), allocRecord(h), allocRecord(h)];
    const feed = frontList(h);
    pushBack(h, feed, a);
    pushBack(h, feed, c);
    insertBefore(h, feed, b, c);
    expect(listed(h)).toEqual([a, b, c]);
    expect(h.g[G.frontLen]).toBe(3);
    unlink(h, feed, a);
    unlink(h, feed, c);
    expect(listed(h)).toEqual([b]);
    expect([h.g[G.frontHead], h.g[G.frontTail], h.g[G.frontLen]]).toEqual([b, b, 1]);
    unlink(h, feed, b);
    expect([h.g[G.frontHead], h.g[G.frontTail], h.g[G.frontLen]]).toEqual([-1, -1, 0]);
  });

  it('reuses freed parent rows and unlinks a freed shard from its siblings', () => {
    const h = hot();
    const p0 = allocParent(h), p1 = allocParent(h);
    expect([p0, p1]).toEqual([0, 1]);
    freeParent(h, p0);
    expect([allocParent(h), h.g[G.parentUsed]]).toEqual([0, 2]);
    const a = allocRecord(h), b = allocRecord(h), c = allocRecord(h);
    for (const r of [a, b, c]) addSibling(h, p1, r);
    freeRecord(h, b);
    const sibs: number[] = [];
    for (let r = h.parent.head[p1]!; r >= 0; r = h.rec.sib[r]!) sibs.push(r);
    expect([sibs, h.rec.parent[b]]).toEqual([[c, a], -1]);
    dropSibling(h, a);
    expect(h.parent.head[p1]).toBe(c);
  });

  it('preserves a running split domain and resets it when the record is reused', () => {
    const h = hot(), r = allocRecord(h);
    h.rec.count[r] = 5; h.rec.accelDomain[r] = 8;
    h.sys.accelHolders[8] = 5; h.sys.accelUsedVram[8] = 50;
    const s = splitRecord(h, r, 2);
    expect([h.rec.accelDomain[r], h.rec.accelDomain[s]]).toEqual([8, 8]);
    expect([h.sys.accelHolders[8], h.sys.accelUsedVram[8]]).toEqual([5, 50]);
    freeRecord(h, s);
    expect(h.rec.accelDomain[s]).toBe(-1);
    expect(h.rec.accelDomain[allocRecord(h)]).toBe(-1);
  });
});
