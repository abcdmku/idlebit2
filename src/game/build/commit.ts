import { reject } from '../core/actions';
import { overSupply, powerLock } from './overSupply';
import { amount } from '../amount';
import { debitCredits } from '../core/actions';
import { MODE, restingMode, setUnitMode, startTransition } from '../core/timers';
import { compileAll, syncHotSizes } from '../core/topology';
import { commitWorld, openWorld, type World } from '../core/world';
import { killSubtree } from '../exec';
import { reconcileHardware } from '../exec/hardware';
import type { ActionOutcome, GameAction } from '../types/actions';
import { investmentChange } from './investments';
import type { BuildState } from '../types/build';
import { systemId, type UnitRef } from '../types/ids';
import type { GameState } from '../types/state';

/** One validated edit of `build`, ready to commit. */
export interface BuildChange {
  readonly build: BuildState;
  /** Whole Credits to debit (re-quoted by the handler, never from the client). */
  readonly price: bigint;
  /** Reserved plan metadata; component edits are live. */
  readonly cold?: readonly UnitRef[];
  /** New systems: mid-round they boot for one boot time (spec §4.4). */
  readonly added?: readonly number[];
  /** Scrapped systems: their work fails with `swap`; their hot rows go empty. */
  readonly removed?: readonly number[];
}

/** Every live system id under a unit, in slot order. */
export function systemsUnder(build: BuildState, unit: UnitRef): number[] {
  switch (unit.kind) {
    case 'system': return build.systems[unit.id] ? [unit.id] : [];
    case 'rack': return (build.racks[unit.id]?.servers ?? []).flatMap((s) => (s !== null && build.systems[s] ? [s] : []));
    case 'room': return (build.rooms[unit.id]?.racks ?? []).flatMap((r) => (r === null ? [] : systemsUnder(build, { kind: 'rack', id: r })));
    case 'site': return (build.sites[unit.id]?.zones ?? []).flatMap((z) => (z === null ? [] : systemsUnder(build, { kind: 'room', id: z })));
  }
}

/**
 * Charge the edit, retain compatible work at the new rates, and return half the paid cost of
 * relinquished hardware. Only newly installed systems boot; existing systems stay live.
 */
export function commitBuild(state: GameState, change: BuildChange, action?: GameAction): ActionOutcome {
  const over = overSupply(state, change.build);
  if (over) return reject(state, 'cap', powerLock(state, over).text);
  let next = state;
  if (change.price > 0n) {
    const paid = debitCredits(state, amount(change.price.toString()));
    if (!paid.ok) return paid;
    next = paid.state;
  }
  const capital = investmentChange(state.build, change.build, change.price, action);
  const build: BuildState = { ...change.build, investments: capital.investments, revision: state.build.revision + 1 };
  const compiled = compileAll(build, state.research, state.roundRewards);
  const after: GameState = { ...next, build, compiled };
  const w = openWorld(after);
  syncHotSizes(w.hot, compiled);
  const running = state.round.phase === 'running';
  const old: World = { ...w, build: state.build, compiled: state.compiled };

  for (const s of change.removed ?? []) {
    killSubtree(old, { kind: 'system', id: systemId(s) }, 'swap');
    setUnitMode(w, s, MODE.empty);
  }
  for (const s of change.added ?? []) {
    if (running && compiled.sys.intent[s] === 1) startTransition(w, s, 'boot');
    else setUnitMode(w, s, restingMode(w, s));
  }
  reconcileHardware(w, old, action);
  w.ledger.credits += capital.refund;
  return { ok: true, state: commitWorld(after, w, state.clock.carryMs) };
}
