import { applyAction } from '../core/actions';
import { barebonesSpec } from '../core/defaults';
import { buildState } from '../testkit/builders';
import type { GameState } from '../types/state';
import { systemId, type PartRef } from '../types/ids';
import type { ChipSnapshot, SystemSnapshot } from '../types/snapshot';
import { deriveRenderSnapshot } from '../view/snapshot';
import { quote } from './quotes';

const id = systemId(0);
const system = (s: GameState) => deriveRenderSnapshot(s, { focus: { level: 'system', id }, partner: null }).focus as SystemSnapshot;
const chip = (s: GameState): ChipSnapshot => system(s).chip;

/** The number the board prints on each part. */
const BOARD: readonly [string, PartRef['slot'], (s: GameState) => number][] = [
  ['clock', { kind: 'clock', socket: 0 }, (s) => chip(s).clock.hz],
  ['core', { kind: 'core', socket: 0, index: 0 }, (s) => chip(s).cores[0]!.rate],
  ['L1', { kind: 'l1', socket: 0 }, (s) => chip(s).cache.levels.find((l) => l.kind === 'l1')!.bits],
  ['L2', { kind: 'l2', socket: 0 }, (s) => chip(s).cache.levels.find((l) => l.kind === 'l2')!.bits],
  ['RAM stick', { kind: 'ram', index: 0 }, (s) => system(s).ram[0]!.capacityBits!],
  ['drive', { kind: 'drive', index: 0 }, (s) => system(s).storage[0]!.capacityBits!],
];

describe('part quote effects', () => {
  // Four multi-lane cores, two RAM sticks: system totals are far from any one part's value.
  const spec = barebonesSpec(1), cpu = spec.cpu!;
  const state = buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max', credits: '1000000000000',
    system: (sid, rack, slot) => ({ id: sid, rack, slot, online: true, spec: {
      ...spec, cpu: { ...cpu, cores: Array(4).fill({ gen: 1, level: 8 }), l2: { gen: 1, level: 2 } },
      ram: [{ gen: 1, level: 2, ecc: false }, { gen: 1, level: 2, ecc: false }], drives: [{ gen: 1, level: 2 }],
    } }),
  });

  it.each(BOARD)('an upgrade of the %s shows the number the board prints on it, before and after', (_, slot, board) => {
    const up = quote(state, { kind: 'part', part: { unit: { kind: 'system', id }, slot } }).quotes.find((q) => q.action.type === 'upgradePart')!;
    const next = applyAction(state, up.action).state;
    expect(board(next)).toBeGreaterThan(board(state));
    expect([up.effect?.capacityBefore, up.effect?.capacityAfter]).toEqual([board(state), board(next)]);
  });

  it('labels clock quotes in Hz', () => {
    const up = quote(state, { kind: 'part', part: { unit: { kind: 'system', id }, slot: { kind: 'clock', socket: 0 } } }).quotes[0]!;
    expect(up.effect?.unit).toBe('Hz');
    expect(state.compiled.sys.threadRate[0]! * state.compiled.sys.cores[0]!).toBeGreaterThan(chip(state).clock.hz);
  });
});
