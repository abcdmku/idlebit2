// Snapshot-only QA scenes for the CPU: boot, a 1,000-op task landing on the pipe, a two-core chip
// with a queue, a 32-core chip, and paused. No mockup simulation is imported.
import { familyId, systemId } from '../../../game';
import type { ChipSnapshot, CoreView, TransferView } from '../../../game';

export type CpuScene = 'boot' | 'landing' | 'mid' | 'max' | 'paused';
export const CPU_SCENES: readonly CpuScene[] = ['boot', 'landing', 'mid', 'max', 'paused'];
let next = 383;
const core = (busy: boolean, progress: number, research = 0): CoreView => ({
  socket: 0, lanes: 1, generation: 0, level: 1, busy: busy ? 1 : 0, family: busy ? 2 : null, taskId: busy ? next++ : null,
  progress, threads: 1, research, cstate: 0,
});
export function chipScene(scene: CpuScene, simTimeMs = 2000): ChipSnapshot {
  next = 383;
  const max = scene === 'max', boot = scene === 'boot' || scene === 'landing';
  const transfer: TransferView | null = scene === 'landing' || scene === 'mid'
    ? { taskId: 384, family: familyId(4), systemId: systemId(0), link: 'pipe', bitsSent: 600, bits: 1000, speed: 1000 } : null;
  const cores = boot ? [core(false, 0)] : max ? Array.from({ length: 32 }, (_, i) => core(i % 3 !== 0, (i % 7) / 7, i % 3 === 0 ? 0.4 : 0))
    : [core(true, 0.62), core(scene !== 'paused', 0.25)];
  const hz = max ? 4e9 : 1024, bits = max ? 2 ** 28 : 64;
  void simTimeMs;
  return {
    level: 'chip', parent: { level: 'system', id: systemId(0) }, systemId: systemId(0), cpuCount: 1, online: 'onMarket', tier: 0,
    clock: { hz, effectiveHz: hz, generation: max ? 3 : 1, level: 1 },
    coreSites: max ? 32 : boot ? 1 : 2, cores, researchShare: 0.1,
    pipe: { speed: 1000, transfer, waiting: scene === 'landing' },
    cache: { capacityBits: bits, usedBits: boot ? 0 : max ? 2 ** 26 : 48, levels: [{ kind: 'l1', bits, generation: 0, level: 1 }] },
    queue: boot ? [] : Array.from({ length: max ? 20 : 2 }, (_, i) => ({ taskId: 400 + i, family: familyId([4, 0, 1, 3][i % 4]!) })),
    scheduler: boot ? null : { generation: 0, level: 1, strategy: 'fifo', q: max ? 32 : 4, k: 2, queued: max ? 20 : 2, running: 2, reserved: 0 },
    slots: boot ? [{ kind: 'core', index: 1, locked: true }, { kind: 'scheduler', index: 0, locked: true }] : [],
    psu: { kind: 'psu', generation: 0, level: 1, capacityW: 64, deliveredW: 0.65, usage: 0.01, overloadS: 0, failed: false,
      rebootMs: null, loss: 0.3, lossW: 0.2, capped: false, capFactor: 1, creditsPerMinute: 0.5 },
  };
}
