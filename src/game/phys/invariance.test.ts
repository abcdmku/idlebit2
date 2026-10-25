import { describe, expect, it, vi } from 'vitest';
import { advanceGame } from '../core/advance';
import { openWorld } from '../core/world';
import { physSettled } from './settled';
import type { GameState } from '../types/state';
import { physState } from './testWorld';

// Phys fixtures set every compiled column phys reads; keep them independent of catalog balance (S5).
vi.mock('../build/compile', () => ({ compileUnits: () => undefined }));

/** A hot room: rack 0 over-driven against a small cooler, PDU and UPS near their limits. */
function hotRoom(phase: 'running' | 'between'): GameState {
  const state = physState({ racksPerZone: 2, serversPerRack: 2, round: phase }, (c) => {
    c.sys.idleW[0] = 300; c.sys.idleW[4] = 300; c.sys.psuCapW[0] = 400; c.sys.psuLoss[0] = 0.2;
    c.rack.coolerQc[0] = 400; c.rack.coolerIdleW[0] = 2; c.rack.coolerLoadW[0] = 40; c.rack.coolerTau[0] = 6;
    c.rack.coolerQc[1] = 400; c.rack.pduCapW[0] = 640; c.rack.pduLoss[0] = 0.05;
    c.room.coolerQc[0] = 800; c.room.coolerLoadW[0] = 40; c.room.upsCapW[0] = 2000; c.room.upsLoss[0] = 0.1;
  });
  if (phase === 'between') {
    state.hot.rack.tempF[0] = 98; state.hot.room.tempF[0] = 85; state.hot.rack.pduOverTicks[0] = 40;
  }
  return state;
}

/** Fixed partitions of 2 min into uneven pieces, 1 ms to 7 s. */
const PIECES = [1, 99, 7000, 3333, 250, 1, 6416, 12000, 900, 50_000, 39_950];
/** 20 s: the PDU overloads, fails at 10 s and is still rebooting. */
const RUN_PIECES = [1, 99, 7000, 3333, 250, 1, 6416, 2900];

const chain = (s: GameState, pieces: readonly number[], skipQuiescent = true) =>
  pieces.reduce((acc, ms) => advanceGame(acc, ms, { skipQuiescent }).state, s);

describe('phys under advanceGame', () => {
  it('a running hot rack is delta-invariant: advance(a + b) ≡ advance(b) ∘ advance(a)', () => {
    const total = RUN_PIECES.reduce((a, b) => a + b, 0);
    const whole = advanceGame(hotRoom('running'), total).state;
    const chained = chain(hotRoom('running'), RUN_PIECES);
    expect(chained.hot).toEqual(whole.hot);
    expect(chained.events).toEqual(whole.events);
    expect(chained.wallet).toEqual(whole.wallet);
    expect(whole.hot.rack.tempF[0]).toBeGreaterThan(70);
    expect(whole.events.entries.some((e) => e.kind === 'supplyFailed')).toBe(true);
    expect(whole.wallet.credits).not.toBe('0');
  });

  it('a cooling room between rounds settles, and the quiescent skip changes nothing', () => {
    const pieces = [...PIECES, 1_800_000, 3_600_000, 777];
    const skipped = chain(hotRoom('between'), pieces, true);
    const stepped = chain(hotRoom('between'), pieces, false);
    expect(skipped).toEqual(stepped);
    expect(stepped.hot.rack.pduOverTicks[0]).toBe(0);
    expect(stepped.hot.rack.tempF[0]).toBe(70);
    expect(stepped.hot.room.tempF[0]).toBe(70);
    expect(physSettled(openWorld(stepped))).toBe(true);
    expect(physSettled(openWorld(hotRoom('between')))).toBe(false);
  });
});
