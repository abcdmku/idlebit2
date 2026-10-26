import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { createInitialState } from '../core/state';
import { compileAll } from '../core/topology';
import { deriveUnlocks, openContainers } from '../build/research/effects';
import { researchDef } from '../build/research/tree';
import { UNIT_MODES } from '../types/views';
import { researchId, systemId, type ResearchId } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { FailCause } from '../types/events';
import type { GameState } from '../types/state';
import { queueWindow } from '../view/feed';

/**
 * Sandbox bug (26 Oct): a 32-core GHz CPU on the board's starting power supply tripped it, the system went
 * dark, then its rack crashed, and every task read "Needs 1 b cache" beside 18.9 Mb of cache (SLA 0 %).
 * With no system able to take work, the fleet check fell back to the cache gate. It must name why the
 * fleet is down, and the head must fail for that reason (power, heat), never as a cache capability.
 */
const sys = systemId(0);
const RICH = ('1' + '0'.repeat(100)) as never;
// The sandbox's refill between advances: the wallet only, on the same state.
const refill = (s: GameState): GameState => ({ ...s, wallet: { ...s.wallet, credits: RICH, data: RICH } });

function overloadedGhzChip(): GameState {
  const base = createInitialState(42), done = new Set<ResearchId>();
  const add = (id: ResearchId) => { for (const r of researchDef(id)?.requires ?? []) add(r); done.add(id); };
  add(researchId('fabGhz'));
  const unlocks = deriveUnlocks([...done]), build = openContainers(base.build, unlocks);
  const research = { ...base.research, completed: [...done], unlocks };
  let s = refill({ ...base, research, build, compiled: compileAll(build, research) });
  const act = (a: GameAction) => { const o = applyAction(refill(s), a); if (!o.ok) throw new Error(JSON.stringify(o.rejection)); s = o.state; };
  act({ type: 'replaceCpu', system: sys });
  for (let i = 1; i < 32; i += 1) act({ type: 'addPart', system: sys, kind: 'core', generation: 3 });
  act({ type: 'addPart', system: sys, kind: 'l2', generation: 3 });
  for (let i = 0; i < 3; i += 1) act({ type: 'upgradePart', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'clock', socket: 0 } } });
  return s;
}

describe('a down fleet names why, never a cache gate', () => {
  it('a tripped power supply blocks the head with psu, then the crashed rack with rack, and fails tasks as power or heat', () => {
    let s = overloadedGhzChip();
    expect(s.compiled.sys.cacheBits[0]).toBeGreaterThan(1e9);
    const seen = new Map<string, Set<string | null>>();
    const failed: Partial<Record<FailCause, number>> = {};
    for (let t = 0; t < 40; t += 1) {
      const out = advanceGame(s, 1000);
      for (const [cause, n] of Object.entries(out.report.failedByCause)) failed[cause as FailCause] = (failed[cause as FailCause] ?? 0) + n;
      s = refill(out.state);
      const mode = UNIT_MODES[s.hot.sys.mode[0]!]!, head = queueWindow(s)[0];
      if (head) (seen.get(mode) ?? seen.set(mode, new Set()).get(mode)!).add(head.blockedBy);
    }
    // The supply trips under the load, then the rack overheats: both happen in this run.
    expect([...seen.keys()]).toEqual(expect.arrayContaining(['dark', 'crashed']));
    expect([...seen.get('dark')!]).toEqual(['psu']);
    expect([...seen.get('crashed')!]).toEqual(['rack']);
    for (const blocked of seen.values()) expect(blocked.has('cache')).toBe(false);
    expect((failed.power ?? 0) + (failed.heat ?? 0)).toBeGreaterThan(0);
    expect(failed.cantRun ?? 0).toBe(0);
  });
});
