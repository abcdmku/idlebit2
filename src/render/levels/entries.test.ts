// The inbound pipe ends exactly on each level's connector (user: "the green line should extend to the
// yellow pad"): the level's entry() is where its own connector art starts, at both forms.
import { describe, expect, it } from 'vitest';
import { createLevelRegistry } from '../core';
import { createChipRenderer } from './chip';
import { chipScene } from './chip/scenes';
import { floorOf } from './chip/layout';
import { siteCount } from './chip/world';
import { createSystemRenderer } from './system';
import { systemScene } from './system/scenes';
import { CONNECTOR } from './system/layout';
import { createRackRenderer } from './rack';
import { CASES as RACKS } from './rack/fixtures';
import { UPLINK_ROUTE, UP_X, colX } from './rack/layout';
import { rackCol } from './rack/row';
import { createRoomRenderer } from './room';
import { CASES as ROOMS } from './room/fixtures';
import { ZONE_PATH } from './room/flows';
import { createGlobalRenderer } from './global';
import { CASES as WORLDS } from './global/fixtures';
import { hubRect } from './global/layout';
import { gatewayIndex } from './global/world';

describe('the pipe ends on its connector', () => {
  const reg = createLevelRegistry(), p = { x: 0, y: 0 };
  it.each(['desktop', 'phone'] as const)('System: the gold edge pad; CPU: the IN pad (%s)', form => {
    // the pipe (2 px ink cap past its end point) meets the pad's top edge, centred on it
    expect(createSystemRenderer(reg).entry!(systemScene('system'), p, form)).toEqual({ x: CONNECTOR.x + (CONNECTOR.w >> 1), y: CONNECTOR.y - 2 });
    const chip = chipScene('mid'), f = floorOf(form, siteCount(chip));
    expect(createChipRenderer(reg).entry!(chip, { x: 0, y: 0 }, form)).toEqual(f.inp);
  });
  it('Rack: the ceiling uplink drop; Room: the gateway fibre; World: the scheduler hub top', () => {
    const rack = RACKS.overview!(0);
    expect(createRackRenderer(reg).entry!(rack, { x: 0, y: 0 })).toEqual({ x: colX(rackCol(rack)) + UP_X, y: 0 });
    expect(UPLINK_ROUTE[0]![0]).toBe(UP_X); // the rack's own uplink starts straight under that point
    const room = ROOMS.overview!(0), e = createRoomRenderer(reg).entry!(room, { x: 0, y: 0 });
    expect([e.x, e.y]).toEqual([ZONE_PATH[0]![0], ZONE_PATH[0]![1]]);
    const world = WORLDS.regions!(0), hub = hubRect(gatewayIndex(world), { x: 0, y: 0, w: 0, h: 0 });
    expect(createGlobalRenderer(reg).entry!(world, { x: 0, y: 0 })).toEqual({ x: hub.x + 5, y: hub.y - 1 });
  });
});
