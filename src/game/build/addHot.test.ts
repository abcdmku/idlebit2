import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { G } from '../core/buffers';
import { barebonesSpec } from '../core/defaults';
import { MODE } from '../core/timers';
import { buildState } from '../testkit/builders';
import { systemId } from '../types/ids';
import type { GameState } from '../types/state';

/** One 1 Hz core and no scheduler, mid-round: one task runs, nothing queues, the head waits. */
function fullSystem(): GameState {
  let s: GameState = buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max', credits: '1000000000',
    system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: barebonesSpec(0) }),
  });
  const full = () => s.hot.sys.running[0] === 1 && s.hot.sys.pipeRec[0] === -1 && s.hot.sys.reserved[0] === 0 && s.market.window.length > 0;
  for (let t = 0; t < 600 && !full(); t += 1) s = advanceGame(s, 100).state;
  expect(full()).toBe(true);
  return s;
}

describe('adding into an empty slot is hot (spec §4.5)', () => {
  it('adds a queue mid-round without a restart, and the next take uses it that tick', () => {
    let s = fullSystem();
    const taken = s.hot.g[G.taken]!;
    const add = applyAction(s, { type: 'addPart', system: systemId(0), kind: 'scheduler', generation: 0 });
    expect(add.ok).toBe(true);
    s = add.state;
    expect(s.compiled.sys.Q[0]).toBeGreaterThan(0);
    expect([s.hot.sys.mode[0], s.hot.sys.running[0]]).toEqual([MODE.onMarket, 1]);
    s = advanceGame(s, 100).state;
    expect(s.hot.sys.mode[0]).toBe(MODE.onMarket);
    expect(s.hot.g[G.taken]!).toBeGreaterThan(taken);
  });

  it('adds a CPU mid-round without a restart: the running task keeps going', () => {
    let s = fullSystem();
    const task = s.hot.sys.head[0]!, id = s.hot.rec.taskId[task];
    const add = applyAction(s, { type: 'addPart', system: systemId(0), kind: 'socket', generation: 0 });
    expect(add.ok).toBe(true);
    s = add.state;
    expect(s.compiled.sys.sockets[0]).toBe(2);
    expect([s.hot.sys.mode[0], s.hot.sys.running[0], s.hot.rec.taskId[s.hot.sys.head[0]!]]).toEqual([MODE.onMarket, 1, id]);
    s = advanceGame(s, 100).state;
    expect(s.hot.sys.mode[0]).toBe(MODE.onMarket);
    expect(s.hot.g[G.failed]).toBe(0);
  });
});
