// The D10 queue as the strip and the "now" card show it: the five-task window (head first), the
// head's clock, blocked reasons, and the work moving down the pipe. Only published tasks.
import { FAMILIES, TICK_MS } from '../../game';
import type { FailCause, FailDetail, FamilyId, QueueEntryView, RenderSnapshot, TaskRef, TransferView } from '../../game';
import { wholeText } from './format';
import { taskBits } from './taskRequirements';

export const CAUSE_NAME: Readonly<Record<FailCause, string>> = {
  timeout: 'Timed out', cantRun: "Can't run", misroute: 'Misrouted', power: 'Power', heat: 'Heat', swap: 'Swap',
};
const DETAIL_WORD: Readonly<Partial<Record<FailDetail, string>>> = {
  ram: 'RAM', gpu: 'GPU', gpuCores: 'GPU cores', vram: 'VRAM', ecc: 'ECC', psu: 'PSU', pdu: 'PDU', ups: 'UPS', cold: 'Cold change',
};
export const detailName = (d: FailDetail): string => DETAIL_WORD[d] ?? d[0]!.toUpperCase() + d.slice(1);
export function causeText(cause: FailCause, detail: FailDetail | null): string {
  return detail ? `${CAUSE_NAME[cause]} · ${detailName(detail)}` : CAUSE_NAME[cause];
}
export function familyName(family: FamilyId): string { return FAMILIES[family]?.name ?? 'Task'; }
export const taskKey = (task: TaskRef): string => `${task.epoch}:${task.roundIndex}:${task.taskId}`;
/** The head may be taken through the end of `deadlineTick`. */
export const deadlineMs = (deadlineTick: number) => (deadlineTick + 1) * TICK_MS;

/** Transfer time at the current link speed (L2): "1 ms", "250 ms", "1.25 s", "12.5 s". */
export function transferText(s: number): string {
  return s < 0.1 ? `${Math.max(1, Math.round(s * 1000))} ms` : `${s.toFixed(s < 10 ? 2 : 1)} s`;
}

/** Payout: 1 Credit per op or bit of work (D2.2). */
export const payoutText = (task: Pick<QueueEntryView, 'work'>): string => `+${wholeText(task.work)}`;
/** "2 ops · 1 bit": the task's work and its working set. */
export function sizeText(task: Pick<QueueEntryView, 'work' | 'workingSetBits'>): string {
  return `${wholeText(task.work)} ${task.work === 1 ? 'op' : 'ops'} · ${taskBits(task.workingSetBits)}`;
}

export interface FeedView {
  readonly window: readonly QueueEntryView[];
  readonly head: QueueEntryView | null;
  /** Between rounds the window is the next round's, taken after Return. */
  readonly running: boolean;
  readonly headDeadlineTick: number | null;
  readonly transfer: TransferView | null;
}

/** The strip's view of the feed. The head is the window's first entry. */
export function feedView(snapshot: RenderSnapshot): FeedView {
  const f = snapshot.feed;
  return { window: f.window, head: f.window[0] ?? null, running: f.timing === 'running',
    headDeadlineTick: f.headDeadlineTick, transfer: f.transfers[0] ?? null };
}
