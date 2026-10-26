import { amount, ZERO_AMOUNT } from '../amount';
import { RESEARCH } from '../build/research/tree';
import { createInitialState } from '../core/state';
import type { GameState } from '../types/state';
import { researchTree } from './research';

describe('research Credit fees', () => {
  const generation = () => {
    const def = RESEARCH.find((node) => node.creditCost !== undefined && node.creditCost !== ZERO_AMOUNT);
    if (!def) throw new Error('GPU generation research needs its accepted Credit fee');
    return def;
  };

  it('publishes exact fees separately from unchanged Data prices and affordability', () => {
    const base = createInitialState(42), def = generation();
    const state: GameState = {
      ...base, wallet: { ...base.wallet, credits: amount((BigInt(def.creditCost!) - 1n).toString()), data: amount(def.data) },
      research: { ...base.research, completed: def.requires, queue: [def.id] },
    };
    const node = researchTree(state).nodes.find((n) => n.id === def.id)!;
    expect(node).toMatchObject({ state: 'queued', creditCost: def.creditCost, dataCost: amount(def.data), needsCredits: true, needsData: false });
    const exact = researchTree({ ...state, wallet: { ...state.wallet, credits: def.creditCost! } }).nodes.find((n) => n.id === def.id)!;
    expect(exact.needsCredits).toBe(false);
    // D32: Credits are 10 × Data for every node.
    expect(researchTree(base).nodes.find((n) => n.id === 'gpuGen2')!.creditCost).toBe(String(10 * RESEARCH.find((d) => d.id === 'gpuGen2')!.data));
  });

  it('does not mark already paid active, parked or completed projects as needing their fee again', () => {
    const base = createInitialState(42), def = generation();
    for (const research of [
      { ...base.research, completed: def.requires, active: def.id },
      { ...base.research, completed: def.requires, parked: { [def.id]: 1 } },
      { ...base.research, completed: [...def.requires, def.id] },
    ]) {
      const node = researchTree({ ...base, research }).nodes.find((n) => n.id === def.id)!;
      expect(node.creditCost).toBe(def.creditCost);
      expect(node.needsCredits).toBe(false);
    }
  });
});
