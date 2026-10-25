import { applyAction } from '../core/actions';
import { buildState } from '../testkit/builders';
import { rackId } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';
import { defaultStartCtl } from './startCtl';
import { deserializeSave, serializeSave } from '../save/serialize';

/** D31.2: setStartConfig is hot, free and validated against the controller's generation and scope. */
describe('setStartConfig', () => {
  const rack = { kind: 'rack' as const, id: rackId(0) };
  const withCtl = (gen: number): GameState => buildState({ seed: 1, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 4,
    rack: (r) => ({ ...r, powerCtl: defaultStartCtl(gen) }) });
  const set = (s: GameState, over: Partial<Extract<GameAction, { type: 'setStartConfig' }>> = {}) =>
    applyAction(s, { type: 'setStartConfig', unit: rack, startWith: 2, headWaitS: 3, busyPct: null, order: 'fastest', ...over });

  it('saves the configuration on the rack Power control at no cost', () => {
    const s = withCtl(0), out = set(s);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.build.racks[0]!.powerCtl).toEqual({ gen: 0, level: 1, startWith: 2, trigger: { headWaitS: 3, busyPct: null }, order: 'fastest' });
    expect(out.state.wallet).toEqual(s.wallet);
  });

  it('rejects a rack without Power control, out-of-range values, gen-0 busy triggers and foreign orders', () => {
    const none = buildState({ seed: 1, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 4 });
    expect(set(none).ok).toBe(false);
    const s = withCtl(0);
    expect(set(s, { startWith: 0 }).ok).toBe(false);
    expect(set(s, { startWith: 5 }).ok).toBe(false);
    expect(set(s, { headWaitS: 10 }).ok).toBe(false);
    expect(set(s, { busyPct: 75 }).ok).toBe(false);
    expect(set(s, { order: 'coolest' }).ok).toBe(false);
    expect(set(withCtl(1), { busyPct: 75 }).ok).toBe(true);
    expect(set(withCtl(1), { busyPct: 40 }).ok).toBe(false);
  });
});

/** D31 save fields: StartCtl at rack, room and global, and site generation, round-trip a save. */
describe('D31 save fields', () => {
  it('round-trips start controllers and generation', () => {
    const base = buildState({ seed: 1, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 2,
      rack: (r) => ({ ...r, powerCtl: { ...defaultStartCtl(1, 3), startWith: 2, order: 'fastest' } }),
      room: (r) => ({ ...r, start: defaultStartCtl(0) }),
      site: (s) => ({ ...s, generation: { gen: 2, level: 4 } }) });
    const state: GameState = { ...base, build: { ...base.build, global: { ...base.build.global, start: { ...defaultStartCtl(1), order: 'cheapest' } } } };
    const loaded = deserializeSave(serializeSave(state));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.state.build.racks[0]!.powerCtl).toEqual(state.build.racks[0]!.powerCtl);
    expect(loaded.state.build.rooms[0]!.start).toEqual(state.build.rooms[0]!.start);
    expect(loaded.state.build.sites[0]!.generation).toEqual({ gen: 2, level: 4 });
    expect(loaded.state.build.global.start).toEqual(state.build.global.start);
  });
});
