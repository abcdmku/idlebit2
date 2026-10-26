import { describe, expect, it } from 'vitest';
import { applyAction, createInitialState, rackId, systemId, type GameState, type UnitRef } from '../../game';
import { fixtureState } from '../../game/fixtures';
import { blockedOn } from './blocks';
import { marketKey, marketLine, marketOf, targetUnit } from './market';

const set = (s: GameState, unit: UnitRef, online: boolean) => applyAction(s, { type: 'setOnline', unit, online }).state;

describe('On market toggle', () => {
  it('has no toggle before Rack: the lone system stays on', () => {
    expect(marketOf(createInitialState(1), { kind: 'system', id: systemId(0) })).toBeNull();
  });

  it('counts a rack\'s systems on the market and reads a system turned off', () => {
    const s0 = fixtureState('rack'), rack = { kind: 'rack', id: rackId(0) } as const;
    const total = s0.build.systems.filter(x => x && x.rack === 0).length;
    expect(marketOf(s0, rack)).toMatchObject({ on: true, live: total, total });
    const s1 = set(s0, { kind: 'system', id: systemId(1) }, false);
    const sys = marketOf(s1, { kind: 'system', id: systemId(1) })!;
    expect(marketKey(sys)).toBe('Off market');
    expect(marketOf(s1, rack)!.live).toBe(total - 1);
    expect(marketLine(marketOf(s1, rack)!)).toMatch(new RegExp(`^${total - 1} / ${total} on market`));
    // the rack off takes every system with it; a system still switched on says why it is off
    const s2 = set(s1, rack, false);
    expect(marketOf(s2, rack)).toMatchObject({ on: false, live: 0 });
    const on = marketOf(s2, { kind: 'system', id: systemId(0) })!;
    expect(marketKey(on)).toBe('On market');
    expect(marketLine(on)).toBe('Off with its rack');
  });

  it('a sled, a lamp or a door stands for its unit; parts do not', () => {
    expect(targetUnit({ kind: 'child', unit: null, drill: { level: 'system', id: 3 } as never })).toEqual({ kind: 'system', id: 3 });
    expect(targetUnit({ kind: 'unit', unit: { kind: 'rack', id: rackId(1) }, drill: null })).toEqual({ kind: 'rack', id: 1 });
    expect(targetUnit({ kind: 'child', unit: null, drill: { level: 'chip', id: 0 } as never })).toBeNull();
    expect(targetUnit({ kind: 'part', unit: { kind: 'rack', id: rackId(1) }, drill: null })).toBeNull();
  });
});

describe('a part plate names the tasks it unblocks (QA-21)', () => {
  it('counts the line waiting on what the part supplies', () => {
    const line = [{ blockedBy: 'cache' }, { blockedBy: null }, { blockedBy: 'cache' }, { blockedBy: 'ram' }];
    expect([blockedOn(line, 'l1'), blockedOn(line, 'ram'), blockedOn(line, 'clock'), blockedOn(line, undefined)]).toEqual([2, 1, 0, 0]);
  });
});
