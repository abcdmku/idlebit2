// The D10 queue as the strip and the "now" card show it: the five-task window (head first), the
// head's clock, blocked reasons, and the work moving down the pipe. Only published tasks.
import { FAMILIES, formatOps, TICK_MS } from '../../game';
import type { FailCause, FailDetail, FamilyId, QueueEntryView, TaskRef } from '../../game';
import { OUTAGE_TEXT, taskBits } from './taskRequirements';

export const CAUSE_NAME: Readonly<Record<FailCause, string>> = {
  timeout: 'Timed out', cantRun: "Can't run", misroute: 'Misrouted', swap: 'Interrupted', late: 'Late',
};
const DETAIL_WORD: Readonly<Partial<Record<FailDetail, string>>> = {
  ram: 'RAM', gpu: 'GPU', gpuCores: 'GPU cores', vram: 'VRAM', ecc: 'ECC', cold: 'hardware change', offline: 'taken offline',
  members: 'too few servers', zones: 'too few zones', region: 'wrong region',
};
export const detailName = (d: FailDetail): string => DETAIL_WORD[d] ?? d[0]!.toUpperCase() + d.slice(1);
export function familyName(family: FamilyId): string { return FAMILIES[family]?.name ?? 'Task'; }
export const taskKey = (task: TaskRef): string => `${task.epoch}:${task.roundIndex}:${task.taskId}`;
/** The head may be taken through the end of `deadlineTick`. */
export const deadlineMs = (deadlineTick: number) => (deadlineTick + 1) * TICK_MS;

/** Transfer time at the current link speed (Control deck): "1 ms", "250 ms", "1.3 s", "12.5 s". */
export function transferText(s: number): string {
  return s < 0.1 ? `${Math.max(1, Math.round(s * 1000))} ms` : `${s.toFixed(1)} s`;
}

/** "2 ops · 1 bit": the task's work and its working set. */
export function sizeText(task: Pick<QueueEntryView, 'work' | 'workingSetBits'>): string {
  return `${formatOps(task.work)} · ${taskBits(task.workingSetBits)}`;
}

/** "Can't run · cache", "Can't run · RAM": the cause with its detail word in running text (A02, A11). */
export function causeLine(cause: FailCause, detail: FailDetail | null): string {
  if (!detail) return CAUSE_NAME[cause];
  // An outage reads as what is down, the same words as the task's status.
  const outage = OUTAGE_TEXT[detail];
  if (outage && !(cause === 'swap' && detail === 'offline')) return outage;
  const word = detailName(detail);
  return `${CAUSE_NAME[cause]} · ${/^[A-Z][a-z]/.test(word) ? word.toLowerCase() : word}`;
}
