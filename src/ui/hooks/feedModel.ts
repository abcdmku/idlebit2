// The D10 queue as the strip and the "now" card show it: the five-task window (head first), the
// head's clock, blocked reasons, and the work moving down the pipe. Only published tasks.
import { FAMILIES, formatOps, TICK_MS } from '../../game';
import type { FailCause, FailDetail, FamilyId, QueueEntryView, RenderSnapshot, TaskRef, TransferView } from '../../game';
import { wholeText } from './format';
import { OUTAGE_TEXT, taskBits } from './taskRequirements';

export const CAUSE_NAME: Readonly<Record<FailCause, string>> = {
  timeout: 'Timed out', cantRun: "Can't run", misroute: 'Misrouted', power: 'Power', heat: 'Heat', swap: 'Swap', late: 'Late',
};
const DETAIL_WORD: Readonly<Partial<Record<FailDetail, string>>> = {
  ram: 'RAM', gpu: 'GPU', gpuCores: 'GPU cores', vram: 'VRAM', ecc: 'ECC', psu: 'Power supply', pdu: 'PDU', ups: 'UPS', cold: 'Cold change',
};
export const detailName = (d: FailDetail): string => DETAIL_WORD[d] ?? d[0]!.toUpperCase() + d.slice(1);
export function causeText(cause: FailCause, detail: FailDetail | null): string {
  const outage = detail ? OUTAGE_TEXT[detail] : undefined;
  if (outage) return outage;
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

/** Currency bands for the short form. */
const SHORT_BANDS: readonly (readonly [number, string])[] = [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
/**
 * The payout on a phone's narrow next-4 card: no decimals from 10 up ("+82k", "+117k"), one below
 * ("+1.2M"), so it always fits whole in 40 px. Everywhere else shows the full figure.
 */
export function payoutShort(task: Pick<QueueEntryView, 'work'>): string {
  const n = Math.round(task.work);
  if (n < 1000) return `+${n}`;
  for (let i = 0; i < SHORT_BANDS.length; i++) {
    const [scale, suffix] = SHORT_BANDS[i]!;
    if (n < scale) continue;
    const x = n / scale, text = x >= 10 ? String(Math.round(x)) : (Math.round(x * 10) / 10).toString();
    if (Number(text) >= 1000 && i > 0) return `+1${SHORT_BANDS[i - 1]![1]}`;
    return `+${text}${suffix}`;
  }
  return payoutText(task);
}
/** "2 ops · 1 bit": the task's work and its working set. */
export function sizeText(task: Pick<QueueEntryView, 'work' | 'workingSetBits'>): string {
  return `${formatOps(task.work)} · ${taskBits(task.workingSetBits)}`;
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

/** "Can't run · cache", "Can't run · RAM": the cause with its detail word in running text (A02, A11). */
export function causeLine(cause: FailCause, detail: FailDetail | null): string {
  if (!detail) return CAUSE_NAME[cause];
  // An outage reads as what is down ("Power supply down ×3"), the same words as the task's status.
  const outage = OUTAGE_TEXT[detail];
  if (outage) return outage;
  const word = detailName(detail);
  return `${CAUSE_NAME[cause]} · ${/^[A-Z][a-z]/.test(word) ? word.toLowerCase() : word}`;
}
