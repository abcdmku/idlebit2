import { describe, expect, it } from 'vitest';
import { applyAction } from '../core/actions';
import { buildState } from '../testkit/builders';
import { rackId } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';

/** D35: ports belong to the switch; Match ports (sameSpeed) is on by default and steps the whole switch. */
const sw = { kind: 'rack' as const, id: rackId(0) };
const ports = (s: GameState) => [...s.build.racks[0]!.switch.ports];
const act = (s: GameState, a: GameAction): GameState => { const o = applyAction(s, a); if (!o.ok) throw new Error(JSON.stringify(o.rejection)); return o.state; };
const rack = () => buildState({ seed: 1, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 3, unlocks: 'max', credits: '1000000000000000', rack: (r) => ({ ...r, opened: true }) });

describe('Match ports (D35)', () => {
  it('is on for a new switch: one port step raises every port, and a new port comes at that speed', () => {
    const s = rack();
    expect(s.build.racks[0]!.switch.sameSpeed).toBe(true);
    const before = ports(s);
    const up = act(s, { type: 'upgradePort', sw, port: 1 });
    expect(ports(up)).toEqual(before.map((k) => k + 1));
    const added = act(up, { type: 'addPorts', sw });
    expect(ports(added).at(-1)).toBe(before[0]! + 1);
  });

  it('off: ports step one by one, and the whole-switch step still raises them all together', () => {
    const off = act(rack(), { type: 'setSameSpeed', sw, on: false });
    const before = ports(off);
    const one = act(off, { type: 'upgradePort', sw, port: 1 });
    expect(ports(one)).toEqual(before.map((k, i) => (i === 1 ? k + 1 : k)));
    const all = act(one, { type: 'upgradePort', sw, port: 'all' });
    expect(ports(all).every((k) => k === before[0]! + 1)).toBe(true);
  });
});
