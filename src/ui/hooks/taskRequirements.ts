import type { FailDetail, QueueEntryView, TaskRequirementsView } from '../../game';
import { formatOps, formatSize, regionName } from '../../game';
import type { TaskWaitReason } from '../../game';

/** Sizes print through the shared formatter: "2 b", "21.4 kb" (one string everywhere). */
export const taskBits = (n: number): string => formatSize(n);

export function accelRequirements(task: Pick<TaskRequirementsView, 'gpuCoresMin' | 'vramBits'>): string {
  const needs: string[] = [];
  if (task.gpuCoresMin > 0) needs.push(`${task.gpuCoresMin.toLocaleString('en-US')} GPU cores`);
  if (task.vramBits > 0) needs.push(`${taskBits(task.vramBits)} VRAM`);
  return needs.join(' · ');
}

/** One formatter for numerical simulation facts, wherever the task is shown. */
export function requirementText(task: TaskRequirementsView): string {
  // D26: compute and GPU stages are ops; a mem stage is bits touched, wherever they sit.
  const facts = task.stages.map(stage => stage.resource === 'mem' ? `Traffic ${formatSize(stage.work)}`
    : `${stage.resource === 'gpu' ? 'GPU' : 'CPU'} ${formatOps(stage.work)}`);
  // The working set fills cache, then RAM, then disk (D26.1): one memory need, never "storage".
  if (task.workingSetBits > 0) facts.push(`Memory ${formatSize(task.workingSetBits)}`);
  const accel = accelRequirements(task);
  if (accel) facts.push(accel);
  // D25.6: a distributed task's minimum split, worded as what it needs (lead: no grain on cards).
  if (task.members > 1) facts.push(`${task.members} servers`);
  if (task.minZones > 1) facts.push(`${task.minZones} zones`);
  if (task.region !== null) facts.push(regionName(task.region));
  if (task.ecc) facts.push('ECC');
  if (task.tensor) facts.push('Tensor');
  return facts.join(' · ');
}

/**
 * No system can take work because something upstream is down (lead, 26 Oct). One label per detail, in the
 * task status, the head card, the report and the platform line alike.
 */
export const OUTAGE_TEXT: Readonly<Partial<Record<FailDetail, string>>> = {
  psu: 'Power supply down', pdu: 'PDU down', ups: 'UPS down', grid: 'Grid down',
  rack: 'Rack overheated', room: 'Zone overheated', offline: 'No server online',
};

const WAIT_TEXT: Readonly<Record<TaskWaitReason, string>> = {
  round: 'Next round', head: 'Waiting for earlier tasks', research: 'Waiting for CPU cores used by research',
  cores: 'Waiting for a free CPU core', queue: 'Task queue full', routerQueue: 'Routing queue full',
  transfer: 'Waiting for an input transfer', restart: 'Waiting for CPU restart', wake: 'Waiting for a server to wake',
  link: 'Needs a connected input link', routing: 'Waiting for routing', pickup: 'Awaiting pickup',
};
const WAIT_SHORT: Readonly<Record<TaskWaitReason, string>> = {
  round: 'next', head: 'in line', research: 'CPU researching', cores: 'CPU cores busy', queue: 'queue full',
  routerQueue: 'router full', transfer: 'transferring', restart: 'restarting', wake: 'waking', link: 'no link',
  routing: 'routing', pickup: 'pickup pending',
};
export const waitingText = (task: QueueEntryView): string => WAIT_TEXT[task.waitingFor ?? 'pickup'];
const WAIT_TINY: Readonly<Record<TaskWaitReason, string>> = {
  round: 'next', head: 'in line', research: 'research', cores: 'CPU busy', queue: 'queue', routerQueue: 'router',
  transfer: 'input', restart: 'restart', wake: 'waking', link: 'no link', routing: 'routing', pickup: 'pending',
};
export const waitingShort = (task: QueueEntryView, tiny = false): string => (tiny ? WAIT_TINY : WAIT_SHORT)[task.waitingFor ?? 'pickup'];

export function blockedText(task: QueueEntryView): string | null {
  switch (task.blockedBy) {
    case null: return null;
    case 'cache': return `Needs ${taskBits(task.workingSetBits)} cache`;
    // The detail names the deepest tier the system has (D26.1): cache only, RAM with no drive, or the whole hierarchy.
    case 'ram': return `Needs ${taskBits(task.workingSetBits)} memory`;
    case 'disk': return `Needs ${taskBits(task.workingSetBits)} memory`;
    case 'vram': return `Needs ${taskBits(task.vramBits)} VRAM`;
    case 'gpuCores': return `Needs ${task.gpuCoresMin} GPU cores`;
    case 'gpu': return task.tensor ? 'Needs tensor compute' : 'Needs GPU compute';
    case 'members': return `Needs ${task.members} servers`;
    case 'zones': return `Needs ${task.minZones} zones`;
    case 'region': return `Needs ${regionName(task.region ?? '')}`;
    case 'ecc': return 'Needs ECC';
    default: return OUTAGE_TEXT[task.blockedBy] ?? `Needs ${task.blockedBy}`;
  }
}
