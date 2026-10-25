import { describe, expect, it, vi } from 'vitest';
import { ACCEL_DOMAINS, DT_S, REGIONS } from '../core/constants';
import { ledgerPhase } from '../core/ledger';
import { MODE } from '../core/timers';
import type { World } from '../core/world';
import { accelClockAt, recordAccelClock } from '../exec/accelerators';
import { runPhase } from '../exec/run';
import { enqueue } from '../exec/alloc';
import { admittedOf, noteAdmitted, slotsOf } from '../exec/slots';
import { probeHead, takeHead } from '../market/queue';
import { feed } from '../exec/testWorld';
import type { FamilyDef } from '../types/catalog';
import { powerPhase } from './power';
import { physState, physTicks, physWorld } from './testWorld';
import { thermalPhase } from './thermal';

vi.mock('../build/compile', () => ({ compileUnits: () => undefined }));
vi.mock('../market/families', async (original) => {
  const actual = await original<typeof import('../market/families')>();
  const { familyId } = await import('../types/ids');
  const families: FamilyDef[] = (['gpu', 'compute'] as const).map((resource, id) => ({
    id: familyId(id), key: `cap-${resource}`, name: resource, band: 'bits', note: '',
    window: { from: 0, to: 0 }, weight: 0, stages: [{ resource, work: { fixed: 0, perSize: 1 } }],
    grain: 2 ** 40, threads: 1, workingSet: { fixed: 0, perSize: 0 }, vramBits: { fixed: resource === 'gpu' ? 50 : 0, perSize: 0 },
    windowS: null, payloadBits: { fixed: 0, perSize: 0 },
    members: 1, minZones: 1, region: { kind: 'any' }, tensor: false, ecc: false,
    gpuCoresMin: resource === 'gpu' ? 2 : 0, affinity: 'general', dataRatio: 10,
  }));
  return { ...actual, FAMILIES: families };
});

type Supply = 'psu' | 'pdu';

/** A rack with one loaded system and one idle, zero-watt system. Only the tested supply is limited. */
function fixture(supply: Supply, capped = true): World {
  const state = physState({
    serversPerRack: 2,
    rack: (r) => ({ ...r, pdu: { ...r.pdu, capped } }),
  }, ({ sys: c, rack }) => {
    c.threads[0] = 2; c.cores[0] = 2; c.K[0] = 2; c.Q[0] = 2; c.keff[0] = 2; c.slots[0] = 4;
    c.threadRate[0] = 100; c.memCap[0] = 100; c.cacheBits[0] = 100;
    c.accelKind[7] = 1; c.accelCores[7] = 4; c.accelClockHz[7] = 10;
    c.accelVram[7] = 100; c.accelOps[7] = 40; c.accelTensorOps[7] = 40;
    c.accelIdleW[7] = 10; c.accelLoadW[7] = 80; c.idleW[2] = 10;
    if (supply === 'psu') c.psuCapW[0] = 50;
    else rack.pduCapW[0] = 50;
  });
  const systems = state.build.systems.map((s) => s && ({
    ...s, spec: { ...s.spec, psu: { ...s.spec.psu, capped } },
  }));
  // No drawn window: the tests put exact work at the queue front.
  const w = physWorld({ ...state, build: { ...state.build, systems }, market: { ...state.market, window: [] } });
  w.research.unlocks = { ...w.research.unlocks, rules: ['powerCap'], bootTicks: 100 };
  w.ledger.credits = 1000n;
  return w;
}

/** Takes queue-front work straight into system 0's slots, without a transfer (the supply is under test, not the network). */
function admitFront(w: World): void {
  while (w.hot.sys.mode[0] === MODE.onMarket && admittedOf(w, 0) < slotsOf(w, 0)) {
    const r = probeHead(w);
    if (r < 0) return;
    enqueue(w, 0, takeHead(w, r));
    noteAdmitted(w, 0, 1);
  }
}

function tick(w: World, count = 1): void {
  for (let i = 0; i < count; i += 1) {
    admitFront(w);
    runPhase(w);
    powerPhase(w);
    thermalPhase(w);
    ledgerPhase(w);
    w.tick += 1;
  }
}

const overTicks = (w: World, supply: Supply): number =>
  supply === 'psu' ? w.hot.sys.psuOverTicks[0]! : w.hot.rack.pduOverTicks[0]!;
const capFactor = (w: World, supply: Supply): number =>
  supply === 'psu' ? w.hot.sys.capFactor[0]! : w.hot.rack.capFactor[0]!;

describe.each(['psu', 'pdu'] as const)('%s caps with uncappable draw', (supply) => {
  it.each([false, true])('GPU task load fails after 10 accumulated seconds with capped=%s', (capped) => {
    const w = fixture(supply, capped);
    if (supply === 'psu') w.compiled.sys.psuLoss[0] = 0.1;
    else w.compiled.rack.pduLoss[0] = 0.1;
    const r = feed(w, 0, 1, 4000);
    tick(w, 99);
    expect(overTicks(w, supply)).toBe(99);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
    expect(w.hot.sys.drawW[0]).toBe(90);
    expect(supply === 'psu' ? w.hot.sys.psuUsage[0] : w.hot.rack.pduUsage[0]).toBe(1.8);
    expect(w.hot.sys.accelTaskS[7]).toBe(DT_S);
    expect(capFactor(w, supply)).toBe(capped ? 0.1 : 1);
    const clock = recordAccelClock(w, 0, r);
    const completed = accelClockAt(w, clock, w.hot.rack.effClock[0]!) - w.hot.rec.start[r]!;
    expect(completed).toBeCloseTo(40 * DT_S * 99);
    tick(w);
    expect(w.hot.sys.mode[0]).toBe(MODE.dark);
    expect(overTicks(w, supply)).toBe(0);
    expect(w.hot.sys.accelTaskS[7]).toBe(DT_S);
    expect(w.hot.sys.drawW[0]).toBe(90);
    expect(w.hot.rack.heatW[0]).toBe(117);
    expect(w.ledger.energy).toBe(11n);
    expect(w.ledger.energyMeter).toBeCloseTo(0.7);
    expect(w.hot.fam.failTick[3]).toBe(1);
    expect(w.hot.sys.running[0]).toBe(0);
    expect([...w.hot.sys.accelUsedVram.slice(0, ACCEL_DOMAINS)]).toEqual(Array(ACCEL_DOMAINS).fill(0));
    expect(w.events.entries).toContainEqual(expect.objectContaining({ kind: 'supplyFailed', supply: { kind: supply, id: 0 } }));
    tick(w, 99);
    expect(w.hot.sys.mode[0]).toBe(MODE.dark);
    expect(w.hot.sys.drawW[0]).toBe(0);
    tick(w);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
    expect(w.hot.sys.drawW[0]).toBe(0);
  });

  it('reduces CPU clock and load while GPU throughput and watts remain unchanged', () => {
    const w = fixture(supply);
    w.compiled.sys.coreLoadW[0] = 80;
    w.compiled.sys.accelLoadW[7] = 20;
    const gpu = feed(w, 0, 1, 4000);
    feed(w, 1, 1, 4000);
    tick(w);
    expect(w.hot.sys.drawW[0]).toBe(110);
    expect(w.hot.sys.clockFactor[0]).toBe(0.1);
    tick(w, 109);
    expect(w.hot.sys.drawW[0]).toBeCloseTo(38);
    expect(w.hot.sys.clockFactor[0]).toBe(0.1);
    expect(overTicks(w, supply)).toBe(0);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
    expect(w.hot.sys.accelTaskS[7]).toBe(DT_S);
    expect(accelClockAt(w, recordAccelClock(w, 0, gpu), w.hot.rack.effClock[0]!) - w.hot.rec.start[gpu]!).toBeCloseTo(440);
  });

  it('preserves CPU-only cap settling without accumulating overload', () => {
    const w = fixture(supply);
    w.compiled.sys.coreLoadW[0] = 160;
    feed(w, 1, 1, 4000);
    tick(w);
    expect(w.hot.sys.drawW[0]).toBe(90);
    expect(overTicks(w, supply)).toBe(0);
    tick(w, 109);
    expect(w.hot.sys.drawW[0]).toBe(42);
    expect(w.hot.sys.clockFactor[0]).toBe(0.4);
    expect(w.hot.sys.accelTaskS[7]).toBe(0);
    expect(overTicks(w, supply)).toBe(0);
    expect(w.hot.sys.mode[0]).toBe(MODE.onMarket);
  });

  it.each([1, 3])('counts fixed non-GPU resource %i load toward overload', (resource) => {
    const w = fixture(supply);
    w.compiled.sys.loadW[resource] = 80;
    w.hot.sys.active[resource] = 1;
    physTicks(w, 99);
    expect(overTicks(w, supply)).toBe(99);
    physTicks(w, 1);
    expect(w.hot.sys.mode[0]).toBe(MODE.dark);
  });

  it('uses partial per-card duty at capacity to cool down instead of the full load rating', () => {
    const w = fixture(supply);
    if (supply === 'psu') w.hot.sys.psuOverTicks[0] = 80;
    else w.hot.rack.pduOverTicks[0] = 80;
    feed(w, 0, 1, 2);
    tick(w);
    expect(w.hot.sys.accelTaskS[7]).toBe(DT_S / 2);
    expect(w.hot.sys.drawW[0]).toBe(50);
    expect(overTicks(w, supply)).toBe(79);
    expect(w.ledger.energyMeter).toBeCloseTo(50 * DT_S * REGIONS[0]!.energyPrice);
  });
});
