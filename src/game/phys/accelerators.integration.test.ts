import { describe, expect, it, vi } from 'vitest';
import { ACCEL_CLOCKS, ACCEL_DOMAINS, DT_S, MAX_ACCELS, POOL_DOMAIN } from '../core/constants';
import { advanceGame } from '../core/advance';
import { ledgerPhase } from '../core/ledger';
import { MODE } from '../core/timers';
import { commitWorld, type World } from '../core/world';
import { runPhase } from '../exec/run';
import { feed } from '../exec/testWorld';
import type { FamilyDef } from '../types/catalog';
import type { GameState } from '../types/state';
import { powerPhase } from './power';
import { physState, physWorld } from './testWorld';
import { thermalPhase } from './thermal';

vi.mock('../build/compile', () => ({ compileUnits: () => undefined }));
vi.mock('../market/families', async (original) => {
  const actual = await original<typeof import('../market/families')>();
  const { familyId } = await import('../types/ids');
  const families: FamilyDef[] = [false, true].map((tensor, id) => ({
    id: familyId(id), key: `phys-${id}`, name: `phys-${id}`, band: 'bits', note: '',
    window: { from: 0, to: 0 }, weight: 0, stages: [{ resource: 'gpu', work: { fixed: 0, perSize: 1 } }],
    grain: 2 ** 40, threads: 1, workingSet: { fixed: 0, perSize: 0 }, vramBits: { fixed: 50, perSize: 0 },
    windowS: null, payloadBits: { fixed: 0, perSize: 0 },
    members: 1, minZones: 1, region: { kind: 'any' }, tensor, ecc: false,
    gpuCoresMin: tensor ? 0 : 2, affinity: 'accelerator', dataRatio: 10,
  }));
  return { ...actual, FAMILIES: families };
});

function fixtureState(): GameState {
  return physState({}, ({ sys: c }) => {
    c.threads[0] = 2; c.cores[0] = 2; c.K[0] = 2; c.Q[0] = 2; c.keff[0] = 2; c.slots[0] = 4;
    c.threadRate[0] = 10; c.memCap[0] = 100; c.cacheBits[0] = 100; c.hasRam[0] = 1;
    c.ramBw[0] = 10; c.ioRate[0] = 10; c.ioConc[0] = 1;
    for (const [slot, kind, cores, ops, tensor, idle, load] of [
      [0, 1, 2, 20, 40, 2, 20], [1, 1, 4, 40, 80, 3, 80], [2, 2, 0, 0, 120, 5, 40],
    ] as const) {
      c.accelKind[slot] = kind; c.accelCores[slot] = cores; c.accelClockHz[slot] = 10;
      c.accelVram[slot] = 100; c.accelOps[slot] = ops; c.accelTensorOps[slot] = tensor;
      c.accelIdleW[slot] = idle; c.accelLoadW[slot] = load;
    }
    c.idleW[2] = 10;
  });
}
const fixture = (): World => physWorld(fixtureState());

function tick(w: World): void {
  runPhase(w);
  powerPhase(w);
  thermalPhase(w);
  ledgerPhase(w);
  w.tick += 1;
}

describe('accelerator execution and power integration', () => {
  it('bills a completed half-tick task on its actual GPU, then clears duty next tick', () => {
    const w = fixture();
    feed(w, 0, 1, 2);
    tick(w);
    expect(w.hot.sys.running[0]).toBe(0);
    expect(w.hot.sys.accelTaskS[0]).toBe(0);
    expect(w.hot.sys.accelTaskS[1]).toBe(DT_S / 2);
    expect(w.hot.sys.drawW[0]).toBe(50);
    expect(w.ledger.energyMeter).toBe(0.05);
    tick(w);
    expect(w.hot.sys.accelTaskS[1]).toBe(0);
    expect(w.hot.sys.drawW[0]).toBe(10);
  });

  it('bills a tensor task on the NPU while both GPUs draw only idle', () => {
    const w = fixture();
    feed(w, 1, 1, 6);
    tick(w);
    expect([...w.hot.sys.accelTaskS.slice(0, 3)]).toEqual([0, 0, DT_S / 2]);
    expect(w.hot.sys.drawW[0]).toBe(30);
  });

  it('broadcasts linked duty to both GPUs and retains NPU isolation', () => {
    const w = fixture();
    w.compiled.sys.gpuLinked[0] = 1;
    feed(w, 0, 1, 3);
    tick(w);
    expect([...w.hot.sys.accelTaskS.slice(0, 3)]).toEqual([DT_S / 2, DT_S / 2, 0]);
    expect(w.hot.sys.drawW[0]).toBe(60);
    expect(w.hot.sys.accelUsedVram[POOL_DOMAIN]).toBe(0);
  });

  it('power failure releases actual GPU holds and lists without erasing the consumed tick', () => {
    const w = fixture();
    w.compiled.sys.psuCapW[0] = 50;
    w.hot.sys.psuOverTicks[0] = 99;
    feed(w, 0, 1, 40);
    tick(w);
    expect(w.hot.sys.mode[0]).toBe(MODE.dark);
    expect(w.hot.sys.drawW[0]).toBe(90);
    expect(w.hot.sys.accelTaskS[1]).toBe(DT_S);
    expect(w.hot.sys.accelUsedVram.slice(0, ACCEL_DOMAINS)).toEqual(new Float64Array(ACCEL_DOMAINS));
    expect(w.hot.sys.accelHolders.slice(0, ACCEL_DOMAINS)).toEqual(new Uint16Array(ACCEL_DOMAINS));
    expect([...w.hot.sys.accelHead.slice(0, ACCEL_CLOCKS)]).toEqual(Array(ACCEL_CLOCKS).fill(-1));
    expect(w.hot.sys.running[0]).toBe(0);
    expect(w.ledger.gross).toBe(0n);
    tick(w);
    expect(w.hot.sys.drawW[0]).toBe(0);
    expect(w.hot.sys.accelTaskS[1]).toBe(0);
  });

  it('keeps completed work, per-card power, RNG and exact wallets invariant under uneven advances', () => {
    const base = fixtureState();
    const w = physWorld(base);
    feed(w, 0, 1, 2);
    feed(w, 1, 1, 6);
    const seeded = commitWorld(base, w, 0);
    const whole = advanceGame(seeded, 300).state;
    const partitioned = [1, 99, 1, 37, 62, 100].reduce((s, ms) => advanceGame(s, ms).state, seeded);
    expect(partitioned).toEqual(whole);
    expect(whole.wallet.energyMeter).toBeCloseTo(0.09);
    expect([...whole.hot.sys.accelTaskS.slice(0, MAX_ACCELS)]).toEqual(Array(MAX_ACCELS).fill(0));
  });
});
