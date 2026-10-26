import { describe, expect, it } from 'vitest';
import { applyAction } from '../core/actions';
import { createInitialState } from '../core/state';
import { compileAll } from '../core/topology';
import { researchId, systemId, type PartRef } from '../types/ids';
import type { GameState } from '../types/state';
import { capacity } from './catalog/curves';
import { PARTS } from './catalog';
import { quote } from './quotes';
import { deriveUnlocks } from './research/effects';

const sys = systemId(0);
const l1: PartRef = { unit: { kind: 'system', id: sys }, slot: { kind: 'l1', socket: 0 } };
function boot(credits: string, done: string[] = []): GameState {
  const base = createInitialState(42);
  const ids = done.map(researchId);
  const research = { ...base.research, completed: ids, unlocks: deriveUnlocks(ids) };
  return { ...base, research, compiled: compileAll(base.build, research), wallet: { ...base.wallet, credits: credits as never } };
}

describe('upgradePartTo: several levels in one action', () => {
  it('lands on the level and charges exactly the sum of the single steps', () => {
    const s = boot('1000000');
    const to = applyAction(s, { type: 'upgradePartTo', part: l1, level: 4 });
    let steps = s;
    for (let i = 0; i < 3; i += 1) { const o = applyAction(steps, { type: 'upgradePart', part: l1 }); if (!o.ok) throw new Error('step'); steps = o.state; }
    expect(to.ok).toBe(true);
    if (!to.ok) return;
    expect(to.state.build.systems[0]!.spec.cpu!.l1.level).toBe(4);
    expect(to.state.wallet.credits).toBe(steps.wallet.credits);
  });

  it('is rejected, changing nothing, when the wallet cannot cover the total', () => {
    const rich = boot('1000000');
    const price = BigInt(quote(rich, { kind: 'meet', system: sys, need: { cacheBits: capacity(PARTS.l1, 0, 4) } }).quotes
      .find((q) => q.action.type === 'upgradePartTo')!.cost);
    const short = boot((price - 1n).toString());
    const out = applyAction(short, { type: 'upgradePartTo', part: l1, level: 4 });
    expect(out.ok).toBe(false);
    expect(out.state).toBe(short);
  });
});

describe('meet quote', () => {
  it('a cache-only gap: the minimal L1 level that reaches the need, its summed price and before → after', () => {
    const s = boot('1000000');
    const need = capacity(PARTS.l1, 0, 4);
    const lines = quote(s, { kind: 'meet', system: sys, need: { cacheBits: need } }).quotes;
    const up = lines.find((q) => q.action.type === 'upgradePartTo')!;
    expect(up.action).toEqual({ type: 'upgradePartTo', part: l1, level: 4 });
    expect(up.locked).toBeNull();
    expect(up.label).toBe('Hz L1 · L1 → L4');
    // L2 is the other cache line; before l2Cache it is locked with that research.
    const l2 = lines.find((q) => q.action.type === 'addPart')!;
    expect(l2.locked).toMatchObject({ code: 'research', node: 'l2Cache' });
  });

  it('a cache gap past the L1 top: a replace that needs the next fab, and L2 once researched', () => {
    const s = boot('1000000000', ['l2Cache']);
    const lines = quote(s, { kind: 'meet', system: sys, need: { cacheBits: 1e6 } }).quotes;
    const replace = lines.find((q) => q.action.type === 'replacePart')!;
    expect(replace.locked).toMatchObject({ code: 'research', node: 'fabKhz' });
    const l2 = lines.find((q) => q.action.type === 'addPart');
    expect(l2?.locked ?? null).toBeNull();
  });
});
