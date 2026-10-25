import { barebonesSpec } from '../core/defaults';
import { buildState } from '../testkit/builders';
import { rackId, systemId } from '../types/ids';
import { selectResearchTree } from './selectors';

describe('research part specs (the root headings)', () => {
  // A kHz system in an opened rack: four cores, two SDRAM sticks, no scheduler, GPU or room.
  const spec = barebonesSpec(1), cpu = spec.cpu!;
  const state = buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 2, unlocks: 'max',
    system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: {
      ...spec, cpu: { ...cpu, cores: Array(4).fill({ gen: 1, level: 1 }) },
      ram: [{ gen: 0, level: 1, ecc: false }, { gen: 0, level: 1, ecc: false }],
    } }),
  });

  it('reads each owned part at the focused system and its rack, and "none" for the rest', () => {
    const parts = selectResearchTree(state, { level: 'system', id: systemId(1) }).parts;
    expect({
      cores: parts.cores.spec, clock: parts.clock.spec, queue: parts.queue.spec, ram: parts.ram.spec,
      gpu: parts.gpu.spec, switch: parts.switch.spec, lb: parts.lb.spec, netRack: parts.netRack.spec,
    }).toEqual({
      cores: '4 cores · 2 lanes', clock: '1 kHz', queue: 'none', ram: 'SDRAM · 2 sticks',
      gpu: 'none', switch: '100 kHz · 4 ports', lb: 'FIFO · queue 1', netRack: 'none',
    });
  });

  it('reads a focused rack at its first system, and defaults to the first system', () => {
    expect(selectResearchTree(state, { level: 'rack', id: rackId(0) }).parts).toEqual(selectResearchTree(state).parts);
  });
});
