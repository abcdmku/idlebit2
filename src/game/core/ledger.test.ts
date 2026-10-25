import { createInitialState } from './state';
import { ledgerPhase, netPerMinute } from './ledger';
import { commitWorld, openWorld, type World } from './world';
import { advanceGame } from './advance';
import { researchId } from '../types/ids';
import type { GameState } from '../types/state';

function tick(w: World, setup: (w: World) => void): void {
  setup(w);
  ledgerPhase(w);
  w.tick += 1;
}
const pay = (w: World, payout: number, count: number) => {
  const t = w.hot.tally;
  if (t.len >= t.cap) throw new Error('test tally full');
  t.pay[t.len] = payout; t.count[t.len] = count; t.len += 1;
};

describe('ledger phase', () => {
  it('pays count × payout exactly, beyond 2^53', () => {
    const state = createInitialState(42);
    const w = openWorld(state);
    tick(w, () => { pay(w, 2 ** 60, 3); pay(w, 7, 2); });
    const next = commitWorld(state, w, 0);
    expect(next.wallet.credits).toBe((3n * 2n ** 60n + 14n).toString());
    expect(next.ledger.gross).toBe(next.wallet.credits);
    expect(next.round.gross).toBe(next.wallet.credits);
    expect(w.hot.tally.len).toBe(0);
  });

  it('credits whole Data through the sub-unit meter in family order', () => {
    const state = createInitialState(42);
    const w = openWorld(state);
    tick(w, () => { w.hot.fam.dataTick[0] = 0.75; w.hot.fam.dataTick[3] = 0.5; });
    expect(w.ledger.data).toBe(1n);
    expect(w.ledger.dataMeter).toBeCloseTo(0.25, 12);
    expect(w.hot.fam.dataTick[3]).toBe(0);
  });

  it('debits energy one whole Credit at a time at the region price', () => {
    const state = createInitialState(42);
    const w = openWorld(state);
    tick(w, () => { w.hot.bill[0] = 1500; }); // 1500 W × 0.1 s × 0.010 = 1.5 Credits
    expect(w.ledger.credits).toBe(-1n);
    expect(w.ledger.energyMeter).toBeCloseTo(0.5, 12);
    tick(w, () => { w.hot.bill[0] = 1500; });
    expect(w.ledger.credits).toBe(-3n);
    expect(w.hot.bill[0]).toBe(0);
    expect(commitWorld(state, w, 0).ledger.energy).toBe('3');
  });

  it('stops research when the wallet goes negative', () => {
    const base = createInitialState(42);
    const state: GameState = { ...base, research: { ...base.research, active: researchId('pipelining') } };
    const w = openWorld(state);
    tick(w, () => { w.hot.bill[0] = 1000; });
    expect(w.research.stoppedInsolvent).toBe(true);
    expect(w.events.entries.at(-1)).toMatchObject({ kind: 'researchStopped', project: 'pipelining' });
  });

  it('reports whole net Credits per minute from change points', () => {
    const state = createInitialState(42);
    const w = openWorld(state);
    for (let i = 0; i < 1200; i += 1) tick(w, () => { if (i < 600) pay(w, 1, 1); });
    const s = commitWorld(state, w, 0);
    expect(s.ledger.gross).toBe('600');
    expect(netPerMinute(s)).toBe('0'); // nothing earned in the last 60 s
    const half = commitWorld(state, (() => { const v = openWorld(state); for (let i = 0; i < 300; i += 1) tick(v, () => pay(v, 2, 1)); return v; })(), 0);
    expect(netPerMinute(half)).toBe('1200'); // 600 Credits in 30 s
    expect(netPerMinute(advanceGame(createInitialState(1), 0).state)).toBe('0');
  });
});
