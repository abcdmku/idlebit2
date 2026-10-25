import { amountSubtract } from '../amount';
import { applyAction } from '../core/actions';
import { advanceGame } from '../core/advance';
import { ACCEL_DOMAINS, DT_S, MAX_ACCELS } from '../core/constants';
import { barebonesSystem } from '../core/defaults';
import { allocRecord } from '../core/pool';
import { MODE } from '../core/timers';
import { compileAll } from '../core/topology';
import { commitWorld, openWorld } from '../core/world';
import { enqueue } from '../exec/alloc';
import { noteAdmitted } from '../exec/slots';
import { FAMILIES, payoutAt } from '../market/families';
import { deserializeSave, serializeSave } from '../save/serialize';
import { buildState } from '../testkit/builders';
import type { GameAction } from '../types/actions';
import type { AccelBuild, GpuBuild, GpuModelId } from '../types/gpu';
import { rackId, systemId, type PartRef } from '../types/ids';
import type { GameState } from '../types/state';
import { acceleratorView } from '../view/accelerators';
import { rackConfig } from './configModel';
import { deriveUnlocks } from './research/effects';

const gpu = (model: GpuModelId = '1330', upgrades = 2): GpuBuild => ({ kind: 'gpu', model, upgrades });
const unit = { kind: 'system' as const, id: systemId(0) };
const part = (index = 0): PartRef => ({ unit, slot: { kind: 'gpu', index } });
function act(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(JSON.stringify(result.rejection));
  return result.state;
}

function billed(accels: readonly AccelBuild[] = [gpu()], hotSwap = true, servers = 1): GameState {
  const base = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: servers,
    round: 'running', unlocks: 'max', credits: '1000000000000000000000000000000', data: '1000000000000000000000000000000',
    system: (id, rack, slot) => {
      const s = barebonesSystem(id, rack, slot);
      return { ...s, spec: { ...s.spec, board: 'accelerator', accels, psu: { gen: 3, level: 1, capped: false } } };
    }, rack: (r) => ({ ...r, opened: true }),
  });
  const completed = base.research.completed.filter((id) => id !== 'gpuLink' && id !== 'gpuGen9' && (hotSwap || id !== 'hotSwap'));
  const research = { ...base.research, completed, unlocks: deriveUnlocks(completed) };
  const start: GameState = { ...base, research, compiled: compileAll(base.build, research) };
  const w = openWorld(start), family = FAMILIES.find((f) => f.key === 'rayTrace')!, scale = 2000;
  for (let s = 0; s < servers; s += 1) {
    const r = allocRecord(w.hot), rec = w.hot.rec;
    rec.family[r] = family.id; rec.count[r] = 1; rec.units[r] = scale;
    rec.payout[r] = payoutAt(family, scale);
    enqueue(w, s, r); noteAdmitted(w, s, 1);
  }
  const state = advanceGame(commitWorld(start, w, 0), 100).state;
  expect(state.hot.sys.accelTaskS[0]).toBeGreaterThan(0);
  expect(BigInt(state.ledger.energy)).toBeGreaterThan(0n);
  return state;
}

function saved(state: GameState): GameState {
  const result = deserializeSave(serializeSave(state));
  if (!result.ok) throw new Error(result.error);
  expect(result.state).toEqual(state);
  return result.state;
}

function accountsAndContinuation(before: GameState, after: GameState) {
  const spent = amountSubtract(after.ledger.creditsSpent, before.ledger.creditsSpent);
  expect(after.wallet).toEqual({ ...before.wallet, credits: amountSubtract(before.wallet.credits, spent) });
  expect(after.ledger).toEqual({ ...before.ledger, creditsSpent: after.ledger.creditsSpent });
  expect(after.research).toEqual(before.research);
  const whole = advanceGame(after, 307).state;
  const first = saved(advanceGame(saved(after), 1).state);
  const second = saved(advanceGame(first, 99).state);
  expect(advanceGame(second, 207).state).toEqual(whole);
}

function cleared(state: GameState, s = 0) {
  const h = state.hot.sys;
  expect(h.running[s]).toBe(0);
  expect(h.accelTaskS.slice(s * MAX_ACCELS, (s + 1) * MAX_ACCELS).every((v) => v === 0)).toBe(true);
  expect(h.accelResearchS.slice(s * MAX_ACCELS, (s + 1) * MAX_ACCELS).every((v) => v === 0)).toBe(true);
  expect(h.accelUsedVram.slice(s * ACCEL_DOMAINS, (s + 1) * ACCEL_DOMAINS).every((v) => v === 0)).toBe(true);
  expect(h.accelHolders.slice(s * ACCEL_DOMAINS, (s + 1) * ACCEL_DOMAINS).every((v) => v === 0)).toBe(true);
  for (const [slot, card] of state.build.systems[s]!.spec.accels.entries()) {
    expect(acceleratorView(state, s, slot, card)).toMatchObject({ active: false, resourceBusy: 0, vramUsedBits: 0 });
  }
}

describe('accelerator inventory edits after billing', () => {
  for (const hotSwap of [false, true]) {
    for (const [old, model] of [[gpu(), '1530'], [gpu(), '1330'], [gpu('1390', 0), '1390']] as const) {
      it(`clears billed duty for ${old.model} u${old.upgrades} -> native ${model}, hot-swap ${hotSwap}`, () => {
        const before = billed([old], hotSwap);
        expect(before.hot.sys.accelTaskS[0]).toBe(DT_S);
        const after = act(before, { type: 'installGpu', system: systemId(0), index: 0, model });
        expect(after.build.systems[0]!.spec.accels[0]).toEqual(gpu(model, 0));
        expect(after.hot.sys.mode[0]).toBe(hotSwap ? MODE.onMarket : MODE.cold);
        cleared(after);
        expect(before.hot.sys.accelTaskS[0]).toBe(DT_S);
        accountsAndContinuation(before, after);
      });
    }

    for (const scope of ['system', 'rack'] as const) {
      it(`clears a same-kind ${scope} configuration replacement only on edited systems, hot-swap ${hotSwap}`, () => {
        const before = billed([gpu()], hotSwap, 2);
        const spec = { ...before.build.systems[0]!.spec, accels: [gpu('1530', 0)] };
        const config = rackConfig(before.build, rackId(0))!;
        const ready: GameState = { ...before, configs: { ...before.configs,
          system: [{ name: 'target', config: { online: true, spec } }],
          rack: [{ name: 'target', config: { ...config, servers: config.servers.map((s, i) => i === 0 ? { ...s!, spec } : s) } }],
        } };
        const after = act(ready, { type: 'applyConfig', unit: scope === 'system' ? unit : { kind: 'rack', id: rackId(0) }, name: 'target' });
        cleared(after);
        expect(after.hot.sys.accelTaskS[MAX_ACCELS]).toBe(before.hot.sys.accelTaskS[MAX_ACCELS]);
        expect(after.hot.sys.running[1]).toBe(before.hot.sys.running[1]);
        accountsAndContinuation(ready, after);
      });
    }

  }

  for (const kind of ['gpu', 'npu'] as const) {
    it(`clears billed duty and old assignments when adding a ${kind} with hot-swap`, () => {
      const before = billed();
      const after = act(before, kind === 'gpu'
        ? { type: 'installGpu', system: systemId(0), index: null, model: '1530' }
        : { type: 'addPart', system: systemId(0), kind, generation: 0 });
      expect(after.build.systems[0]!.spec.accels).toHaveLength(2);
      cleared(after);
      accountsAndContinuation(before, after);
    });
  }

});

describe('hot accelerator upgrades retain card history', () => {
  for (const mode of ['part', 'all', 'config'] as const) {
    it(`keeps billed duty and running work for a hot GPU upgrade via ${mode}`, () => {
      const before = billed();
      const ready: GameState = { ...before, configs: { ...before.configs, system: [{ name: 'push',
        config: { online: true, spec: { ...before.build.systems[0]!.spec, accels: [gpu('1330', 3)] } },
      }] } };
      const after = act(ready, mode === 'part' ? { type: 'upgradePart', part: part() }
        : mode === 'all' ? { type: 'upgradeAll', system: systemId(0), kind: 'gpu', gen: 0 }
          : { type: 'applyConfig', unit, name: 'push' });
      expect(after.hot.sys.accelTaskS).toEqual(before.hot.sys.accelTaskS);
      expect(after.hot.sys.accelUsedVram).toEqual(before.hot.sys.accelUsedVram);
      expect(after.hot.sys.running).toEqual(before.hot.sys.running);
      expect(acceleratorView(after, 0, 0, after.build.systems[0]!.spec.accels[0]!)).toMatchObject({ active: true, resourceBusy: 1 });
      accountsAndContinuation(ready, after);
    });
  }

});
