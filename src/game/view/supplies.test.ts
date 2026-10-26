import { POWER_SCALE } from '../core/constants';
import { MAX_UPS } from '../core/constants';
import { buildState } from '../testkit/builders';
import { rackId, roomId, systemId } from '../types/ids';
import { chipSnapshot } from './chip';
import { globalSnapshot } from './global';
import { rackSnapshot } from './rack';
import { roomUps } from './room';
import { systemSnapshot } from './system';

describe('baseline supply snapshot integration', () => {
  function stateWithDraw() {
    const state = buildState({ sites: 2, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1 });
    const c = state.compiled, h = state.hot;
    c.site.region[0] = 7;
    c.site.region[1] = 3;
    c.sys.psuCapW[1] = 100; c.sys.psuLoss[1] = 0.1; h.sys.psuUsage[1] = 0.75;
    c.rack.pduCapW[1] = 200; c.rack.pduLoss[1] = 0.2; h.rack.pduUsage[1] = 0.4;
    c.room.upsCapW[MAX_UPS] = 400; c.room.upsLoss[MAX_UPS] = 0.05; h.room.upsUsage[MAX_UPS] = 0.25;
    c.site.gridCapW[1] = 1000; c.site.gridLoss[1] = 0.03; h.site.gridUsage[1] = 0.3;
    return state;
  }

  it('uses the actual system PSU on the chip, including regional energy cost and loss', () => {
    const state = stateWithDraw();
    const chip = chipSnapshot(state, systemId(1), null);
    expect(chip.psu).toEqual(systemSnapshot(state, systemId(1), null).psu);
    expect(chip.psu.deliveredW).toBeCloseTo(75 * POWER_SCALE, 15);
    expect(chip.psu.lossW).toBeCloseTo(7.5 * POWER_SCALE, 15);
    expect(chip.psu.creditsPerMinute).toBeCloseTo(82.5 * 0.009 * 60);
  });

  it('prices PDU, UPS and grid draw in their own site region', () => {
    const state = stateWithDraw();
    const pdu = rackSnapshot(state, rackId(1), null).pdu;
    const ups = roomUps(state, roomId(1))[0]!;
    const grid = globalSnapshot(state).sites.find((site) => site.siteId === 1)!.grid!;
    expect(pdu.creditsPerMinute).toBeCloseTo(96 * 0.009 * 60);
    expect(ups.creditsPerMinute).toBeCloseTo(105 * 0.009 * 60);
    expect(grid.creditsPerMinute).toBeCloseTo(309 * 0.009 * 60);
  });

  it('shows zero delivered power, loss and cost for a failed supply', () => {
    const state = stateWithDraw();
    state.hot.sys.psuRebootTicks[1] = 25;
    expect(chipSnapshot(state, systemId(1), null).psu).toMatchObject({
      deliveredW: 0, lossW: 0, creditsPerMinute: 0, failed: true, rebootMs: 2500,
    });
  });
});
