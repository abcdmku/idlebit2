import { describe, expect, it, vi } from 'vitest';
import { deriveUnlocks } from '../build/research/effects';
import { researchDef } from '../build/research/tree';
import { commitBuild } from '../build/commit';
import { advanceGame } from '../core/advance';
import { applyAction } from '../core/actions';
import { LOC } from '../core/buffers';
import { barebonesSystem } from '../core/defaults';
import { compileAll } from '../core/topology';
import { commitWorld, openWorld } from '../core/world';
import { deserializeSave, serializeSave } from '../save/serialize';
import { endRound } from '../market/rounds';
import { buildState } from '../testkit/builders';
import { systemId } from '../types/ids';
import type { GameState } from '../types/state';
import { killSubtree } from './kill';
import { F } from './testFamilies';
import { feed, step } from './testWorld';

vi.mock('../market/families', async (orig) => ({ ...(await orig<object>()), FAMILIES: (await import('./testFamilies')).TEST_FAMILIES }));

/** Catalog hardware, compiled normally, with live CPU/GPU/tensor work before GPU-link unlock. */
function seeded(linkResearch = false): GameState {
  const base = buildState({ sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, round: 'running',
    unlocks: 'max', credits: '1000000000000', data: '1000000000000', system: (id, rack, slot) => {
      const s = barebonesSystem(id, rack, slot);
      return { ...s, spec: { ...s.spec, board: 'accelerator', cpu: { ...s.spec.cpu!, cores: Array.from({ length: 8 }, () => ({ gen: 0, level: 1 })) }, // 8 threads: one per core (D39, no SMT)
        ram: [{ gen: 0, level: 1, ecc: true }], drives: [{ gen: 0, level: 1 }], scheduler: { gen: 1, level: 3, strategy: 'fifo' },
        psu: { gen: 3, level: 1, capped: false }, accels: [
          { kind: 'gpu', model: '1330', upgrades: 0 }, { kind: 'gpu', model: '1550', upgrades: 0 }, { kind: 'npu', gen: 0, level: 1 },
        ] } };
    } });
  const completed = base.research.completed.filter((id) => id !== 'gpuLink');
  const research = { ...base.research, completed, unlocks: deriveUnlocks(completed) };
  const initial = { ...base, research, compiled: compileAll(base.build, research) };
  // Million-op GPU tasks would spend 1,000 s on the 1 kHz pipe; land them at once so the cards stay busy.
  initial.compiled.sys.pipeSpeed.fill(Infinity);
  const w = openWorld(initial);
  feed(w, F.gpu60, 1, 1_000_000); feed(w, F.tensor, 1, 1_000_000); feed(w, F.cpuGpu, 1, 1);
  feed(w, F.cpu, 3, 1); feed(w, F.io, 1, 1);
  step(w);
  if (linkResearch) {
    w.research.active = researchDef('gpuLink')!.id;
    w.research.activeProgress = researchDef('gpuLink')!.work - 1;
  }
  return commitWorld(initial, w, 0);
}

function saved(state: GameState): GameState {
  const loaded = deserializeSave(serializeSave(state));
  if (!loaded.ok) throw new Error(loaded.error);
  expect(loaded.state).toEqual(state);
  return loaded.state;
}

describe('GPU delta invariance and save continuation', () => {
  for (const linkResearch of [false, true]) {
    it(`preserves the full state over uneven calls and saves, link research ${linkResearch}`, () => {
      const start = seeded(linkResearch), total = 3007;
      const whole = advanceGame(start, total).state;
      let noSave = start;
      let split = start;
      const parts = [1, 99, 37, 263, 5, 701, 2, 99, 500, 1300];
      expect(parts.reduce((a, b) => a + b)).toBe(total);
      for (const ms of parts) noSave = advanceGame(noSave, ms).state;
      expect(noSave).toEqual(whole);
      for (const ms of parts) split = saved(advanceGame(split, ms).state);
      // Includes typed clocks/holds/duty, RNG words/counts, events, exact currencies and meters.
      expect(split).toEqual(whole);
      expect(whole.wallet.energyMeter).toBeGreaterThan(0);
      expect(whole.ledger.energy).not.toBe('0');
      expect(whole.compiled.sys.gpuLinked[0]).toBe(linkResearch ? 1 : 0);
      expect(whole.hot.rec.loc.some((loc) => loc === LOC.running)).toBe(true);
    });
  }

  it('continues identically after a saved GPU failure and slot reuse', () => {
    const start = seeded();
    const kill = (state: GameState) => {
      const w = openWorld(state);
      killSubtree(w, { kind: 'system', id: systemId(0) }, 'power');
      feed(w, F.gpu60, 1, 1000);
      return commitWorld(state, w, state.clock.carryMs);
    };
    const left = advanceGame(kill(advanceGame(start, 301).state), 1006).state;
    const right = advanceGame(saved(kill(saved(advanceGame(saved(start), 301).state))), 1006).state;
    expect(right).toEqual(left);
  });

  it('cold removal while paused cleans old holds and removed-card duty before saving', () => {
    const initial = seeded();
    expect(initial.hot.sys.accelUsedVram.some((bits) => bits > 0)).toBe(true);
    const w = openWorld(initial);
    endRound(w);
    w.tick += 1;
    const dismissed = applyAction(commitWorld(initial, w, 0), { type: 'dismissReport' });
    expect(dismissed.ok).toBe(true);
    const paused = dismissed.state;
    expect(paused.round.phase).toBe('between');
    expect(paused.hot.sys.accelTaskS.some((seconds) => seconds > 0)).toBe(true);
    const system = paused.build.systems[0]!;
    const build = { ...paused.build, systems: [{ ...system, spec: { ...system.spec, accels: [] } }] };
    const changed = commitBuild(paused, { build, price: 0n, cold: [{ kind: 'system', id: systemId(0) }] });
    expect(changed.ok).toBe(true);
    const state = saved(changed.state);
    expect(state.hot.sys.accelUsedVram.every((bits) => bits === 0)).toBe(true);
    expect(state.hot.sys.accelHead.every((head) => head === -1)).toBe(true);
    expect(state.hot.sys.accelTaskS.every((seconds) => seconds === 0)).toBe(true);
  });

  for (const hotSwap of [false, true]) {
    it(`removes a billed busy GPU and shifts surviving slots safely, hot-swap ${hotSwap}`, () => {
      const billed = advanceGame(seeded(), 100).state;
      expect(billed.hot.sys.accelTaskS.some((seconds) => seconds > 0)).toBe(true);
      expect(BigInt(billed.ledger.energy)).toBeGreaterThan(0n);
      const rack = billed.build.racks[0]!;
      const build = { ...billed.build, racks: [{ ...rack, opened: hotSwap }] };
      const before = { ...billed, build, compiled: compileAll(build, billed.research) };
      const result = applyAction(before, { type: 'removePart', part: { unit: { kind: 'system', id: systemId(0) }, slot: { kind: 'gpu', index: 0 } } });
      expect(result.ok).toBe(true);
      const after = saved(result.state);
      expect(after.wallet).toEqual(before.wallet);
      expect(after.ledger).toEqual(before.ledger);
      expect(after.research).toEqual(before.research);
      expect(after.compiled.sys.accelKind.slice(0, 3)).toEqual(new Uint8Array([1, 2, 0]));
      expect(after.hot.sys.accelTaskS.every((seconds) => seconds === 0)).toBe(true);
      expect(after.hot.sys.accelResearchS.every((seconds) => seconds === 0)).toBe(true);
      expect(after.hot.sys.accelUsedVram.every((bits) => bits === 0)).toBe(true);
      expect(after.hot.sys.accelHead.every((head) => head === -1)).toBe(true);
      const resumed = advanceGame(after, 1207).state;
      expect(advanceGame(saved(after), 1207).state).toEqual(resumed);
    });
  }
});
