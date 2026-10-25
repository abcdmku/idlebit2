import { RESEARCH } from '../build/research/tree';
import { fixtureState } from './fixtures';
import { derivePart } from './researchParts';
import { selectResearchTree } from './selectors';

describe('research roots and tabs (concept C)', () => {
  const nodes = selectResearchTree(fixtureState('chipBoot')).nodes;
  const byId = new Map<string, (typeof nodes)[number]>(nodes.map((n) => [n.id, n]));

  it('gives every node a part and a tab, deriving a real part for all but the structure nodes', () => {
    expect(nodes).toHaveLength(RESEARCH.length);
    for (const n of nodes) {
      expect(n.part, n.id).toBeTruthy();
      expect(['cpu', 'system', 'rack', 'room', 'global'], n.id).toContain(n.tab);
    }
    expect(RESEARCH.filter((d) => derivePart(d) === null).map((d) => d.id)).toEqual([]);
    expect(nodes.filter((n) => n.part === 'structure').map((n) => n.id).sort()).toEqual([
      'dataCenter', 'hallExpansion', 'intercontinental', 'rack', 'regions', 'room', 'systemBoard', 'zoneExpansion',
    ]);
  });

  it.each([
    ['outOfOrder', 'clock', 'cpu'], ['simd', 'clock', 'cpu'], ['wideVector', 'clock', 'cpu'], ['smt', 'cores', 'cpu'],
    ['stacked3d', 'cache', 'cpu'], ['mlfq', 'queue', 'cpu'], ['ddr5', 'ram', 'system'], ['gpuGen9', 'gpu', 'system'],
    ['closedLoop2', 'roomCooling', 'room'], ['bbSubsea', 'backbone', 'global'],
    ['branchPredict', 'clock', 'cpu'], ['fma', 'clock', 'cpu'], ['dualVector', 'clock', 'cpu'], ['matrixTiles', 'clock', 'cpu'],
    ['ringBus', 'cores', 'cpu'], ['meshCores', 'cores', 'cpu'], ['l3Slices', 'cache', 'cpu'], ['edramL3', 'cache', 'cpu'],
    ['fabKhz', 'fab', 'cpu'], ['fabMhz', 'fab', 'cpu'], ['fabGhz', 'fab', 'cpu'], ['rack', 'structure', 'rack'], ['dataCenter', 'structure', 'global'],
  ] as const)('%s grows from %s on the %s tab, whatever era it unlocks in', (id, part, tab) => {
    expect(byId.get(id)).toMatchObject({ part, tab });
  });
});
