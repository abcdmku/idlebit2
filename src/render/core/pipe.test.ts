import { expect, it } from 'vitest';
import { LEVEL_FIXTURES } from '../../game/fixtures';
import { familyId, systemId } from '../../game';
import type { RenderSnapshot, TransferView } from '../../game';
import { fixtureSnapshot } from './fixtureLevels';
import { inbound } from './pipe';

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
