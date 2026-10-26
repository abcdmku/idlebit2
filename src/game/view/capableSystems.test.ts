import { applyAction } from '../core/actions';
import { barebonesSpec } from '../core/defaults';
import { FAMILIES } from '../market/families';
import { buildState } from '../testkit/builders';
import { familyId, systemId } from '../types/ids';
import { queueWindow } from './feed';

it('counts the online systems whose fixed hardware can run each queued task', () => {
  // Four kHz servers; even slots carry a GPU. Then GPU server 2 is switched offline.
  const spec = barebonesSpec(1);
  let s = buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 4, unlocks: 'max',
    system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: slot % 2 === 0 ? { ...spec, accels: [{ kind: 'gpu', model: '1330', upgrades: 0 }] } : spec }),
  });
  s = applyAction(s, { type: 'setOnline', unit: { kind: 'system', id: systemId(2) }, online: false }).state;
  const fam = (key: string) => familyId(FAMILIES.findIndex((f) => f.key === key));
  const id = s.market.window[0]!.taskId;
  s = { ...s, market: { ...s.market, window: [{ ...s.market.window[0]!, taskId: id, family: fam('imageBlur'), size: 64 }, { ...s.market.window[1]!, taskId: id + 1, family: fam('bitFlip'), size: 1 }] } };
  expect(queueWindow(s).map((e) => [e.family, e.capableSystems])).toEqual([[fam('imageBlur'), 1], [fam('bitFlip'), 3]]);
});
