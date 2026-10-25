import type { BuildState } from '../types/build';
import type { LeveledPartId } from './catalog';
import { genCount, partName, PARTS } from './catalog';
import { installPrice } from './catalog/curves';
import type { PartRef } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';
import { genLock } from './locks';
import { readPart } from './partAccess';
import { fail, locked, planned, type Plan } from './plan';
import { defaultStartCtl } from './startCtl';

/**
 * D31 parts (Power control, room and global start controllers, site generation): optional and hot.
 * `replacePart` on an empty slot installs generation g at L1; on a filled one it changes generation at
 * L1 and keeps the start configuration (the busy trigger needs generation 1). Levels use upgradePart.
 */
function writeGen(build: BuildState, ref: PartRef, g: number): BuildState | null {
  const { unit, slot } = ref;
  const ctl = (prev: { startWith: number; trigger: { headWaitS: number; busyPct: number | null }; order: never } | null) =>
    prev ? { ...prev, gen: g, level: 1, trigger: { ...prev.trigger, busyPct: g >= 1 ? prev.trigger.busyPct : null } } : defaultStartCtl(g);
  const set = <T>(list: readonly (T | null)[], i: number, v: T): (T | null)[] => list.map((x, j) => (j === i ? v : x));
  if (unit.kind === 'rack' && slot.kind === 'powerCtl') {
    const rack = build.racks[unit.id];
    return rack ? { ...build, racks: set(build.racks, unit.id, { ...rack, powerCtl: ctl(rack.powerCtl as never) }) } : null;
  }
  if (unit.kind === 'room' && slot.kind === 'roomStart') {
    const room = build.rooms[unit.id];
    return room ? { ...build, rooms: set(build.rooms, unit.id, { ...room, start: ctl(room.start as never) }) } : null;
  }
  if (unit.kind === 'global' && slot.kind === 'globalStart') {
    return build.global.scheduler ? { ...build, global: { ...build.global, start: ctl(build.global.start as never) } } : null;
  }
  if (unit.kind === 'site' && slot.kind === 'generation') {
    const site = build.sites[unit.id];
    return site ? { ...build, sites: set(build.sites, unit.id, { ...site, generation: { gen: g, level: 1 } }) } : null;
  }
  return null;
}

export function planPowerPart(state: GameState, ref: PartRef, g: number): Plan {
  const id = ref.slot.kind as LeveledPartId;
  const row = PARTS[id];
  const label = partName(id, g);
  if (!Number.isInteger(g) || g < 0 || g >= row.base.length) return fail('invalid', 'No such generation', label);
  if (readPart(state.build, ref)?.gen === g) return fail('invalid', 'Same generation', label);
  const price = installPrice(row, g);
  const lock = genLock(state.research.unlocks, id, g);
  if (lock) return locked(lock, label, price);
  const build = writeGen(state.build, ref, g);
  return build ? planned({ build, price }, label) : fail('invalid', 'No place for this part', label);
}

/** An empty D31 slot: one install per generation (quotes.ts turns them into quotes). */
export function powerInstallPlans(state: GameState, ref: PartRef): { action: GameAction; plan: Plan }[] {
  const id = ref.slot.kind as LeveledPartId;
  return Array.from({ length: genCount(id) }, (_, g) =>
    ({ action: { type: 'replacePart', part: ref, generation: g, preserveCapacity: false } as GameAction, plan: planPowerPart(state, ref, g) }));
}
