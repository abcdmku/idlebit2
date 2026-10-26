import { POWER_SCALE } from '../core/constants';
import { applyAction } from '../core/actions';
import { baseRouter } from '../core/defaults';
import { buildState } from '../testkit/builders';
import { rackId, roomId, siteId } from '../types/ids';
import type { Quote } from '../types/quotes';
import type { GameState } from '../types/state';
import { capacity } from './catalog/curves';
import { GENERATION, POWER_CTL } from './catalog/infra';
import { defaultStartCtl } from './startCtl';
import { quote } from './quotes';

/** Two zones of two racks (Room and Global open), everything researched, a global scheduler. */
const world = (powerCtl = false): GameState => buildState({
  seed: 42, sites: 1, zonesPerSite: 2, racksPerZone: 2, serversPerRack: 2, unlocks: 'max', credits: '1000000000000000000000',
  rack: (r) => ({ ...r, powerCtl: powerCtl ? defaultStartCtl(0, 1) : null }), global: { scheduler: baseRouter(0), start: null },
});
const shape = (qs: readonly Quote[]) => qs.map((q) => [q.action.type, 'generation' in q.action ? q.action.generation : null, q.effect?.unit ?? null]);

describe('D31 power part quotes', () => {
  it('quotes Power control in J: installs from nothing, then the level and the other generations', () => {
    const empty = quote(world(), { kind: 'power', unit: { kind: 'rack', id: rackId(0) } }).quotes;
    expect(shape(empty)).toEqual([['replacePart', 0, 'J'], ['replacePart', 1, 'J'], ['replacePart', 2, 'J']]);
    expect([empty[0]!.effect?.capacityBefore, empty[0]!.effect?.capacityAfter]).toEqual([0, capacity(POWER_CTL, 0, 1) * POWER_SCALE]);
    const installed = quote(world(true), { kind: 'infra', unit: { kind: 'rack', id: rackId(0) }, slot: 'powerCtl' }).quotes;
    expect(shape(installed)).toEqual([['upgradePart', null, 'J'], ['replacePart', 1, 'J'], ['replacePart', 2, 'J']]);
    expect([installed[0]!.effect?.capacityBefore, installed[0]!.effect?.capacityAfter]).toEqual([capacity(POWER_CTL, 0, 1) * POWER_SCALE, capacity(POWER_CTL, 0, 2) * POWER_SCALE]);
  });

  it('quotes site generation: one install per generation in W, then the level and replaces', () => {
    let s = world();
    const empty = quote(s, { kind: 'power', unit: { kind: 'site', id: siteId(0) } }).quotes;
    expect(shape(empty)).toEqual([0, 1, 2, 3].map((g) => ['replacePart', g, 'W']));
    expect(empty[0]!.effect?.capacityAfter).toBe(capacity(GENERATION, 0, 1) * POWER_SCALE);
    s = applyAction(s, empty[0]!.action).state;
    expect(s.build.sites[0]!.generation).toEqual({ gen: 0, level: 1 });
    expect(shape(quote(s, { kind: 'power', unit: { kind: 'site', id: siteId(0) } }).quotes))
      .toEqual([['upgradePart', null, 'W'], ['replacePart', 1, 'W'], ['replacePart', 2, 'W'], ['replacePart', 3, 'W']]);
  });

  it.each([
    ['room', { kind: 'room', id: roomId(0) }],
    ['global', { kind: 'global' }],
  ] as const)('quotes the %s start controller: installs, then its level and the other generation', (_, unit) => {
    let s = world();
    const empty = quote(s, { kind: 'power', unit }).quotes;
    expect(shape(empty)).toEqual([['replacePart', 0, null], ['replacePart', 1, null]]);
    s = applyAction(s, empty[0]!.action).state;
    expect(shape(quote(s, { kind: 'power', unit }).quotes)).toEqual([['upgradePart', null, null], ['replacePart', 1, null]]);
  });
});
