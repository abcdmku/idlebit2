import { describe, expect, it, vi } from 'vitest';
import { advanceGameOwned } from '../core/advance';
import { TICK_MS } from '../core/constants';
import { nextInt, seedRng } from '../core/rng';
import { PHASES } from '../core/tick';
import { startTransition } from '../core/timers';
import { newTouchLog } from '../core/touch';
import { commitWorld, openWorld, type World } from '../core/world';
import { backlogFor, recountBacklog } from '../exec/backlog';
import { killSubtree } from '../exec/kill';
import { primeMarket } from '../market/prime';
import { buildState } from '../testkit/builders';
import { MAX_FLEET } from '../testkit/fleets';
import { provisionInfrastructure } from '../testkit/infrastructure';
import { systemId } from '../types/ids';
import type { GameState } from '../types/state';
import { memo } from './routeMemo';
import { bruteRoomMin, roomMinOf } from './summary';

vi.setConfig({ testTimeout: 60_000 });

/** Three sites of two zones: site- and global-scope routing, gangs and the summaries all run. */
const fleet = (): GameState => advanceGameOwned(primeMarket(provisionInfrastructure(buildState({
  ...MAX_FLEET, sites: 3, zonesPerSite: 2, racksPerZone: 3, serversPerRack: 4,
})), 34), 200 * TICK_MS).state;

function expectSummaryExact(w: World): void {
  const kept = backlogFor(w, memo.phase).units;
  const brute = new Float64Array(w.compiled.sys.len);
  recountBacklog(w.compiled, w.hot, brute);
  expect([...kept]).toEqual([...brute]);
  for (let m = 0; m < w.compiled.room.len; m += 1) {
    if (w.compiled.room.alive[m] === 1) expect(roomMinOf(w, m)).toEqual(bruteRoomMin(w, m));
  }
}

describe('D24 routing summaries', () => {
  it('equal a brute-force recount after random kills, mode changes and real routing', () => {
    let state = fleet();
    const rng = { rng: new Uint32Array(4), g: new Float64Array(32) };
    seedRng(rng.rng, 7);
    let checks = 0;
    for (let call = 0; call < 6; call += 1) {
      // A new advance call each round: the backlog is kept across calls and checked against the records.
      const w = openWorld(state, true);
      w.touch = newTouchLog();
      for (let t = 0; t < 120; t += 1) {
        const roll = nextInt(rng, 0, 20);
        const s = nextInt(rng, 0, w.compiled.sys.len);
        if (w.compiled.sys.alive[s] === 1) {
          if (roll === 0) killSubtree(w, { kind: 'system', id: systemId(s) }, 'power');
          else if (roll === 1) startTransition(w, s, 'goingOffline');
          else if (roll === 2) startTransition(w, s, 'boot');
        }
        w.late = false;
        if (w.round.phase === 'running') w.report.activeTicks += 1;
        for (const [name, phase] of PHASES) {
          phase(w);
          // Right after routing the free-slot summaries are exact, so the minima must match.
          if (name === 'route' && w.round.phase === 'running') { expectSummaryExact(w); checks += 1; }
        }
        w.tick += 1;
      }
      state = commitWorld(state, w, 0);
    }
    expect(checks).toBeGreaterThan(600);
  });
});
