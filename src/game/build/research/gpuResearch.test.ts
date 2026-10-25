import { amount } from '../../amount';
import { applyAction } from '../../core/actions';
import { G } from '../../core/buffers';
import { createInitialState } from '../../core/state';
import { compileAll } from '../../core/topology';
import { commitWorld, openWorld } from '../../core/world';
import { researchId } from '../../types/ids';
import type { GameState } from '../../types/state';
import { researchQuote } from '../quotes';
import { deriveUnlocks } from './effects';
import { researchPhase } from './projects';
import { RESEARCH, researchDef } from './tree';

const gen1 = researchId('gpuGen1'), gen2 = researchId('gpuGen2');
const fee = 640000000n, data = 1000000n;
function fixture(credits = fee, balance = data): GameState {
  const base = createInitialState(42);
  const completed = RESEARCH.filter((r) => r.id !== gen1 && r.id !== gen2).map((r) => r.id);
  const research = { ...base.research, completed, unlocks: deriveUnlocks(completed) };
  return { ...base, research, compiled: compileAll(base.build, research),
    wallet: { ...base.wallet, credits: amount(credits.toString()), data: amount(balance.toString()) } };
}
function ready(credits = fee, balance = data): GameState {
  const state = fixture(credits, balance);
  const completed = [...state.research.completed, gen1];
  return { ...state, research: { ...state.research, completed, unlocks: deriveUnlocks(completed) } };
}

describe('GPU generation research fees', () => {
  it('publishes nine generations with exact Credit fees, Data and work', () => {
    for (let generation = 1; generation <= 9; generation += 1) {
      const node = researchDef(`gpuGen${generation}`)!;
      const credits = generation === 1 ? 0n : 64000000n * 10n ** BigInt(generation - 1);
      expect(node.creditCost).toBe(credits.toString());
      expect(node.effects).toContainEqual({ kind: 'gen', part: 'gpu', gen: generation - 1 });
      expect(node.work).toBeGreaterThan(0);
    }
    expect([researchDef(gen2)!.data, researchDef(gen2)!.work]).toEqual([1_000_000, 200_000_000]);
  });

  it('quotes and debits both wallets atomically at first actual start', () => {
    const state = ready();
    expect(researchQuote(state, gen2)).toMatchObject({ cost: data.toString(), creditCost: fee.toString(), affordable: true });
    const started = applyAction(state, { type: 'startResearch', project: gen2 });
    expect(started.ok).toBe(true);
    expect(started.state.wallet).toMatchObject({ credits: '0', data: '0' });
    expect(started.state.ledger).toMatchObject({ creditsSpent: fee.toString(), dataSpent: data.toString() });
    expect(researchQuote(started.state, gen2)).toMatchObject({ cost: '0', creditCost: '0' });
    for (const short of [ready(fee - 1n), ready(fee, data - 1n)]) {
      expect(researchQuote(short, gen2).affordable).toBe(false);
      const failed = applyAction(short, { type: 'startResearch', project: gen2 });
      expect(failed.ok).toBe(false);
      expect(failed.state).toBe(short);
    }
  });

  it('preserves zero-fee research behavior while Credits are negative', () => {
    const state = fixture(-1n, 30000n);
    expect(researchQuote(state, gen1).affordable).toBe(true);
    const out = applyAction(state, { type: 'startResearch', project: gen1 });
    expect(out.ok).toBe(true);
    expect(out.state.research).toMatchObject({ active: gen1, stoppedInsolvent: true });
    expect(out.state.wallet).toMatchObject({ credits: '-1', data: String(30000 - researchDef(gen1)!.data) });
  });

  it('does not charge a queued project until its actual queued start', () => {
    const base = fixture();
    const state = { ...base, research: { ...base.research, active: gen1, activeProgress: researchDef(gen1)!.work - 1 } };
    const queued = applyAction(state, { type: 'queueResearch', project: gen2 });
    expect(queued.ok).toBe(true);
    expect(queued.state.wallet).toEqual(state.wallet);
    expect(queued.state.research.queue).toEqual([gen2]);
    const w = openWorld(queued.state);
    w.hot.g[G.researchOps] = 1;
    researchPhase(w);
    const after = commitWorld(queued.state, w, 0);
    expect(after.research.active).toBe(gen2);
    expect(after.wallet).toMatchObject({ credits: '0', data: '0' });
    expect(after.ledger).toMatchObject({ creditsSpent: fee.toString(), dataSpent: data.toString() });
  });

  it('waits without partial payment when queued Credits are short, then pays once', () => {
    const state = ready(fee - 1n);
    const queued = applyAction(state, { type: 'queueResearch', project: gen2 });
    expect(queued.ok).toBe(true);
    expect(queued.state.research).toMatchObject({ active: null, queue: [gen2], needsData: true });
    const w = openWorld(queued.state);
    researchPhase(w);
    expect(w.research.active).toBeNull();
    expect(w.ledger.data).toBe(data);
    expect(w.ledger.credits).toBe(fee - 1n);
    w.ledger.credits += 1n;
    researchPhase(w);
    expect(w.research.active).toBe(gen2);
    expect([w.ledger.data, w.ledger.credits, w.ledger.creditsSpent]).toEqual([0n, 0n, fee]);
    researchPhase(w);
    expect(w.ledger.creditsSpent).toBe(fee);
  });

  it('parks paid progress on cancel and resumes free, without refunding either wallet', () => {
    const started = applyAction(ready(), { type: 'startResearch', project: gen2 });
    const progressed = { ...started.state, research: { ...started.state.research, activeProgress: 123 } };
    const canceled = applyAction(progressed, { type: 'cancelResearch' });
    expect(canceled.ok).toBe(true);
    expect(canceled.state.wallet).toEqual(started.state.wallet);
    expect(researchQuote(canceled.state, gen2)).toMatchObject({ cost: '0', creditCost: '0', affordable: true });
    const resumed = applyAction(canceled.state, { type: 'startResearch', project: gen2 });
    expect(resumed.ok).toBe(true);
    expect(resumed.state.research.activeProgress).toBe(123);
    expect(resumed.state.ledger).toEqual(started.state.ledger);
    expect(resumed.state.wallet).toEqual(started.state.wallet);
  });
});
