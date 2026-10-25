import { amount } from '../amount';
import { createInitialState, initialHot } from '../core/state';
import { compileAll } from '../core/topology';
import type { SystemSpec } from '../types/build';
import { systemId } from '../types/ids';
import type { GameState } from '../types/state';
import { quote } from './quotes';
import { deriveUnlocks } from './research/effects';
import { researchId } from '../types/ids';
import { gpuPowerPreview } from './gpuPower';
import { fullLoadWatts } from './configModel';
import { supplyLossW } from '../phys/supplies';

const id = systemId(0);
function fixture(psuGen = 0): GameState {
  const base = createInitialState(42);
  const completed = ['systemBoard', 'memController', 'gpuGen1', ...(psuGen ? ['psu80'] : [])].map(researchId);
  const research = { ...base.research, completed, unlocks: deriveUnlocks(completed) };
  const build = { ...base.build, systems: base.build.systems.map((s) => s && ({ ...s,
    spec: { ...s.spec, psu: { gen: psuGen, level: 1, capped: false } } })) };
  const compiled = compileAll(build, research);
  return { ...base, build, compiled, research, hot: initialHot({ compiled, seed: 42, round: base.round }),
    wallet: { ...base.wallet, credits: amount('1000000000000000000') } };
}

function modelQuote(state: GameState, index: number | null = null) {
  return quote(state, { kind: 'gpuModels', system: id, index, generation: 1 }).quotes.find((q) => q.gpu?.after.model === '1530')!;
}

describe('GPU whole-system power quotes', () => {
  it('compares the same card against actual supply capacity and overload losses', () => {
    const small = fixture(), large = fixture(1);
    const weak = modelQuote(small), strong = modelQuote(large);
    expect(weak.gpu).toEqual(strong.gpu);
    expect(weak.gpuPower!.after.deliveredW).toBeCloseTo(19801.4, 10);
    expect(strong.gpuPower!.after.deliveredW).toBeCloseTo(19801.4, 10);
    expect(weak.gpuPower!.after.capacityW).toBe(32768);
    expect(strong.gpuPower!.after.capacityW).toBe(65536);
    expect(weak.gpuPower!.after.inputW).toBeCloseTo(25741.82, 10);
    expect(strong.gpuPower!.after.inputW).toBeCloseTo(23761.68, 10);
    expect(weak.gpuPower!.after.headroomW).toBeCloseTo(12966.6, 10);
    expect(strong.gpuPower!.after.headroomW).toBeCloseTo(45734.6, 10);
    expect(weak.gpuPower!.after.lossW).toBeCloseTo(5940.42, 10);
    expect(strong.gpuPower!.after.lossW).toBeCloseTo(3960.28, 10);
  });

  it('publishes before/after whole-system power for hot upgrades and replacements separately from card duty', () => {
    const base = fixture(1);
    const spec: SystemSpec = { ...base.build.systems[0]!.spec, accels: [{ kind: 'gpu', model: '1330', upgrades: 0 }] };
    const build = { ...base.build, systems: [{ ...base.build.systems[0]!, spec }] };
    const compiled = compileAll(build, base.research);
    const state = { ...base, build, compiled, hot: initialHot({ compiled, seed: 42, round: base.round }) };
    const upgrade = quote(state, { kind: 'part', part: { unit: { kind: 'system', id }, slot: { kind: 'gpu', index: 0 } } }).quotes[0]!;
    const replacement = modelQuote(state, 0);
    expect(upgrade.gpuPower!.before.deliveredW).toBeCloseTo(fullLoadWatts(spec, state.research.unlocks), 10);
    expect(upgrade.gpuPower!.after.deliveredW).toBeGreaterThan(upgrade.gpuPower!.before.deliveredW);
    expect(upgrade.effect!.wattsBefore).toBe(upgrade.gpu!.before!.idleW);
    expect(upgrade.effect!.wattsAfter).toBe(upgrade.gpu!.after.idleW);
    expect(replacement.gpuPower!.before).toEqual(upgrade.gpuPower!.before);
    expect(replacement.gpuPower!.after.deliveredW).toBeCloseTo(19801.4, 10);
    expect(replacement.gpuPower!.after.inputW).toBeCloseTo(23761.68, 10);
  });

  it('includes CPU, RAM, all accelerators and drives without changing their component rules', () => {
    const state = fixture(1);
    const spec: SystemSpec = { ...state.build.systems[0]!.spec,
      ram: [{ gen: 0, level: 2, ecc: false }], drives: [{ gen: 0, level: 3 }],
      accels: [{ kind: 'gpu', model: '1530', upgrades: 0 }, { kind: 'npu', gen: 0, level: 2 }] };
    const p = gpuPowerPreview(state, 0, spec).after;
    const expected = fullLoadWatts(spec, state.research.unlocks);
    expect(p.deliveredW).toBeCloseTo(expected, 10);
    expect(p.lossW).toBe(supplyLossW(p.deliveredW, 65536, 0.2));
    expect(p.inputW).toBeCloseTo(p.deliveredW + p.lossW, 10);
  });

  it('retains current CPU power state, thermal throttle and supply caps at full load', () => {
    const state = fixture(1);
    const spec: SystemSpec = { ...state.build.systems[0]!.spec, accels: [{ kind: 'gpu', model: '1530', upgrades: 0 }] };
    const normal = gpuPowerPreview(state, 0, spec).after;
    state.hot.sys.dvfsOn[0] = 1;
    state.hot.rack.throttled[0] = 1;
    state.hot.sys.capFactor[0] = 0.5;
    state.hot.rack.capFactor[0] = 0.5;
    const adjusted = gpuPowerPreview(state, 0, spec).after;
    // CPU load is 1 W at full use, then DVFS .3, throttle .5, and the two .5 caps.
    expect(normal.deliveredW - adjusted.deliveredW).toBeCloseTo(1 - 0.3 * 0.5 * 0.5 * 0.5, 11);
    expect(adjusted.lossW).toBe(supplyLossW(adjusted.deliveredW, 65536, 0.2));
  });

  it('provides whole-system figures for locked generation choices without mutating state', () => {
    const state = fixture(1);
    const hot = state.hot.sys.accelTaskS.slice(), credits = state.wallet.credits;
    const locked = quote(state, { kind: 'gpuModels', system: id, index: null, generation: 2 }).quotes;
    expect(locked.every((q) => q.locked?.node === 'gpuGen2' && q.gpuPower !== undefined)).toBe(true);
    expect(state.hot.sys.accelTaskS).toEqual(hot);
    expect(state.wallet.credits).toBe(credits);
  });
});
