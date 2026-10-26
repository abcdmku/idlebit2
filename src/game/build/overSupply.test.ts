import { applyAction } from '../core/actions';
import { createInitialState } from '../core/state';
import { compileAll } from '../core/topology';
import { POWER_SCALE } from '../core/constants';
import { buildState } from '../testkit/builders';
import { deriveUnlocks, openContainers } from './research/effects';
import { researchDef } from './research/tree';
import { capacity, PARTS } from './catalog';
import { quote } from './quotes';
import { researchId, systemId, type ResearchId } from '../types/ids';
import type { SystemSpec } from '../types/build';
import type { GameState } from '../types/state';

/**
 * Supply warning (user, 26 Oct): an upgrade or add whose full-load draw would exceed the system's power
 * supply, its rack PDU or its room UPS carries `overSupply` in view watts. The buy is never blocked.
 */
const sys = systemId(0);
const RICH = ('1' + '0'.repeat(100)) as never;

function researched(...ids: string[]): GameState {
  const base = createInitialState(42), done = new Set<ResearchId>();
  const add = (id: ResearchId) => { for (const r of researchDef(id)?.requires ?? []) add(r); done.add(id); };
  ids.forEach((id) => add(researchId(id)));
  const unlocks = deriveUnlocks([...done]), build = openContainers(base.build, unlocks);
  const research = { ...base.research, completed: [...done], unlocks };
  return { ...base, research, build, compiled: compileAll(build, research), wallet: { ...base.wallet, credits: RICH, data: RICH } };
}

describe('supply warning on quotes', () => {
  it('flags the GHz package over the starting power supply, does not block it, and clears once the supply is sized', () => {
    let s = researched('fabGhz');
    const cpu = (q: ReturnType<typeof quote>) => q.quotes.find((x) => x.action.type === 'replaceCpu')!;
    // A small Hz chip fits its supply: no warning on its clock step.
    const clock = quote(s, { kind: 'part', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'clock', socket: 0 } } }).quotes[0]!;
    expect(clock.overSupply).toBeUndefined();
    for (let i = 1; i < 32; i += 1) s = applyAction(s, { type: 'addPart', system: sys, kind: 'core', generation: 0 }).state;
    const replace = cpu(quote(s, { kind: 'tray', at: { level: 'system', id: sys } }));
    const psuCap = capacity(PARTS.psu, 0, 1);
    expect(replace.overSupply).toMatchObject({ part: 'psu', capW: psuCap * POWER_SCALE });
    expect(replace.overSupply!.afterW).toBeGreaterThan(replace.overSupply!.capW);
    expect(replace.locked).toBeNull();
    expect(applyAction(s, replace.action).ok).toBe(true);
    // The supply fix: a power supply that carries the full load (here Titanium, high level) clears the psu warning.
    expect(capacity(PARTS.psu, 5, 16) * POWER_SCALE).toBeGreaterThan(replace.overSupply!.afterW);
    const sized: SystemSpec = { ...s.build.systems[0]!.spec, psu: { gen: 5, level: 16, capped: false } };
    const fixed = { ...s, build: { ...s.build, systems: [{ ...s.build.systems[0]!, spec: sized }] } };
    const atTop = cpu(quote({ ...fixed, compiled: compileAll(fixed.build, fixed.research) }, { kind: 'tray', at: { level: 'system', id: sys } }));
    expect(atTop.overSupply?.part).not.toBe('psu');
  });

  it('flags the rack PDU when the servers fit their supplies but the rack does not', () => {
    const s = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 4, unlocks: 'max', credits: RICH,
      system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: { kind: 'server', board: 'general',
        cpu: { cpu: { gen: 1, level: 1 }, cores: Array.from({ length: 8 }, () => ({ gen: 1, level: 1 })), clock: { gen: 1, level: 10 }, l1: { gen: 1, level: 4 }, l2: null, l3: null },
        cpuCount: 1, scheduler: null, ram: [], drives: [], accels: [], psu: { gen: 5, level: 16, capped: false },
        settings: { dvfs: false, turbo: false, cStateLimit: 0 } } }),
      rack: (r) => ({ ...r, pdu: { gen: 0, level: 1, capped: false } }) });
    const q = quote(s, { kind: 'part', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'clock', socket: 0 } } }).quotes[0]!;
    expect(q.overSupply).toMatchObject({ part: 'pdu', capW: capacity(PARTS.pdu, 0, 1) * POWER_SCALE });
    expect(q.overSupply!.afterW).toBeGreaterThan(q.overSupply!.capW);
    // With a PDU that carries it, the warning moves out to the room UPS or clears; never the PDU.
    const big = { ...s, build: { ...s.build, racks: s.build.racks.map((r) => r && { ...r, pdu: { gen: 2, level: 20, capped: false } }) } };
    const ok = quote({ ...big, compiled: compileAll(big.build, big.research) }, { kind: 'part', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'clock', socket: 0 } } }).quotes[0]!;
    expect(ok.overSupply?.part).not.toBe('pdu');
  });

  it('flags the room UPS when racks fit their PDUs but the room does not', () => {
    // MHz servers at full load (about 6.5e10 W each) fit Titanium supplies and big PDUs, not a level-1 standby UPS (5e10 W).
    const s = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 3, serversPerRack: 2, unlocks: 'max', credits: RICH,
      system: (id, rack, slot) => ({ id, rack, slot, online: true, spec: { kind: 'server', board: 'general',
        cpu: { cpu: { gen: 2, level: 1 }, cores: Array.from({ length: 32 }, () => ({ gen: 2, level: 1 })), clock: { gen: 2, level: 10 }, l1: { gen: 2, level: 4 }, l2: null, l3: null },
        cpuCount: 1, scheduler: null, ram: [], drives: [], accels: [], psu: { gen: 5, level: 16, capped: false },
        settings: { dvfs: false, turbo: false, cStateLimit: 0 } } }),
      rack: (r) => ({ ...r, pdu: { gen: 2, level: 20, capped: false } }),
      room: (z) => ({ ...z, ups: [{ gen: 0, level: 1, capped: false }] }) });
    const q = quote(s, { kind: 'part', part: { unit: { kind: 'system', id: sys }, slot: { kind: 'clock', socket: 0 } } }).quotes[0]!;
    expect(q.overSupply).toMatchObject({ part: 'ups', capW: capacity(PARTS.ups, 0, 1) * POWER_SCALE });
    expect(q.overSupply!.afterW).toBeGreaterThan(q.overSupply!.capW);
  });
});
