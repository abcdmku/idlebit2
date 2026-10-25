import { advanceGame } from '../core/advance';
import { barebonesSpec } from '../core/defaults';
import { buildState } from '../testkit/builders';
import { systemId } from '../types/ids';
import type { ChipSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import { deriveRenderSnapshot } from './snapshot';

const chipOf = (s: GameState) => deriveRenderSnapshot(s, { focus: { level: 'chip', id: systemId(0) }, partner: null }).focus as ChipSnapshot;

describe('core live clock (spec §9.3)', () => {
  it('shows a sleeping core at 0 Hz with its C-state, and a running core at its DVFS-reduced clock', () => {
    // Four 1 Hz cores (a task spans ticks) with DVFS and C-states on: tasks run on some, the rest sleep.
    const spec = barebonesSpec(0), cpu = spec.cpu!;
    let s = buildState({
      seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max',
      system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: {
        ...spec, cpu: { ...cpu, cores: Array(4).fill({ gen: 0, level: 1 }) }, settings: { dvfs: true, turbo: false, cStateLimit: 6 },
      } }),
    });
    const reduced = (c: ChipSnapshot) => c.cores.some((k) => k.busy > 0 && k.hz < c.clock.hz) && c.cores.some((k) => k.sleep !== null);
    let chip = chipOf(s);
    for (let t = 0; t < 600 && !reduced(chip); t += 1) {
      s = advanceGame(s, 100).state;
      chip = chipOf(s);
    }
    const running = chip.cores.find((c) => c.busy > 0)!, asleep = chip.cores.find((c) => c.sleep !== null)!;
    expect(running).toMatchObject({ sleep: null, hz: chip.clock.hz * 0.5 });
    expect(asleep).toMatchObject({ busy: 0, hz: 0, sleep: 'C1' });
    // The nominal rate stays the core's full lanes × clock: only the live clock drops.
    expect(running.rate).toBe(asleep.rate);
    expect(running.rate).toBeGreaterThan(running.hz);
  });
});
