import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { barebonesSpec } from '../core/defaults';
import { buildState } from '../testkit/builders';
import { systemId } from '../types/ids';
import type { ChipSnapshot, SystemSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import { deriveRenderSnapshot } from './snapshot';

const id = systemId(0);
const view = <T>(s: GameState, level: 'chip' | 'system') => deriveRenderSnapshot(s, { focus: { level, id }, partner: null }).focus as T;

it('the CPU view counts down a cold change with the system view, then clears', () => {
  let s = buildState({
    seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max', credits: '1000000000000',
    system: (sid, rack, slot) => ({ id: sid, rack, slot, online: true, spec: barebonesSpec(0) }),
  });
  expect(view<ChipSnapshot>(s, 'chip').timerS).toBeNull();
  const replace = applyAction(s, { type: 'replacePart', part: { unit: { kind: 'system', id }, slot: { kind: 'clock', socket: 0 } }, generation: 1, preserveCapacity: false });
  expect(replace.ok).toBe(true);
  s = advanceGame(replace.state, 300).state;
  const chip = view<ChipSnapshot>(s, 'chip');
  expect(chip.online).toBe('cold');
  expect(chip.timerS).toBeGreaterThan(0);
  expect(chip.timerS).toBe(view<SystemSnapshot>(s, 'system').timerS);
  s = advanceGame(s, 10_000).state;
  expect(view<ChipSnapshot>(s, 'chip').timerS).toBeNull();
});
