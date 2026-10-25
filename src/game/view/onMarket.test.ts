import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { buildState } from '../testkit/builders';
import { rackId, roomId, systemId } from '../types/ids';
import type { RackSnapshot, RoomSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import { deriveRenderSnapshot } from './snapshot';

const rack = (s: GameState) => deriveRenderSnapshot(s, { focus: { level: 'rack', id: rackId(0) }, partner: null }).focus as RackSnapshot;
const room = (s: GameState) => deriveRenderSnapshot(s, { focus: { level: 'room', id: roomId(0) }, partner: null }).focus as RoomSnapshot;

it('tells a sled sitting out from one on the market between rounds, while both rest paused', () => {
  let s = buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 2, serversPerRack: 3, unlocks: 'max', round: 'between' });
  const off = applyAction(s, { type: 'setOnline', unit: { kind: 'system', id: systemId(1) }, online: false });
  expect(off.ok).toBe(true);
  s = advanceGame(off.state, 20_000).state;
  const servers = rack(s).servers;
  expect(servers.slice(0, 3).map((v) => [v.state, v.onMarket])).toEqual([['paused', true], ['paused', false], ['paused', true]]);
  expect(Array.from(room(s).racks[0]!.serversOnMarket!)).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(Array.from(room(s).racks[0]!.servers.slice(0, 3))).toEqual(Array.from(room(s).racks[1]!.servers.slice(0, 3)));
});
