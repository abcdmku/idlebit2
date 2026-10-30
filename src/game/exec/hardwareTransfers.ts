import { LOC } from '../core/buffers';
import { linkList, pushBack } from '../core/pool';
import type { World } from '../core/world';
import { dropJoinHint, rescanActive } from '../net/fifo';
import { linkOf } from '../net/paths';
import { CAUSE, failRecord } from './outcome';

/** Recompiled link indices can move. Keep each transfer's remaining bits and latency. */
export function reconcileHardwareTransfers(w: World, old: World): void {
  const before = old.compiled, after = w.compiled;
  const same = before.link.len === after.link.len && before.link.kind.every((kind, i) =>
    i >= before.link.len || kind === after.link.kind[i] && before.link.owner[i] === after.link.owner[i])
    && before.rack.portLink.every((link, i) => link === after.rack.portLink[i])
    && before.sys.port.every((port, i) => port === after.sys.port[i]);
  if (same) return;
  const rec = w.hot.rec, h = w.hot.link;
  const rows: { r: number; link: number; oldLink: number }[] = [];
  for (let link = 0; link < before.link.len; link++) {
    for (let r = h.head[link]!; r >= 0; r = rec.next[r]!) rows.push({ r, link: linkOf(w, rec.target[r]!, before.link.kind[link]!), oldLink: link });
  }
  for (const row of rows) if (row.link < 0 && rec.loc[row.r] === LOC.link) failRecord(old, row.r, CAUSE.swap);
  const clocks = h.bitClock.slice();
  h.head.fill(-1); h.tail.fill(-1); h.qlen.fill(0); h.backlog.fill(0); h.busyS.fill(0); h.bitClock.fill(0);
  const mapped = new Set<string>();
  for (const { r, link, oldLink } of rows) {
    if (link < 0 || rec.loc[r] !== LOC.link) continue;
    rec.owner[r] = link;
    pushBack(w.hot, linkList(w.hot, link), r);
    h.backlog[link] = h.backlog[link]! + Math.max(0, rec.finish[r]!);
    const key = `${oldLink}:${link}`;
    if (!mapped.has(key)) { h.bitClock[link] = h.bitClock[link]! + clocks[oldLink]!; mapped.add(key); }
    dropJoinHint(w.hot, link);
  }
  rescanActive(w.hot, null);
}
