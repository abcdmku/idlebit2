import { describe, expect, it } from 'vitest';
import { G } from '../../core/buffers';
import { createInitialState } from '../../core/state';
import { compileAll } from '../../core/topology';
import { commitWorld, openWorld } from '../../core/world';
import { researchId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { capacity } from '../catalog/curves';
import { PARTS } from '../catalog';
import { fullLoadWatts } from '../configModel';
import { deriveUnlocks } from './effects';
import { researchPhase } from './projects';
import { researchDef } from './tree';

/** QA-02: when System arrives, the board PSU (live from then on) covers the chip already built. */
describe('System arrival sizes the PSU', () => {
  function pushedChipJustBeforeSystem(): GameState {
    const base = createInitialState(42);
    const done = ['pipelining', 'fifoSched', 'dualCore', 'l2Cache'].map(researchId);
    const research = { ...base.research, completed: done, unlocks: deriveUnlocks(done), active: researchId('systemBoard'), activeProgress: researchDef('systemBoard')!.work - 1 };
    const sys = base.build.systems[0]!;
    const cpu = sys.spec.cpu!;
    // A 2-core Hz chip pushed far up its clock, as QA's run had by System.
    const spec = { ...sys.spec, cpu: { ...cpu, cores: [cpu.cores[0]!, cpu.cores[0]!], clock: { gen: 0, level: 22 } } };
    const build = { ...base.build, systems: base.build.systems.map((s, i) => (i === 0 && s ? { ...s, spec } : s)) };
    return { ...base, build, research, compiled: compileAll(build, research) };
  }

  it('raises the PSU, free, to the first level covering 1.25× full load, and power stays up', () => {
    const before = pushedChipJustBeforeSystem();
    const need = 1.25 * fullLoadWatts(before.build.systems[0]!.spec, deriveUnlocks([...before.research.completed, researchId('systemBoard')]));
    expect(capacity(PARTS.psu, 0, before.build.systems[0]!.spec.psu.level)).toBeLessThan(need);
    const w = openWorld(before);
    w.hot.g[G.researchOps] = 2;
    researchPhase(w);
    const after = commitWorld(before, w, 0);
    expect(after.research.unlocks.levels.system).toBe(true);
    const psu = after.build.systems[0]!.spec.psu;
    expect(capacity(PARTS.psu, psu.gen, psu.level)).toBeGreaterThanOrEqual(need);
    expect(capacity(PARTS.psu, psu.gen, psu.level - 1)).toBeLessThan(need);
    expect(after.wallet).toEqual(before.wallet);
  });
});
