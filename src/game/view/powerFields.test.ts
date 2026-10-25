import { advanceGame } from '../core/advance';
import { buildState } from '../testkit/builders';
import { rackId } from '../types/ids';
import type { RackSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import { fixtureState } from './fixtures';
import { deriveRenderSnapshot } from './snapshot';

const rack = (s: GameState) => deriveRenderSnapshot(s, { focus: { level: 'rack', id: rackId(0) }, partner: null }).focus as RackSnapshot;

describe('D31 rack power fields', () => {
  it('powerRack: a running round on a charged battery with minutes left, 2 of 8 started', () => {
    const s = fixtureState('powerRack');
    const ctl = rack(s).powerCtl!;
    expect(s.round.phase).toBe('running');
    expect(BigInt(s.wallet.credits) > 0n).toBe(true);
    expect(ctl.battery.discharging).toBe(true);
    expect(ctl.battery.secondsLeft).toBeGreaterThan(60);
    expect(ctl.battery.secondsLeft).toBeLessThan(3600);
    expect(ctl.start).toMatchObject({ startWith: 2, total: 8 });
    expect(ctl.start.awake).toBeLessThan(8);
  });

  it('shows a waking system\'s countdown, and null once it is up', () => {
    let s = fixtureState('powerRack'), waking: RackSnapshot['servers'][number] | undefined;
    for (let t = 0; t < 600 && !waking; t += 1) {
      s = advanceGame(s, 100).state;
      waking = rack(s).servers.find((v) => v.wakeMs !== null && v.wakeMs !== undefined);
    }
    expect(waking).toBeDefined();
    expect(waking!.state).toBe('asleep');
    expect(waking!.wakeMs).toBe(s.hot.sys.wakeTicks[waking!.systemId!]! * 100);
    expect(rack(s).servers.filter((v) => v.state === 'onMarket').every((v) => v.wakeMs === null)).toBe(true);
  });

  it('locks the Power control slot until its research is done', () => {
    const base = buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 2 });
    const max = buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 2, unlocks: 'max' });
    expect([rack(base).powerCtlLocked, rack(max).powerCtlLocked]).toEqual([true, false]);
  });
});
