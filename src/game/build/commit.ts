import { amount } from '../amount';
import { debitCredits } from '../core/actions';
import { MODE, restingMode, setUnitMode, startTransition } from '../core/timers';
import { compileAll, syncHotSizes } from '../core/topology';
import { commitWorld, openWorld, type World } from '../core/world';
import { killSubtree, reconcileAccelerators } from '../exec';
import type { ActionOutcome } from '../types/actions';
import type { BuildState } from '../types/build';
import { systemId, type UnitRef } from '../types/ids';
import type { GameState } from '../types/state';

/** One validated edit of `build`, ready to commit. */
export interface BuildChange {
  readonly build: BuildState;
  /** Whole Credits to debit (re-quoted by the handler, never from the client). */
  readonly price: bigint;
  /** Scopes taking a cold change. Work is discarded in every phase; downtime applies during rounds. */
  readonly cold?: readonly UnitRef[];
  /** Inventory changes discard old assignments even when hot-swap research removes downtime. */
  readonly kill?: readonly UnitRef[];
  /** Physical accelerator inventory edits, including buying the same native model again. */
  readonly inventoryChangedSystems?: readonly number[];
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
 * Generic part plans also edit NPUs and compact accelerator slots. Levels keep the same card.
 * `changed` resets accelerator duty; `kill` also discards the system's work. A card appended into an
 * empty slot (every existing card keeps its slot) is hot (spec §4.5): it changes the inventory but
 * kills nothing.
 */
function inventoryChanges(before: BuildState, change: BuildChange): { changed: number[]; kill: number[] } {
  const changed = new Set([
    ...(change.inventoryChangedSystems ?? []), ...(change.added ?? []), ...(change.removed ?? []),
  ]);
  const kill = new Set(changed);
  for (let s = 0; s < Math.max(before.systems.length, change.build.systems.length); s += 1) {
    const have = before.systems[s]?.spec.accels ?? [], want = change.build.systems[s]?.spec.accels ?? [];
    if (have === want) continue;
    const moved = have.some((card, slot) => {
      const next = want[slot];
      // A tier step keeps the card (same generation and type); only its specs change.
      return card.kind === 'gpu' ? next?.kind !== 'gpu' || card.model.slice(0, 2) !== next.model.slice(0, 2)
        : next?.kind !== 'npu' || card.gen !== next.gen;
    });
    if (moved || have.length > want.length) { changed.add(s); kill.add(s); }
    else if (have.length < want.length) changed.add(s);
  }
  return { changed: [...changed], kill: [...kill] };
}

/**
 * Debits, bumps the revision, recompiles, grows hot rows, then applies the runtime side of the
 * change: kills with `swap` and the one boot time (D1.8) for cold scopes and adds while a round
 * runs, resting modes otherwise.
 */
export function commitBuild(state: GameState, change: BuildChange): ActionOutcome {
  let next = state;
  if (change.price > 0n) {
    const paid = debitCredits(state, amount(change.price.toString()));
    if (!paid.ok) return paid;
    next = paid.state;
  }
  const build: BuildState = { ...change.build, revision: state.build.revision + 1 };
  const compiled = compileAll(build, state.research, state.roundRewards);
  const after: GameState = { ...next, build, compiled };
  const w = openWorld(after);
  syncHotSizes(w.hot, compiled);
  const running = state.round.phase === 'running';
  const old: World = { ...w, build: state.build, compiled: state.compiled };
  const { changed: inventoryChangedSystems, kill: inventoryKills } = inventoryChanges(state.build, change);
  const killedSystems = new Set<number>();

  for (const s of change.removed ?? []) {
    killSubtree(old, { kind: 'system', id: systemId(s) }, 'swap');
    killedSystems.add(s);
    setUnitMode(w, s, MODE.empty);
  }
  for (const unit of change.cold ?? []) {
    killSubtree(old, unit, 'swap');
    for (const s of systemsUnder(state.build, unit)) killedSystems.add(s);
    for (const s of systemsUnder(build, unit)) {
      if (running) startTransition(w, s, 'cold');
      else setUnitMode(w, s, restingMode(w, s));
    }
  }
  for (const unit of change.kill ?? []) {
    const systems = systemsUnder(state.build, unit);
    if (!systems.every((s) => killedSystems.has(s))) killSubtree(old, unit, 'swap');
    for (const s of systems) killedSystems.add(s);
  }
  for (const s of inventoryKills) {
    if (state.build.systems[s] && !killedSystems.has(s)) killSubtree(old, { kind: 'system', id: systemId(s) }, 'swap');
  }
  for (const s of change.added ?? []) {
    if (running && compiled.sys.intent[s] === 1) startTransition(w, s, 'boot');
    else setUnitMode(w, s, restingMode(w, s));
  }
  reconcileAccelerators(w, state.compiled, inventoryChangedSystems);
  return { ok: true, state: commitWorld(after, w, state.clock.carryMs) };
}
