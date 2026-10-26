// Snapshot-only QA scenes for the CPU: boot, a 1,000-op task landing on the pipe, a two-core chip
// with a queue, a two-core chip running one shard on both cores (D25), a 32-core chip with shards
// on core pairs, and paused. No mockup simulation is imported.
import { familyId, systemId } from '../../../game';
import type { ChipSnapshot, CoreView, TransferView } from '../../../game';

export type CpuScene = 'boot' | 'landing' | 'mid' | 'shard' | 'max' | 'paused' | 'ring' | 'mesh' | 'c2' | 'c3' | 'c5' | 'c6' | 'c9' | 'c12' | 'c17';
export const CPU_SCENES: readonly CpuScene[] = ['boot', 'landing', 'mid', 'shard', 'max', 'paused', 'ring', 'mesh', 'c2', 'c3', 'c5', 'c6', 'c9', 'c12', 'c17'];
let next = 383;
interface Run { readonly taskId: number; readonly family: number; readonly shard: number; readonly threads: number }
const core = (busy: boolean, progress: number, research = 0, run: Run | null = null): CoreView => {
  const taskId = busy ? run?.taskId ?? next++ : null;
  return {
    socket: 0, generation: 0, level: 1, busy: busy ? 1 : 0, family: busy ? run?.family ?? 2 : null, taskId,
    progress, threads: 1, research, cstate: 0, shard: busy ? run?.shard ?? 0 : null, shardThreads: busy ? run?.threads ?? 1 : 0, rate: 0, hz: 0, sleep: null,
  };
};
/** One QA shard transfer on the pipe (all D25 fields set). */
export function sceneTransfer(o: Partial<TransferView> = {}): TransferView {
  return { taskId: 384, family: familyId(4), systemId: systemId(0), link: 'pipe', bitsSent: 600, bits: 1000, speed: 1000,
    shard: 0, shards: 1, units: 1000, from: null, to: { level: 'system', id: systemId(0) }, key: 1, ...o };
}
/** 32 cores: every core i with i % 3 ≠ 0 runs; cores 3p+1 and 3p+2 hold one 2-thread shard. */
function maxCores(): CoreView[] {
  return Array.from({ length: 32 }, (_, i) => {
    const p = Math.floor(i / 3), busy = i % 3 !== 0;
    const run: Run = { taskId: 600 + p, family: [2, 13, 17, 22, 15][p % 5]!, shard: p % 4, threads: 2 };
    return core(busy, ((p * 3) % 7) / 7 + 0.07, busy ? 0 : 0.4, run);
  });
}
export function chipScene(scene: CpuScene, simTimeMs = 2000): ChipSnapshot {
  next = 383;
  const max = scene === 'max', boot = scene === 'boot' || scene === 'landing';
  const transfer = scene === 'landing' || scene === 'mid' ? sceneTransfer() : null;
  // 'shard': a Parallel task's shard 2 of 4 runs on both cores, 40% done.
  const split: Run = { taskId: 500, family: 13, shard: 2, threads: 2 };
  // 'ring': ringBus, 12 sites with 9 cores; 'mesh': meshCores, 24 sites with 18 cores and the rest locked.
  const ring = scene === 'ring', mesh = scene === 'mesh', grid = ring ? 12 : mesh ? 24 : 0;
  // 'c<n>' (D34): Multi-core researched, n cores installed, the add site after them.
  const multi = /^c[0-9]+$/.test(scene) ? Number(scene.slice(1)) : 0;
  const cores = boot ? [core(false, 0)] : max ? maxCores() : multi ? maxCores().slice(0, multi) : grid ? Array.from({ length: ring ? 9 : 18 }, (_, i) => core(i % 3 !== 2, (i * 0.13) % 1))
    : scene === 'shard' ? [core(true, 0.4, 0, split), core(true, 0.4, 0, split)]
      : [core(true, 0.62), core(scene !== 'paused', 0.25)];
  const hz = max ? 4e9 : 1024, bits = max ? 2 ** 28 : 64;
  // A core's speed is the socket clock (D34: no lanes); a scene sets its rate the same way.
  for (let i = 0; i < cores.length; i++) cores[i] = { ...cores[i]!, rate: hz, hz };
  void simTimeMs;
  return {
    level: 'chip', parent: { level: 'system', id: systemId(0) }, systemId: systemId(0), cpuCount: 1, online: 'onMarket', tier: 0,
    clock: { hz, effectiveHz: hz, generation: max ? 3 : 1, level: 1 },
    coreSites: max || multi ? 32 : ring ? 10 : mesh ? 20 : boot ? 1 : 2, cores, researchShare: 0.1,
    pipe: { speed: 1000, transfer, waiting: scene === 'landing' },
    cache: { capacityBits: bits, usedBits: boot ? 0 : max ? 2 ** 26 : 48, spilledOutBits: 0, levels: [{ kind: 'l1', bits, generation: 0, level: 1 }] },
    queue: boot ? [] : Array.from({ length: max ? 20 : 2 }, (_, i) => ({ taskId: 400 + i, family: familyId([4, 0, 1, 3][i % 4]!) })),
    scheduler: boot ? null : { generation: 0, level: 1, strategy: 'fifo', q: max ? 32 : 4, k: 2, queued: max ? 20 : 2, running: 2, reserved: 0 },
    slots: boot ? [{ kind: 'core', index: 1, locked: true }, { kind: 'scheduler', index: 0, locked: true }]
      : grid ? Array.from({ length: grid - (ring ? 10 : 20) }, (_, i) => ({ kind: 'core' as const, index: (ring ? 10 : 20) + i, locked: true })) : [],
    psu: { kind: 'psu', generation: 0, level: 1, capacityW: 64, deliveredW: 0.65, usage: 0.01, overloadS: 0, failed: false,
      rebootMs: null, loss: 0.3, lossW: 0.2, capped: false, capFactor: 1, creditsPerMinute: 0.5 },
  };
}
