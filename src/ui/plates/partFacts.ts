import { FAMILIES, type LevelSnapshot, type PartId, type PartSlot, type PartView } from '../../game';
import { genName, QUEUE_NAMES, SLOT_TITLE } from './copy';
import { bits, hertz, percent } from './format';
import type { Line } from './widgets';

/** What a generic part plate shows, read from the focus snapshot. Null when the part is not on screen. */
export interface PartFacts { title: string; sub: string; level: number; status: string; lines: Line[] }

const PART_ID: Partial<Record<PartSlot['kind'], PartId>> = {
  cpu: 'cpu', clock: 'clock', l1: 'l1', l2: 'l2', l3: 'l3', core: 'core', scheduler: 'scheduler', ram: 'ram', gpu: 'gpu', drive: 'storage',
  dataPlane: 'dataPlane', backbone: 'backbone', grid: 'grid', globalScheduler: 'globalScheduler',
};
const busy = (p: PartView) => (p.active ? `${percent(p.resourceBusy)} busy` : 'Idle');

export function partFacts(focus: LevelSnapshot, slot: PartSlot): PartFacts | null {
  const id = PART_ID[slot.kind];
  const gen = (g: number) => (id ? genName(id, g) : `Gen ${g}`);
  if (focus.level === 'chip') {
    if (slot.kind === 'core') {
      const c = focus.cores.filter((x) => x.socket === slot.socket)[slot.index];
      if (!c) return null;
      return { title: `Core ${slot.index + 1}`, sub: hertz(focus.clock.effectiveHz), level: c.level,
        status: c.busy > 0 ? `${percent(c.busy)} busy` : 'Idle',
        lines: [
          { text: c.family !== null ? `${FAMILIES[c.family]?.name ?? 'Task'} · ${percent(c.progress)} complete` : 'No task running', tone: 'muted' },
          { text: c.research > 0 ? `${percent(c.research)} lent to research` : `${c.threads} ${c.threads === 1 ? 'thread' : 'threads'}`, tone: 'muted' },
        ] };
    }
    if (slot.kind === 'clock') {
      const k = focus.clock;
      return { title: 'Clock', sub: hertz(k.hz), level: k.level, status: 'Drives every lane on the die',
        lines: k.effectiveHz !== k.hz ? [{ text: `Running at ${hertz(k.effectiveHz)}`, tone: 'warn' }] : [] };
    }
    if (slot.kind === 'l1' || slot.kind === 'l2' || slot.kind === 'l3') {
      const kind = slot.kind, c = focus.cache.levels.find((x) => x.kind === kind);
      if (!c) return null;
      return { title: SLOT_TITLE[kind], sub: bits(c.bits), level: c.level, status: 'Holds the working set of each running task',
        lines: [{ text: `${bits(focus.cache.usedBits)} of ${bits(focus.cache.capacityBits)} in use`, tone: 'muted' }] };
    }
    if (slot.kind === 'scheduler') {
      const s = focus.scheduler;
      if (!s) return null;
      return { title: 'Scheduler', sub: QUEUE_NAMES[s.strategy], level: s.level, status: `${s.queued} of ${s.q} queued · runs ${s.k} at once`, lines: [] };
    }
    return null;
  }
  if (focus.level === 'system') {
    if (slot.kind === 'cpu') return { title: 'CPU', sub: gen(focus.cpu.generation), level: focus.cpu.level, status: busy(focus.cpu), lines: [] };
    if (slot.kind === 'ram' || slot.kind === 'gpu' || slot.kind === 'drive') {
      const list = slot.kind === 'ram' ? focus.ram : slot.kind === 'gpu' ? focus.gpu : focus.storage;
      const p = slot.kind === 'gpu' ? list.find(p => p.slot === slot.index) : list[slot.index];
      if (!p) return null;
      // RAM and drives are tiers of one memory (D26.1): what each holds, what spilled into it, and a drive's IO as spill speed.
      const tier = focus.memory.tiers.find(t => t.tier === (slot.kind === 'ram' ? 'ram' : 'disk'));
      // RAM reads plainly as used; every bit on disk spilled from RAM, so a drive reads what it holds as spilled (lead ruling).
      const cap = slot.kind === 'ram' ? (tier ? `${bits(tier.usedBits)} of ${bits(tier.capacityBits)} used` : '')
        : slot.kind === 'gpu' ? `${bits(p.vramUsedBits ?? 0)} VRAM held · tensor tasks with no GPU core minimum`
        : `${tier ? (tier.usedBits > 0 ? `${bits(tier.usedBits)} spilled` : `${bits(tier.capacityBits)} free`) : ''}${tier?.rateBits ? ` · spill speed ${hertz(tier.rateBits)}` : ''}`;
      return { title: `${p.kind === 'npu' ? 'NPU' : SLOT_TITLE[slot.kind]} ${slot.index + 1}`, sub: `${p.kind === 'npu' ? `Gen ${p.generation + 1}` : gen(p.generation)}${p.ecc ? ' · ECC' : ''}`, level: p.level,
        status: busy(p), lines: [{ text: cap, tone: 'muted' }] };
    }
    return null;
  }
  if (focus.level === 'global' && (slot.kind === 'dataPlane' || slot.kind === 'backbone')) {
    const link = focus.backbone.links[0];
    return { title: SLOT_TITLE[slot.kind], sub: link ? gen(link.generation) : '', level: 1,
      status: link ? `${hertz(link.speedHz)} · ${Math.round(link.latencyMs)} ms` : 'No link yet', lines: [] };
  }
  return null;
}
