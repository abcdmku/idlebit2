import { amount } from '../amount';
import { applyAction } from '../core/actions';
import { compileAll } from '../core/topology';
import { buildState } from '../testkit/builders';
import { FLEETS } from '../testkit/fleets';
import type { SystemSpec } from '../types/build';
import type { AccelBuild } from '../types/gpu';
import { rackId, systemId } from '../types/ids';
import type { GameState } from '../types/state';
import { fixtureState } from '../view/fixtures';
import { installedGpuStats } from './gpu';
import { PIPE_LOCK_TEXT } from './ports';
import { quote } from './quotes';
import { deriveUnlocks } from './research/effects';
import { RESEARCH } from './research/tree';

const id = systemId(0);
const card = (model: '1330' | '9990', upgrades = 0): AccelBuild => ({ kind: 'gpu', model, upgrades });
/** One server, all research but GPU linking, rich, with the given cards on a general board. */
function gpuState(accels: readonly AccelBuild[]): GameState {
  const base = buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1 });
  const completed = RESEARCH.filter((r) => r.id !== 'gpuLink').map((r) => r.id);
  const research = { ...base.research, completed, unlocks: deriveUnlocks(completed) };
  const build = { ...base.build, systems: base.build.systems.map((s) => s && ({ ...s, spec: { ...s.spec, board: 'general' as SystemSpec['board'], accels } })) };
  return { ...base, build, compiled: compileAll(build, research), research, wallet: { ...base.wallet, credits: amount('1' + '0'.repeat(40)) } };
}
const trayGpu = (s: GameState) => quote(s, { kind: 'tray', at: { level: 'system', id } }).quotes[2]!;

describe('tray GPU item (R44)', () => {
  it('never offers a slower card in place of a faster one on a full board', () => {
    const q = trayGpu(fixtureState('systemTop'));
    expect(q.action.type).toBe('upgradePart');
    expect(q.locked?.text).toBe('Max');
    const s = gpuState([card('9990', 5), card('9990', 5)]);
    expect(trayGpu(s).action).toEqual({ type: 'upgradePart', part: { unit: { kind: 'system', id }, slot: { kind: 'gpu', index: 0 } } });
  });

  it('upgrades the cheapest card first, and shows its rate rising', () => {
    const q = trayGpu(gpuState([card('9990', 2), card('1330', 0)]));
    expect(q.action).toEqual({ type: 'upgradePart', part: { unit: { kind: 'system', id }, slot: { kind: 'gpu', index: 1 } } });
    expect(q.effect!.unit).toBe('ops/s');
    expect(q.effect!.capacityAfter).toBeGreaterThan(q.effect!.capacityBefore);
  });

  it('replaces the weakest maxed card only with a faster entry card', () => {
    const s = gpuState([card('9990', 5), card('1330', 5)]);
    const q = trayGpu(s);
    expect(q.action).toEqual({ type: 'installGpu', system: id, model: '9330', index: 1 });
    expect(q.effect!.capacityBefore).toBe(installedGpuStats({ kind: 'gpu', model: '1330', upgrades: 5 }, s.research.unlocks).opsPerS);
    expect(q.effect!.capacityAfter).toBeGreaterThan(q.effect!.capacityBefore);
  });
});

describe('tray effects (R42)', () => {
  it('quotes every installed core with current affordability and mirrored CPU pricing', () => {
    const base = gpuState([]), system = base.build.systems[id]!;
    const make = (cpuCount: number): GameState => {
      const build = { ...base.build, systems: base.build.systems.map(s => s && ({ ...s,
        spec: { ...s.spec, cpuCount, cpu: { ...system.spec.cpu!, cores: [{ gen: 0, level: 1 }, { gen: 0, level: 2 }] } },
      })) };
      return { ...base, build, compiled: compileAll(build, base.research) };
    };
    const single = make(1), mirrored = make(2), at = { level: 'chip', id } as const;
    const tray = quote(mirrored, { kind: 'tray', at }).quotes;
    expect(tray).toHaveLength(6);
    const upgrades = tray.slice(4);
    for (const [index, q] of upgrades.entries()) {
      const part = { unit: { kind: 'system', id }, slot: { kind: 'core', socket: 0, index } } as const;
      expect(q.action).toEqual({ type: 'upgradePart', part });
      expect(q.locked).toBeNull();
      expect(q.affordable).toBe(true);
      expect(q.cost).toBe(quote(mirrored, { kind: 'part', part }).quotes[0]!.cost);
      expect(BigInt(q.cost)).toBe(2n * BigInt(quote(single, { kind: 'part', part }).quotes[0]!.cost));
    }
    const q = upgrades[0]!, short = { ...mirrored, wallet: { ...mirrored.wallet, credits: amount((BigInt(q.cost) - 1n).toString()) } };
    expect(quote(short, { kind: 'tray', at }).quotes[4]!.affordable).toBe(false);
    const funded = { ...mirrored, wallet: { ...mirrored.wallet, credits: q.cost } };
    expect(quote(funded, { kind: 'tray', at }).quotes[4]!.affordable).toBe(true);
    const bought = applyAction(funded, q.action);
    expect(bought.ok).toBe(true);
    expect(bought.state.wallet.credits).toBe('0');
    expect(bought.state.build.systems[id]!.spec.cpuCount).toBe(2);
    expect(bought.state.build.systems[id]!.spec.cpu!.cores.map(c => c.level)).toEqual([2, 2]);
  });

  it('shows counts on adds and capacity on upgrades at boot', () => {
    const boot = FLEETS.boot();
    const chip = quote(boot, { kind: 'tray', at: { level: 'chip', id } }).quotes;
    expect(chip[0]!.effect).toMatchObject({ capacityBefore: 1, capacityAfter: 2, unit: 'slots' });
    expect(chip[2]!.action.type).toBe('upgradePart');
    expect(chip[2]!.effect).toMatchObject({ capacityBefore: 1, capacityAfter: 1.5, unit: 'Hz' });
    const system = quote(boot, { kind: 'tray', at: { level: 'system', id } }).quotes;
    expect(system[0]!.effect).toMatchObject({ capacityBefore: 1, capacityAfter: 2, unit: 'slots' });
    expect(system[1]!.effect).toMatchObject({ capacityBefore: 0, capacityAfter: 1, unit: 'slots' });
  });

  it('answers a repeated ask from the cache with the same prices', () => {
    const s = FLEETS.rackFull();
    const at = { level: 'rack', id: rackId(0) } as const;
    const a = quote(s, { kind: 'tray', at }).quotes, b = quote(s, { kind: 'tray', at }).quotes;
    expect(b.map((q) => q.cost)).toEqual(a.map((q) => q.cost));
    expect(a[3]!.effect).toMatchObject({ capacityBefore: 1e10, capacityAfter: 2e10, unit: 'Hz' });
  });
});

describe('inbound link quote (R43)', () => {
  it('locks the pipe before Rack with where it upgrades', () => {
    const [q] = quote(FLEETS.boot(), { kind: 'inbound', at: { level: 'chip', id } }).quotes;
    expect(q!.action).toEqual({ type: 'upgradePort', sw: { kind: 'rack', id: 0 }, port: 0 });
    expect(q!.label).toBe('Pipe · 100 kHz');
    expect(q!.locked).toMatchObject({ code: 'research', text: PIPE_LOCK_TEXT });
    expect(q!.effect).toMatchObject({ capacityBefore: 100_000, capacityAfter: 200_000, unit: 'Hz' });
  });

  it('steps all ports on a same-speed rack switch, and locks the rack uplink until a Room', () => {
    const s = FLEETS.rackFull();
    const [pipe] = quote(s, { kind: 'inbound', at: { level: 'system', id } }).quotes;
    expect(pipe!.action).toMatchObject({ type: 'upgradePort', port: 'all' });
    expect(pipe!.locked).toBeNull();
    const [up] = quote(s, { kind: 'inbound', at: { level: 'rack', id: rackId(0) } }).quotes;
    expect(up!.action).toMatchObject({ type: 'upgradeUplink', uplink: 0 });
    expect(up!.locked?.text).toBe('Upgrade at the Room network rack');
    expect(up!.effect!.capacityAfter).toBeGreaterThan(up!.effect!.capacityBefore);
  });

  it('has no backbone quote with one site', () => {
    expect(quote(FLEETS.rackFull(), { kind: 'inbound', at: { level: 'global', id: 0 } }).quotes).toEqual([]);
  });
});
