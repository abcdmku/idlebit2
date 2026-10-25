import { advanceGameOwned } from '../core/advance';
import { RACKS_PER_ROOM } from '../core/constants';
import { openWorld, type World } from '../core/world';
import { recountSummaries } from '../exec/slots';
import { probeHead } from '../market/queue';
import { FLEETS } from '../testkit/fleets';
import { finish, finishBelow } from './finish';
import { beginDecision, withExactSummaries } from './routeMemo';
import { ROOM, SITE } from './scope';

/** A loaded room (24 top racks after 3 s of play: every rack admits, 6 distinct scores), summaries exact. */
function loadedRoom(): { w: World; r: number; racks: number[] } {
  const w = openWorld(advanceGameOwned(FLEETS.roomFull(), 3_000).state, true);
  recountSummaries(w);
  const r = probeHead(w);
  const racks = Array.from({ length: RACKS_PER_ROOM }, (_, k) => w.compiled.room.racks[k]!).filter((x) => x >= 0);
  return { w, r, racks };
}

describe('route-phase finish memos', () => {
  it('score every candidate exactly as the unmemoized definition', () => {
    const { w, r, racks } = loadedRoom();
    expect(r).toBeGreaterThanOrEqual(0);
    const direct = racks.map((rack) => finish(w, ROOM, rack, r));
    const room = finish(w, SITE, 0, r);
    expect(direct.some((v) => Number.isFinite(v))).toBe(true);
    let memoized: number[] = [], memoRoom = NaN;
    withExactSummaries(w, () => {
      beginDecision();
      memoized = racks.map((rack) => finish(w, ROOM, rack, r));
      memoRoom = finish(w, SITE, 0, r);
    });
    expect(memoized).toEqual(direct);
    expect(memoRoom).toBe(room);
    expect(room).toBe(Math.min(...direct));
  });

  it('is exact below the bound and at least the bound otherwise', () => {
    const { w, r, racks } = loadedRoom();
    const direct = racks.map((rack) => finish(w, ROOM, rack, r));
    const sorted = [...direct].filter(Number.isFinite).sort((a, b) => a - b);
    const bound = sorted[Math.floor(sorted.length / 2)]!;
    withExactSummaries(w, () => {
      beginDecision();
      racks.forEach((rack, i) => {
        const v = finishBelow(w, ROOM, rack, r, bound);
        if (direct[i]! < bound) expect(v).toBe(direct[i]);
        else expect(v).toBeGreaterThanOrEqual(bound);
      });
      expect(finishBelow(w, SITE, 0, r, bound)).toBe(sorted[0]);
    });
  });
});
