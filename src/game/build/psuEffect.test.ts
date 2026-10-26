import { advanceGame } from '../core/advance';
import { viewW } from '../core/constants';
import { barebonesSpec } from '../core/defaults';
import { buildState } from '../testkit/builders';
import { systemId } from '../types/ids';
import type { GameState } from '../types/state';
import { selectResearchTree } from '../view/selectors';
import { quote } from './quotes';

/** One running system on a bench power supply at L9 (30% + 8 levels × 1% = 38% loss). */
function onBenchL9(): GameState {
  const spec = barebonesSpec(1);
  return buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max', credits: '1000000000',
    system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: { ...spec, psu: { gen: 0, level: 9, capped: false } } }),
  });
}

describe('power supply loss (research change and quotes)', () => {
  it('80 Plus research reads the installed supply\'s loss against the new one\'s', () => {
    const change = selectResearchTree(onBenchL9()).nodes.find((n) => n.id === 'psu80')!.change;
    expect(change).toEqual({ label: 'Power supply loss', before: '38%', after: '20%' });
  });

  it('a replace quote carries the loss before and after, and its watts and payback are the saving', () => {
    const s = advanceGame(onBenchL9(), 20_000).state;
    expect(s.hot.sys.drawW[0]).toBeGreaterThan(0);
    const replace = quote(s, { kind: 'part', part: { unit: { kind: 'system', id: systemId(0) }, slot: { kind: 'psu' } } }).quotes
      .find((q) => q.action.type === 'replacePart' && q.action.generation === 1 && !q.action.preserveCapacity)!;
    const e = replace.effect!;
    expect([Math.round(e.lossPctBefore!), Math.round(e.lossPctAfter!)]).toEqual([38, 20]);
    const draw = s.hot.sys.drawW[0]!;
    // Effect watts are view watts (POWER_SCALE).
    expect(e.wattsBefore).toBeCloseTo(viewW(draw * 1.38), 12);
    expect(e.wattsAfter).toBeCloseTo(viewW(draw * 1.2), 12);
    expect(e.paybackS).toBeGreaterThan(0);
  });
});
