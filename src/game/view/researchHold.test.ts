import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { barebonesSpec } from '../core/defaults';
import { buildState } from '../testkit/builders';
import { systemId } from '../types/ids';
import type { RoundPhase, GameState } from '../types/state';
import { selectResearchTree } from './selectors';

/** One rack of `n` servers with four 1 Hz cores each, in round phase `round`. */
function fleet(n: number, round: RoundPhase): GameState {
  const spec = barebonesSpec(0), cpu = spec.cpu!;
  return buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: n, unlocks: 'max', round,
    system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: { ...spec, cpu: { ...cpu, cores: Array(n === 1 ? 1 : 4).fill({ gen: 0, level: 1 }) } } }),
  });
}
/** Research ops/s of one of system s's threads, as exec runs it. */
const perThread = (s: GameState, id: number) => s.compiled.sys.threadRate[id]! * s.hot.sys.clockFactor[id]! * s.compiled.sys.etaCfg[id]!;

describe('research hold estimates (D27)', () => {
  it('during a round, a busy single core still counts one thread once taken, and nothing to take now', () => {
    let s = fleet(1, 'running');
    for (let t = 0; t < 600 && !(s.hot.sys.running[0] === 1 && s.hot.sys.busyThreads[0]! >= s.compiled.sys.threads[0]!); t += 1) s = advanceGame(s, 100).state;
    expect(s.hot.sys.running[0]).toBe(1);
    const tree = selectResearchTree(s);
    expect(tree.holdOpsPerSec).toBe(0);
    expect(tree.takenOpsPerSec).toBeGreaterThan(0);
    expect(tree.takenOpsPerSec).toBe(perThread(s, 0));
  });

  it('during a round, a multi-thread system holds one thread, not every free one', () => {
    const s = fleet(2, 'running');
    expect(s.compiled.sys.threads[0]).toBeGreaterThan(1);
    const tree = selectResearchTree(s);
    expect(tree.takenOpsPerSec).toBe(perThread(s, 0) + perThread(s, 1));
    expect(tree.holdOpsPerSec).toBe(perThread(s, 0) + perThread(s, 1));
  });

  it('between rounds, counts every thread of the paused online servers and none of one switched off', () => {
    const base = fleet(3, 'between');
    const s = applyAction(base, { type: 'setOnline', unit: { kind: 'system', id: systemId(2) }, online: false }).state;
    const all = (id: number) => perThread(s, id) * s.compiled.sys.threads[id]!;
    const tree = selectResearchTree(s);
    expect(tree.takenOpsPerSec).toBe(all(0) + all(1));
    expect(tree.holdOpsPerSec).toBe(all(0) + all(1));
  });
});
