import type { BuildState, MemoryUpgrade, SystemSpec } from '../types/build';
import type { PartRef, SwitchRef } from '../types/ids';
import type { GameState } from '../types/state';
import { gpuAtTierIndex, gpuModel, isLadder, LADDERS } from './catalog';
import { coldScope, readPart, withSpec, writePart } from './partAccess';
import { coldScopes, fail, planned, type Plan } from './plan';
import { switchAt, withSwitch } from './ports';

const edit = <T>(rows: readonly (T | null)[], id: number, change: (row: T) => T) => rows.map((row, i) => i === id && row ? change(row) : row);
const drop = <T>(rows: readonly T[], id: number) => rows.filter((_, i) => i !== id);
function result(state: GameState, ref: PartRef, build: BuildState | null, label: string): Plan {
  return build ? planned({ build, price: 0n, cold: coldScopes(state, coldScope(ref), ref) }, label) : fail('invalid', 'No such component');
}

/** Step down without a purchase charge. Commit returns half the relinquished paid cost. */
export function planDowngrade(state: GameState, ref: PartRef, axis: MemoryUpgrade = 'capacity'): Plan {
  const part = readPart(state.build, ref);
  if (!part || part.level < 0 || (!isLadder(part.id) && part.level === 0) || ref.slot.kind === 'core') return fail('invalid', 'No lower level');
  const { unit, slot } = ref;
  if (part.id === 'switch' || part.id === 'roomSwitch') {
    const sw = unit.kind === 'rack' || unit.kind === 'room' ? unit as SwitchRef : null;
    const have = sw && switchAt(state.build, sw);
    if (!sw || !have || !have.sw.ports.length) return fail('invalid', 'No switch');
    const base = have.row.baseK[have.sw.gen]!;
    const lower = (k: number) => Math.max(base, k - 1);
    if (have.sw.ports.some(k => k > base) || have.sw.uplinks.some(k => k > base))
      return result(state, ref, withSwitch(state.build, sw, { ...have.sw, ports: have.sw.ports.map(lower), uplinks: have.sw.uplinks.map(lower) }), 'Downgrade switch');
    if (have.sw.gen === 0) return fail('invalid', 'Lowest generation');
    const gen = have.sw.gen - 1, k = have.row.baseK[gen]!;
    return result(state, ref, withSwitch(state.build, sw, { ...have.sw, gen, ports: have.sw.ports.map(() => k), uplinks: have.sw.uplinks.map(() => k) }), 'Downgrade switch');
  }
  if (unit.kind === 'system') {
    const spec = state.build.systems[unit.id]?.spec;
    if (!spec) return fail('invalid', 'No system');
    let next: SystemSpec | null = null;
    if (slot.kind === 'cpu' && spec.cpu && part.gen > 0) {
      const gen = part.gen - 1;
      next = { ...spec, cpu: { cpu: { gen, level: 1 }, clock: { gen, level: 1 }, cache: { gen, level: 1 }, cores: spec.cpu.cores.map(() => ({ gen, level: 1 })) } };
    } else if (slot.kind === 'ram' || slot.kind === 'drive') {
      const rows = slot.kind === 'ram' ? spec.ram : spec.drives, have = rows[slot.index];
      if (!have) return fail('invalid', 'No module');
      const key = axis === 'speed' ? 'speedLevel' : 'level', level = have[key];
      if (level <= 1 && have.gen === 0) return fail('invalid', 'Lowest level');
      const value = level > 1 ? { ...have, [key]: level - 1 } : { ...have, gen: have.gen - 1, level: 1, speedLevel: 1 };
      next = slot.kind === 'ram' ? { ...spec, ram: spec.ram.map((m, i) => i === slot.index ? { ...m, ...value } : m) }
        : { ...spec, drives: spec.drives.map((m, i) => i === slot.index ? value : m) };
    } else if (part.gpu && slot.kind === 'gpu') {
      const model = gpuModel(part.gpu.model)!;
      const lower = model.tierIndex > 0 ? gpuAtTierIndex(model.model, model.tierIndex - 1)
        : model.generation > 1 ? `${model.generation - 1}${model.series}30` : null;
      if (!lower || !gpuModel(lower)) return fail('invalid', 'Lowest tier');
      next = { ...spec, accels: spec.accels.map((card, i) => i === slot.index ? { kind: 'gpu', model: lower as typeof model.model } : card) };
    }
    if (next) return result(state, ref, withSpec(state.build, unit.id, next), 'Downgrade');
  }
  const floor = isLadder(part.id) ? LADDERS[part.id].baseK[part.gen]! : 1;
  if (part.level <= floor && part.gen === 0) return fail('invalid', 'Lowest level');
  const gen = part.level > floor ? part.gen : part.gen - 1;
  const level = part.level > floor ? part.level - 1 : isLadder(part.id) ? LADDERS[part.id].baseK[gen]! : 1;
  return result(state, ref, writePart(state.build, ref, gen, level), 'Downgrade');
}

/** Optional parts leave an empty slot. Built-in infrastructure uses level 0 until reinstalled. */
export function planRemove(state: GameState, ref: PartRef): Plan {
  const part = readPart(state.build, ref);
  if (!part) return fail('invalid', 'No component');
  const { unit, slot } = ref;
  let build: BuildState | null = null;
  if (unit.kind === 'system') {
    const spec = state.build.systems[unit.id]?.spec;
    if (!spec) return fail('invalid', 'No system');
    let next: SystemSpec | null = null;
    if (slot.kind === 'cpu') next = spec.cpuCount > 1 ? { ...spec, cpuCount: spec.cpuCount - 1 } : { ...spec, cpu: null, cpuCount: 0 };
    else if (slot.kind === 'core' && spec.cpu) next = { ...spec, cpu: { ...spec.cpu, cores: drop(spec.cpu.cores, slot.index) } };
    else if (slot.kind === 'scheduler') next = { ...spec, scheduler: null };
    else if (slot.kind === 'ram') next = { ...spec, ram: drop(spec.ram, slot.index) };
    else if (slot.kind === 'gpu') next = { ...spec, accels: drop(spec.accels, slot.index) };
    else if (slot.kind === 'drive') next = { ...spec, drives: drop(spec.drives, slot.index) };
    build = next ? withSpec(state.build, unit.id, next) : null;
  }
  if (slot.kind === 'powerCtl' && unit.kind === 'rack') build = { ...state.build, racks: edit(state.build.racks, unit.id, rack => ({ ...rack, powerCtl: null })) };
  if (slot.kind === 'roomStart' && unit.kind === 'room') build = { ...state.build, rooms: edit(state.build.rooms, unit.id, room => ({ ...room, start: null })) };
  if (slot.kind === 'globalStart') build = { ...state.build, global: { ...state.build.global, start: null } };
  if (slot.kind === 'generation' && unit.kind === 'site') build = { ...state.build, sites: edit(state.build.sites, unit.id, site => ({ ...site, generation: null })) };
  if ((part.id === 'switch' || part.id === 'roomSwitch') && (unit.kind === 'rack' || unit.kind === 'room')) {
    const sw = switchAt(state.build, unit)?.sw;
    if (sw && !sw.ports.length && !sw.uplinks.length) return fail('invalid', 'Already removed');
    build = sw ? withSwitch(state.build, unit, { ...sw, ports: [], uplinks: [] }) : null;
  }
  if (!build) {
    const missing = isLadder(part.id) ? -1 : 0;
    if (part.level === missing) return fail('invalid', 'Already removed');
    build = writePart(state.build, ref, part.gen, missing);
  }
  return result(state, ref, build, 'Remove');
}
