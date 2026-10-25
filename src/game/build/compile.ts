import type { CompiledBuffers } from '../core/buffers';
import { MAX_SCHED_K, MAX_SCHED_Q } from '../core/constants';
import type { BuildState, SystemBuild, SystemSpec } from '../types/build';
import { QUEUE_STRATEGY_IDS, RULE_IDS, type RuleId } from '../types/catalog';
import type { ResearchState, Unlocks } from '../types/state';
import { capacity, capacity2, lossFraction, PARTS, partWatts } from './catalog';
import { compileAccels } from './compileAccels';
import { compileInfra } from './compileInfra';
import { compileLinks } from './compileLinks';
import { hasRule, ruleParam } from './research/unlocks';

/*
 * build → compiled (architecture §1.3). core/topology writes the structural columns first; this
 * fills every other column. Column meanings, per system (spec §6.2, §9.1):
 *   threads      Σ cores × threadsPerCore             cores, sockets   counts
 *   threadRate   mean core rate at clockFactor 1, e = 1: Σ(lanes × clockHz of its socket) / cores
 *   clockHz      socket 1's clock                     K, Q             scheduler (1, 0 without one)
 *   keff         timeSlice 2K; dma K; else min(K, threads)            slots = keff + Q
 *   cacheBits    Σ sockets L1 + L2 + L3               ramCap           Σ RAM modules
 *   memCap       the hierarchy (D26.1): cache + RAM + drives + the rack storage node's drives (diskNode)
 *   ramBw        channels × bw when every module matches (multiChannel), else the lowest module
 *   gpuOps/tensorOps/vram  GPU-only diagnostics; paired physical columns own eligibility.
 *   npu          Physical NPU count.
 *   storageCap, ioRate   Σ own drives: the disk tier;  ioConc 1, or ncq's `concurrent`
 *   diskNode     with sharedStorage, the rack's first storage node (its drives extend every server's disk tier), else -1
 *   idleW/loadW  per resource at full use (§9.1 post-D5), rule factors applied (ecc, ramWatts, HBM watts);
 *                [cpu] is the uncore only: package, caches, scheduler (idle only). coreIdleW/coreLoadW are
 *                the cores (rate parts: lanes × clock); clocks are idle-only, so clockLoadW is 0.
 *   psuLoss      final loss fraction (lossPerLevel folded in);  psuCapSwitch = capped and powerCap
 *   rules        bit i = RULE_IDS[i] (i < 32) granted; dvfs and turbo also need the system switch,
 *                coreIdle needs a C-state limit above 0.
 *   board        0 general, 1 accelerator;  etaCfg   η_cfg (D7.5), see configEfficiency
 * Every CPU of a system is the same design (D7.3): CPU-side sums are one CPU × cpuCount.
 * Storage nodes have no CPU: threads, K and slots are 0.
 */
export const compileUnits = (compiled: CompiledBuffers, build: BuildState, research: ResearchState): void => {
  const u = research.unlocks;
  for (const sys of build.systems) if (sys) compileSystem(compiled, sys, u);
  compileStorageNodes(compiled, build, u);
  compileInfra(compiled, build, u);
  compileLinks(compiled, build, u);
};

const SETTING_RULES: readonly RuleId[] = ['dvfs', 'turbo', 'coreIdle'];

/** D7.5 starting values; quadSocket / quadChannel rule params may override (s2–s4, d3, d4). */
const SOCKET_FACTOR = [1, 1, 0.92, 0.85, 0.78];
const DIMM_FACTOR = [1, 1, 1, 0.95, 0.9];

/** Configuration efficiency η_cfg = socketFactor(CPUs) × dimmFactor(RAM modules); the accelerator board has no DIMM penalty (D7.5, D7.6). */
export function configEfficiency(spec: SystemSpec, u: Unlocks): number {
  const n = Math.min(4, Math.max(1, spec.cpuCount));
  const m = spec.ram.length;
  const socket = n === 1 ? 1 : ruleParam(u, 'socketFactor' as RuleId, `s${n}`, SOCKET_FACTOR[n]!);
  const dimm = spec.board === 'accelerator' || m <= 2 ? 1 : ruleParam(u, 'dimmFactor' as RuleId, `d${Math.min(4, m)}`, DIMM_FACTOR[Math.min(4, m)]!);
  return socket * dimm;
}

function ruleMask(sys: SystemSpec, u: Unlocks): number {
  let mask = 0;
  for (let i = 0; i < 32 && i < RULE_IDS.length; i += 1) {
    const id = RULE_IDS[i]!;
    if (!u.rules.includes(id)) continue;
    if (SETTING_RULES.includes(id)) {
      const on = id === 'dvfs' ? sys.settings.dvfs : id === 'turbo' ? sys.settings.turbo : sys.settings.cStateLimit > 0;
      if (!on) continue;
    }
    mask |= 1 << i;
  }
  return mask >>> 0;
}

export function compileSystem(c: CompiledBuffers, build: SystemBuild, u: Unlocks): void {
  const s = c.sys;
  const i = build.id;
  const sys = build.spec;
  const R = 4;
  const n = sys.cpu ? sys.cpuCount : 0;
  let cores = 0, rateSum = 0, cache = 0, coreIdle = 0, coreLoad = 0, clockIdle = 0, uncoreIdle = 0;
  s.clockHz[i] = 0;
  s.board[i] = sys.board === 'accelerator' ? 1 : 0;
  s.etaCfg[i] = configEfficiency(sys, u);
  for (let k = 0; k < n; k += 1) {
    const socket = sys.cpu!;
    const hz = capacity(PARTS.clock, socket.clock.gen, socket.clock.level);
    s.clockHz[i] = hz;
    clockIdle += partWatts(PARTS.clock, socket.clock.gen, socket.clock.level).idle;
    uncoreIdle += partWatts(PARTS.cpu, socket.cpu.gen, 1).idle;
    for (const core of socket.cores) {
      cores += 1;
      const rate = capacity(PARTS.core, core.gen, core.level) * hz;
      rateSum += rate;
      const w = partWatts(PARTS.core, core.gen, core.level, { rate, native: PARTS.core.base[core.gen]! * PARTS.clock.base[core.gen]! });
      coreIdle += w.idle;
      coreLoad += w.load;
    }
    for (const [row, part] of [[PARTS.l1, socket.l1], [PARTS.l2, socket.l2], [PARTS.l3, socket.l3]] as const) {
      if (!part) continue;
      cache += capacity(row, part.gen, part.level);
      uncoreIdle += partWatts(row, part.gen, part.level).idle;
    }
  }
  const threads = cores * u.ceilings.threadsPerCore;
  s.cores[i] = cores; s.sockets[i] = n; s.threads[i] = threads;
  s.threadRate[i] = cores > 0 ? rateSum / cores : 0;
  s.cacheBits[i] = cache;
  s.coreIdleW[i] = coreIdle; s.coreLoadW[i] = coreLoad; s.clockIdleW[i] = clockIdle; s.clockLoadW[i] = 0;

  const sched = sys.scheduler;
  const server = sys.kind === 'server';
  const K = !server ? 0 : sched ? Math.min(MAX_SCHED_K, capacity(PARTS.scheduler, sched.gen, sched.level)) : 1;
  const Q = sched ? Math.min(MAX_SCHED_Q, capacity2(PARTS.scheduler, sched.gen, sched.level)) : 0;
  const strategy = sched?.strategy ?? 'fifo';
  const keff = !server ? 0 : strategy === 'timeSlice' && sched ? 2 * K : hasRule(u, 'dma') ? K : Math.min(K, threads);
  s.K[i] = K; s.Q[i] = server ? Q : 0; s.keff[i] = keff; s.slots[i] = server ? keff + Q : 0;
  s.strategy[i] = QUEUE_STRATEGY_IDS.indexOf(strategy);
  if (sched) {
    uncoreIdle += partWatts(PARTS.scheduler, sched.gen, sched.level).idle;
  }

  // RAM
  let mem = 0, minBw = Infinity, ramIdle = 0, ramLoad = 0;
  const ramFactor = hasRule(u, 'ramWatts') ? ruleParam(u, 'ramWatts', 'factor', 0.7) : 1;
  const eccWatts = ruleParam(u, 'ecc', 'watts', 1.1);
  const first = sys.ram[0];
  let uniform = true;
  for (const m of sys.ram) {
    mem += capacity(PARTS.ram, m.gen, m.level);
    minBw = Math.min(minBw, capacity2(PARTS.ram, m.gen, m.level));
    if (m.gen !== first!.gen || m.level !== first!.level) uniform = false;
    const f = ramFactor * (m.ecc ? eccWatts : 1);
    const w = partWatts(PARTS.ram, m.gen, m.level);
    ramIdle += w.idle * f;
    ramLoad += w.load * f;
  }
  const nRam = sys.ram.length;
  s.hasRam[i] = nRam > 0 ? 1 : 0;
  s.ramCap[i] = mem;
  s.ramBw[i] = nRam === 0 ? 0 : uniform && hasRule(u, 'multiChannel') ? nRam * minBw : minBw;
  s.ecc[i] = nRam > 0 && sys.ram.every((m) => m.ecc) ? 1 : 0;

  const gpuWatts = compileAccels(c, build, u);

  // Storage
  let store = 0, io = 0, ioIdle = 0, ioLoad = 0;
  for (const d of sys.drives) {
    store += capacity(PARTS.storage, d.gen, d.level);
    io += capacity2(PARTS.storage, d.gen, d.level);
    const w = partWatts(PARTS.storage, d.gen, d.level);
    ioIdle += w.idle;
    ioLoad += w.load;
  }
  s.storageCap[i] = store; s.ioRate[i] = io;
  s.memCap[i] = cache + mem + store;
  s.diskNode[i] = -1;
  s.unifiedBits[i] = hasRule(u, 'unifiedMemory') ? mem + store : 0;
  s.ioConc[i] = hasRule(u, 'ncq') ? ruleParam(u, 'ncq', 'concurrent', 4) : 1;

  const watts = [[uncoreIdle, 0], [ramIdle, ramLoad], [gpuWatts.idle, gpuWatts.load], [ioIdle, ioLoad]] as const;
  for (let r = 0; r < R; r += 1) { s.idleW[i * R + r] = watts[r]![0]; s.loadW[i * R + r] = watts[r]![1]; }

  s.psuCapW[i] = capacity(PARTS.psu, sys.psu.gen, sys.psu.level);
  s.psuLoss[i] = lossFraction(PARTS.psu, sys.psu.gen, sys.psu.level);
  s.psuCapSwitch[i] = sys.psu.capped && hasRule(u, 'powerCap') ? 1 : 0;
  s.rules[i] = ruleMask(sys, u);
}

/**
 * D26.1, spec §6.10: with sharedStorage, a rack's storage node is a disk tier shared by its servers. Each
 * server records the rack's first storage node, and its hierarchy (memCap) counts the node's drives.
 */
function compileStorageNodes(c: CompiledBuffers, build: BuildState, u: Unlocks): void {
  if (!hasRule(u, 'sharedStorage')) return;
  const node = new Map<number, number>();
  for (const sys of build.systems) if (sys && sys.spec.kind === 'storageNode' && !node.has(sys.rack)) node.set(sys.rack, sys.id);
  if (node.size === 0) return;
  const s = c.sys;
  for (const sys of build.systems) {
    if (!sys || sys.spec.kind !== 'server') continue;
    const n = node.get(sys.rack);
    if (n === undefined) continue;
    s.diskNode[sys.id] = n;
    s.memCap[sys.id] = s.memCap[sys.id]! + s.storageCap[n]!;
    if (s.unifiedBits[sys.id]! > 0) s.unifiedBits[sys.id] = s.unifiedBits[sys.id]! + s.storageCap[n]!;
  }
}
