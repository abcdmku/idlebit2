import { ACCEL_GPU_SLOTS, ACCEL_MAX_CPUS, ACCEL_RAM_SLOTS, GENERAL_MAX_GPUS, QUEUE_SAMPLE, GENERAL_MAX_RAM, MAX_CPUS } from '../core/constants';
import { capacity, capacity2, PARTS } from '../build/catalog';
import type { SystemSpec } from '../types/build';
import type { PartId } from '../types/catalog';
import { RES_CLOCKS } from '../core/constants';
import type { NodeRef, SystemId } from '../types/ids';
import type { SystemSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { BuildSlotView, PartView, PartViewKind } from '../types/views';
import { chipSnapshot, chipStatic, cpuCountOf, type ChipStatic } from './chip';
import { modeName, psuView, systemCoreActivity, systemTimerS, ticksToS } from './common';
import { inboundTransfer } from './flows';
import { queuedTasks, runningTasks } from './tasks';
import { acceleratorView } from './accelerators';
import { memoryTiers } from './memory';

const R = RES_CLOCKS;
const RES = { cpu: 0, ram: 1, io: 3 } as const;
const genOpen = (state: GameState, part: PartId): boolean => (state.research.unlocks.gens[part] ?? 0) !== 0;

/** RAM and IO activity retain their shared-resource display. */
const resBusy = (state: GameState, s: number, res: number): number => ((state.hot.sys.active[s * R + res] ?? 0) > 0 ? 1 : 0);

function part(slot: number, kind: PartViewKind, gen: number, level: number, busy: number, ecc?: boolean): PartView {
  const v: PartView = { slot, kind, generation: gen, level, active: busy > 0, resourceBusy: busy };
  return ecc === undefined ? v : { ...v, ecc };
}

/** Board limits (D7.4, D7.6): ceilings on a general board, fixed slots on the accelerator. */
export interface BoardSlots { readonly cpus: number; readonly ram: number; readonly gpus: number; readonly drives: number }
export function boardSlots(state: GameState, spec: SystemSpec | null): BoardSlots {
  const ceil = state.research.unlocks.ceilings;
  if (spec?.board === 'accelerator') return { cpus: ACCEL_MAX_CPUS, ram: ACCEL_RAM_SLOTS, gpus: ACCEL_GPU_SLOTS, drives: ceil.driveSlots };
  return {
    cpus: Math.min(MAX_CPUS, ceil.cpuSockets), ram: Math.min(GENERAL_MAX_RAM, ceil.ramSlots),
    gpus: Math.min(GENERAL_MAX_GPUS, ceil.gpuSlots), drives: ceil.driveSlots,
  };
}

/** Empty sites up to the board's limit, plus one locked site when the next one waits on research. */
function systemSlots(state: GameState, spec: SystemSpec | null): BuildSlotView[] {
  const slots: BuildSlotView[] = [];
  if (!spec) return slots;
  const b = boardSlots(state, spec);
  /** Open sites from `have` to `open` (locked until the part's first generation), then one locked site. */
  const add = (kind: BuildSlotView['kind'], have: number, open: number, researched: boolean, max: number) => {
    for (let i = have; i < open; i += 1) slots.push({ kind, index: i, locked: !researched });
    const next = Math.max(have, open);
    if (next < max) slots.push({ kind, index: next, locked: true });
  };
  if (spec.cpu) add('cpu', cpuCountOf(spec), b.cpus, true, spec.board === 'accelerator' ? ACCEL_MAX_CPUS : MAX_CPUS);
  add('ram', spec.ram.length, b.ram, genOpen(state, 'ram'), spec.board === 'accelerator' ? ACCEL_RAM_SLOTS : GENERAL_MAX_RAM);
  add('gpu', spec.accels.length, b.gpus, genOpen(state, 'gpu'), spec.board === 'accelerator' ? ACCEL_GPU_SLOTS : GENERAL_MAX_GPUS);
  add('drive', spec.drives.length, b.drives, genOpen(state, 'storage'), b.drives);
  return slots;
}

/** Static parts of a system view: its build sites and its CPU view's static parts. */
export interface SystemStatic { readonly slots: readonly BuildSlotView[]; readonly chip: ChipStatic }
export const systemStatic = (state: GameState, id: SystemId): SystemStatic =>
  ({ slots: systemSlots(state, state.build.systems[id]?.spec ?? null), chip: chipStatic(state, id) });

export function systemSnapshot(state: GameState, id: SystemId, parent: NodeRef | null, st: SystemStatic = systemStatic(state, id)): SystemSnapshot {
  const spec = state.build.systems[id]?.spec ?? null;
  const c = state.compiled.sys, h = state.hot.sys;
  const threads = c.threads[id] ?? 0;
  const cpuBusy = threads > 0 ? Math.min(1, (h.busyThreads[id] ?? 0) / threads) : 0;
  const cpuCount = cpuCountOf(spec);
  const { cores, busyCores } = systemCoreActivity(state, id);
  const coresPerCpu = cpuCount > 0 ? cores / cpuCount : 0;
  const cpu0 = spec?.cpu?.cpu ?? { gen: 0, level: 1 };
  const ramBusy = resBusy(state, id, RES.ram), ioBusy = resBusy(state, id, RES.io);
  const timerS = systemTimerS(state.hot, id);
  return {
    level: 'system', parent, systemId: id, kind: spec?.kind ?? 'server', board: spec?.board ?? 'general',
    cpuCount, ramSlots: boardSlots(state, spec).ram, etaCfg: c.etaCfg[id] ?? 1,
    chip: chipSnapshot(state, id, { level: 'system', id }, st.chip),
    // Pooled scheduler display: fill CPU 1 first; exec does not yet write sockBusy.
    cpuBusy: Array.from({ length: cpuCount }, (_, socket) =>
      coresPerCpu > 0 ? Math.max(0, Math.min(1, busyCores / coresPerCpu - socket)) : 0),
    online: modeName(h.mode[id]), timerS, timerTotalS: timerS === null ? null : ticksToS(state.research.unlocks.bootTicks),
    cpu: part(0, 'cpu', cpu0.gen, cpu0.level, cpuBusy),
    ram: (spec?.ram ?? []).map((m, i) => ({
      ...part(i, 'ram', m.gen, m.level, ramBusy, m.ecc),
      capacityBits: capacity(PARTS.ram, m.gen, m.level), rateBits: capacity2(PARTS.ram, m.gen, m.level),
    })),
    gpu: (spec?.accels ?? []).map((a, i) => acceleratorView(state, id, i, a)),
    storage: (spec?.drives ?? []).map((d, i) => ({
      ...part(i, 'drive', d.gen, d.level, ioBusy),
      capacityBits: capacity(PARTS.storage, d.gen, d.level), rateBits: capacity2(PARTS.storage, d.gen, d.level),
    })),
    psu: psuView(state, id, spec?.psu ?? { gen: 0, level: 1, capped: false }),
    running: runningTasks(state, id, Math.max(c.K[id] ?? 0, 1)),
    queue: { cap: c.Q[id] ?? 0, count: h.queueLen[id] ?? 0, sample: queuedTasks(state, id, 0, QUEUE_SAMPLE) },
    reserved: h.reserved[id] ?? 0,
    rates: { ops: (c.threadRate[id] ?? 0) * threads, ramBits: c.ramBw[id] ?? 0, gpuOps: c.gpuOps[id] ?? 0, ioBits: c.ioRate[id] ?? 0 },
    capacities: { cache: c.cacheBits[id] ?? 0, ram: c.ramCap[id] ?? 0, vram: c.vram[id] ?? 0, storage: c.storageCap[id] ?? 0 },
    used: { memory: (h.usedCache[id] ?? 0) + (h.usedRam[id] ?? 0), vram: h.usedVram[id] ?? 0, storage: h.usedDisk[id] ?? 0 },
    memory: { tiers: memoryTiers(state, id) },
    drawW: h.drawW[id] ?? 0,
    saveable: state.research.unlocks.rules.includes('configSave'),
    slots: st.slots,
    inbound: inboundTransfer(state, id),
  };
}
