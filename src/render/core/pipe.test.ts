import { expect, it } from 'vitest';
import { LEVEL_FIXTURES } from '../../game/fixtures';
import { familyId, systemId } from '../../game';
import type { RenderSnapshot, TransferView } from '../../game';
import { fixtureSnapshot } from './fixtureLevels';
import { inbound, pipeTagSpot } from './pipe';
import { PHONE_FRAMING } from './camera';
import { PHONE_TYPE } from './labels';

const transfer = (id: number, link: TransferView['link'], system: number): TransferView =>
  ({ taskId: id, family: familyId(0), systemId: systemId(system), link, bitsSent: 0, bits: 1000, speed: 1000,
    shard: 0, shards: 1, units: 1, from: null, to: { level: 'system', id: systemId(system) }, key: id });
it("draws only the active rack's transfers on the rack's pipe: its uplink first, else its servers' ports", () => {
  const rack = LEVEL_FIXTURES.rack, mine = rack.servers.find(s => s.systemId !== null)!.systemId!;
  const at = (transfers: TransferView[]) => {
    const s = fixtureSnapshot(rack); const snap = { ...s, feed: { ...s.feed, transfers } } as RenderSnapshot;
    return inbound(snap, { name: '', speed: 0, transfer: null }).transfer?.taskId ?? null;
  };
  expect(at([transfer(1, 'rack', 999), transfer(2, 'server', mine), transfer(3, 'rack', mine)])).toBe(3);
  expect(at([transfer(1, 'rack', 999), transfer(2, 'server', mine)])).toBe(2);
  expect(at([transfer(1, 'rack', 999), transfer(4, 'pipe', mine)])).toBeNull();
});

it('keeps the pipe tags off the focus art: one line when clear, else a column in the left gutter', () => {
  const vp = { x: 8, y: 8, w: 368, h: 692 }, p = { x: 32, runY: 208 }, out = { x: 0, y: 0, stacked: false, packet: false };
  // clear: art well below the tag
  expect(pipeTagSpot(p, vp, PHONE_FRAMING, { x: 60, y: 300, w: 250, h: 300 }, PHONE_TYPE, 'Uplink', '10 GHz', '', '', out)).toEqual({ x: 48, y: 216, stacked: false, packet: false });
  // the phone rack: the cabinet starts right under the run, so the tag stacks in the gutter left of it
  const art = { x: 75, y: 212, w: 252, h: 438 };
  const spot = pipeTagSpot(p, vp, PHONE_FRAMING, art, PHONE_TYPE, 'Uplink', '10 GHz', '', '', out);
  expect(spot.stacked).toBe(true);
  expect(spot.x).toBe(16);
  // a packet tag too wide for the gutter column drops (the packet still shows on the pipe)
  const moving = pipeTagSpot(p, vp, PHONE_FRAMING, art, PHONE_TYPE, 'Uplink', '10 GHz', '12.5 Mops', '3 s', out);
  expect(moving).toMatchObject({ x: 16, stacked: true, packet: false });
});
