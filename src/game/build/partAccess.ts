import type { BuildState, CpuBuild, PartLevel, SystemSpec } from '../types/build';
import type { PartId } from '../types/catalog';
import type { PartRef, UnitRef } from '../types/ids';
import type { GpuBuild } from '../types/gpu';
import { evaluateGpu } from './catalog/gpuModels';

/** A part as the catalog sees it. For the data plane and backbone `level` is the ladder index k; for a switch it is 0. */
export interface PartAt { readonly id: PartId; readonly gen: number; readonly level: number; readonly gpu?: GpuBuild }

type ChipKind = 'cpu' | 'clock' | 'l1' | 'l2' | 'l3';
const CHIP: readonly string[] = ['cpu', 'clock', 'l1', 'l2', 'l3', 'core'];
export const isChipSlot = (ref: PartRef): boolean => CHIP.includes(ref.slot.kind);

const at = (id: PartId, p: PartLevel | null | undefined): PartAt | null => (p ? { id, gen: p.gen, level: p.level } : null);

export function readPart(build: BuildState, ref: PartRef): PartAt | null {
  const { unit, slot } = ref;
  if (unit.kind === 'system') {
    const sys = build.systems[unit.id]?.spec;
    if (!sys) return null;
    const cpu = sys.cpu && 'socket' in slot && slot.socket < sys.cpuCount ? sys.cpu : null;
    switch (slot.kind) {
      case 'cpu': case 'clock': case 'l1': case 'l2': case 'l3': return at(slot.kind, cpu?.[slot.kind]);
      case 'core': return at('core', cpu?.cores[slot.index]);
      case 'scheduler': return at('scheduler', sys.scheduler);
      case 'psu': return at('psu', sys.psu);
      case 'ram': return at('ram', sys.ram[slot.index]);
      case 'gpu': {
        const a = sys.accels[slot.index];
        if (!a) return null;
        if (a.kind === 'npu') return at('npu', a);
        const stats = evaluateGpu(a.model, a.upgrades);
        return { id: 'gpu', gen: stats.generation - 1, level: a.upgrades + 1, gpu: a };
      }
      case 'drive': return at('storage', sys.drives[slot.index]);
      default: return null;
    }
  }
  if (unit.kind === 'rack') {
    const rack = build.racks[unit.id];
    if (!rack) return null;
    if (slot.kind === 'rackCooler') return at('rackCooler', rack.cooler);
    if (slot.kind === 'pdu') return at('pdu', rack.pdu);
    if (slot.kind === 'lb') return at('lb', rack.lb);
    if (slot.kind === 'switch') return { id: 'switch', gen: rack.switch.gen, level: 0 };
    return null;
  }
  if (unit.kind === 'room') {
    const room = build.rooms[unit.id];
    if (!room) return null;
    if (slot.kind === 'roomCooler') return at('roomCooler', room.cooler);
    if (slot.kind === 'roomLb') return at('roomLb', room.lb);
    if (slot.kind === 'roomSwitch') return { id: 'roomSwitch', gen: room.switch.gen, level: 0 };
    if (slot.kind === 'ups') return at('ups', room.ups[slot.index]);
    return null;
  }
  if (unit.kind === 'site') {
    const site = build.sites[unit.id];
    if (!site) return null;
    if (slot.kind === 'grid') return at('grid', site.grid);
    if (slot.kind === 'dataPlane') return { id: 'dataPlane', gen: site.dataPlane.gen, level: site.dataPlane.k };
    if (slot.kind === 'backbone') return site.backbone ? { id: 'backbone', gen: site.backbone.gen, level: site.backbone.k } : null;
    return null;
  }
  return slot.kind === 'globalScheduler' ? at('globalScheduler', build.global.scheduler) : null;
}

const replaceAt = <T>(list: readonly T[], i: number, value: T): T[] => list.map((x, j) => (j === i ? value : x));
const setLevel = <T extends PartLevel>(p: T, gen: number, level: number): T => ({ ...p, gen, level });

/** Every CPU in a system is the one CpuBuild (D7.3), so a chip-part edit applies to all of them. */
function writeChip(sys: SystemSpec, ref: PartRef, gen: number, level: number): SystemSpec | null {
  const slot = ref.slot;
  const cpu = sys.cpu;
  if (!cpu) return null;
  let next: CpuBuild | null;
  if (slot.kind === 'core') {
    const core = cpu.cores[slot.index];
    next = core ? { ...cpu, cores: replaceAt(cpu.cores, slot.index, setLevel(core, gen, level)) } : null;
  } else {
    const kind = slot.kind as ChipKind;
    const part = cpu[kind];
    next = part ? { ...cpu, [kind]: setLevel(part, gen, level) } : null;
  }
  return next && { ...sys, cpu: next };
}

/** Sets a part's generation and level (k for ladders). Returns null if the part does not exist. */
export function writePart(build: BuildState, ref: PartRef, gen: number, level: number): BuildState | null {
  const { unit, slot } = ref;
  if (unit.kind === 'system') {
    const owner = build.systems[unit.id];
    if (!owner) return null;
    const sys = owner.spec;
    let next: SystemSpec | null = null;
    if (isChipSlot(ref)) next = writeChip(sys, ref, gen, level);
    else if (slot.kind === 'scheduler') next = sys.scheduler && { ...sys, scheduler: setLevel(sys.scheduler, gen, level) };
    else if (slot.kind === 'psu') next = { ...sys, psu: setLevel(sys.psu, gen, level) };
    else if (slot.kind === 'ram' && sys.ram[slot.index]) next = { ...sys, ram: replaceAt(sys.ram, slot.index, setLevel(sys.ram[slot.index]!, gen, level)) };
    else if (slot.kind === 'gpu' && sys.accels[slot.index]) {
      const card = sys.accels[slot.index]!;
      if (card.kind === 'npu') next = { ...sys, accels: replaceAt(sys.accels, slot.index, setLevel(card, gen, level)) };
      else {
        if (evaluateGpu(card.model, card.upgrades).generation - 1 !== gen) return null;
        evaluateGpu(card.model, level - 1);
        next = { ...sys, accels: replaceAt(sys.accels, slot.index, { ...card, upgrades: level - 1 }) };
      }
    }
    else if (slot.kind === 'drive' && sys.drives[slot.index]) next = { ...sys, drives: replaceAt(sys.drives, slot.index, setLevel(sys.drives[slot.index]!, gen, level)) };
    return next && withSpec(build, unit.id, next);
  }
  if (unit.kind === 'rack') {
    const rack = build.racks[unit.id];
    if (!rack) return null;
    const key = slot.kind === 'rackCooler' ? 'cooler' : slot.kind === 'pdu' ? 'pdu' : slot.kind === 'lb' ? 'lb' : null;
    return key && { ...build, racks: replaceAt(build.racks, unit.id, { ...rack, [key]: setLevel(rack[key], gen, level) }) };
  }
  if (unit.kind === 'room') {
    const room = build.rooms[unit.id];
    if (!room) return null;
    if (slot.kind === 'ups') return room.ups[slot.index] ? { ...build, rooms: replaceAt(build.rooms, unit.id, { ...room, ups: replaceAt(room.ups, slot.index, setLevel(room.ups[slot.index]!, gen, level)) }) } : null;
    const key = slot.kind === 'roomCooler' ? 'cooler' : slot.kind === 'roomLb' ? 'lb' : null;
    return key && { ...build, rooms: replaceAt(build.rooms, unit.id, { ...room, [key]: setLevel(room[key], gen, level) }) };
  }
  if (unit.kind === 'site') {
    const site = build.sites[unit.id];
    if (!site) return null;
    if (slot.kind === 'grid') return { ...build, sites: replaceAt(build.sites, unit.id, { ...site, grid: setLevel(site.grid, gen, level) }) };
    if (slot.kind === 'dataPlane') return { ...build, sites: replaceAt(build.sites, unit.id, { ...site, dataPlane: { ...site.dataPlane, gen, k: level } }) };
    if (slot.kind === 'backbone' && site.backbone) return { ...build, sites: replaceAt(build.sites, unit.id, { ...site, backbone: { gen, k: level } }) };
    return null;
  }
  const g = build.global.scheduler;
  return slot.kind === 'globalScheduler' && g ? { ...build, global: { scheduler: setLevel(g, gen, level) } } : null;
}

/** The unit a cold change of this part takes down (spec §4.5). Global parts have none. */
export function coldScope(ref: PartRef): UnitRef | null {
  if (ref.unit.kind === 'global') return null;
  if (ref.slot.kind === 'backbone') return null;
  return ref.unit;
}

/** CPU count multiplier for chip-part prices (D7.3: upgrades are priced × CPU count). */
export const cpuCount = (build: BuildState, ref: PartRef): number =>
  ref.unit.kind === 'system' && isChipSlot(ref) ? Math.max(1, build.systems[ref.unit.id]?.spec.cpuCount ?? 1) : 1;

/** Replaces one system's spec. The new spec belongs to that system alone; others keep sharing theirs (R20). */
export function withSpec(build: BuildState, id: number, spec: SystemSpec): BuildState {
  const sys = build.systems[id];
  return sys ? { ...build, systems: replaceAt(build.systems, id, { ...sys, spec }) } : build;
}
