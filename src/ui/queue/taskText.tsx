// What a task says, shared by the queue strip and the head card: its icon, short needs, the head's
// clocks (take, completion window, auto return) and its tooltip. One wording everywhere.
import type { QueueEntryView, RenderSnapshot } from '../../game';
import { TICK_MS } from '../../game';
import { ArtCanvas } from '../art/ArtCanvas';
import { drawTaskIcon } from '../art/deckArt';
import { clockTone, useHeadSeconds, useWindowLeft, windowText } from '../hooks/headClock';
import { familyName, sizeText, transferText } from '../hooks/feedModel';
import { clockText } from '../hooks/format';
import { blockedText, taskBits } from '../hooks/taskRequirements';
import { shallowEqual, useGameSelector } from '../storeHooks';
import { restartKey, restartOf } from './restart';

export function TaskIcon({ task, n }: { task: QueueEntryView; n: number }) {
  return <ArtCanvas w={16} h={16} n={n} artKey={String(task.family)} draw={g => drawTaskIcon(g, task.family)} />;
}

/** Whether a line of body text fits w px (Chakra Petch averages about 0.52 em a character, bold names included). */
export const fits = (text: string, w: number, body: number): boolean => text.length * body * 0.52 <= w;

/** A transfer time on a narrow card: "2.3 s", "12 s"; wider cards say "lands 2.34 s". */
export const shortSeconds = (s: number): string => (s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`);

/** What a blocked task is missing, short: "2 b", "tensor", "8 systems"; `tiny` for the phone's 48 px cards. */
export function needShort(task: QueueEntryView, tiny = false): string {
  switch (task.blockedBy) {
    case 'cache': case 'ram': case 'disk': return taskBits(task.workingSetBits);
    case 'vram': return tiny ? taskBits(task.vramBits) : `${taskBits(task.vramBits)} VRAM`;
    case 'gpu': return tiny ? 'GPU' : task.tensor ? 'tensor' : 'GPU';
    case 'gpuCores': return tiny ? 'GPU' : `${task.gpuCoresMin} cores`;
    case 'members': return tiny ? `${task.members} sys` : `${task.members} systems`;
    case 'zones': return `${task.minZones} zones`;
    default: return (blockedText(task) ?? '').replace(/^Needs /, '');
  }
}

export function taskTitle(task: QueueEntryView): string {
  const blocked = blockedText(task);
  return `${familyName(task.family)}: ${sizeText(task)}${task.transferS === null ? '' : `, lands in ${transferText(task.transferS)}`}${blocked ? `. ${blocked}` : ''}`;
}

export const roundOf = (s: RenderSnapshot) => ({ phase: s.round.state, can: s.round.canReturn, auto: s.round.autoReturn.inMs });

/** The head's take clock; `risk` when its failure alone would end the round (A12); `short` for the strip. */
export function HeadClock({ blocked, risk, short = false, testId = 'head-clock' }: { blocked: boolean; risk: boolean; short?: boolean; testId?: string }) {
  const seconds = useHeadSeconds() ?? 10;
  const text = short ? (blocked ? 'blocked' : `${seconds} s`)
    : risk ? `${seconds} s · a fail ends the round` : blocked ? `Blocked · ${seconds} s` : `${seconds} s to take`;
  return <span className={risk && !short ? 'bad' : blocked ? 'warn' : clockTone(seconds)} data-testid={testId}>{text}</span>;
}

/**
 * A taken task back at the front of the line (returned after a restart or a lost shard): it has no take
 * clock. It reads "Taken · waiting for the CPU" (a system, once Rack is open), or "Waiting · CPU
 * restarting 7 s" while the system restarts, plus its completion window when it has one (D26.5).
 * It is never "in LB queue": router-queue entries live in the load balancer, not in the strip.
 */
export function InQueue({ task, short = false, testId = 'head-clock' }: { task: QueueEntryView; short?: boolean; testId?: string }) {
  const left = useWindowLeft(task.windowEndTick);
  const r = useGameSelector(restartOf, (a, b) => restartKey(a) === restartKey(b), 250);
  const rack = useGameSelector(s => s.unlocked.rack);
  const low = left !== null && task.deadline !== null && left * 1000 <= task.deadline * TICK_MS / 4;
  if (short) {
    const text = r.on ? 'restarting' : left !== null ? `${clockText(left * 1000)} left` : 'taken';
    return <span className={r.on || low ? 'warn' : 'cyan'} data-testid={testId}>{text}</span>;
  }
  const head = r.on ? `Waiting · CPU restarting${r.seconds === null ? '' : ` ${r.seconds} s`}` : `Taken · waiting for ${rack ? 'a system' : 'the CPU'}`;
  return <span className={r.on || low ? 'warn' : 'cyan'} data-testid={testId}>{head}{left !== null ? ` · ${clockText(left * 1000)} left` : ''}</span>;
}

/** Between rounds the queue is frozen until Return (spec §4.1.5). */
export function AutoReturn({ testId = 'head-clock' }: { testId?: string }) {
  const r = useGameSelector(roundOf, shallowEqual, 250);
  return r.auto !== null ? <span className="dim" data-testid={testId}>Auto return in {clockText(r.auto)}</span> : null;
}

export { windowText };
