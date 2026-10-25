import type { QueueEntryView, TaskRequirementsView } from '../../game';
import { formatOps, formatSize } from '../../game';

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
  if (task.members > 1) facts.push(`${task.members} systems`);
  if (task.minZones > 1) facts.push(`${task.minZones} zones`);
  if (task.region !== null) facts.push(`Region ${task.region}`);
  if (task.ecc) facts.push('ECC');
  if (task.tensor) facts.push('Tensor');
  return facts.join(' · ');
}

export function blockedText(task: QueueEntryView): string | null {
  switch (task.blockedBy) {
    case null: return null;
    case 'cache': return `Needs ${taskBits(task.workingSetBits)} cache`;
    // The detail names the deepest tier the system has (D26.1): cache only, RAM with no drive, or the whole hierarchy.
    case 'ram': return `Needs ${taskBits(task.workingSetBits)} memory · add RAM`;
    case 'disk': return `Needs ${taskBits(task.workingSetBits)} memory`;
    case 'vram': return `Needs ${taskBits(task.vramBits)} VRAM`;
    case 'gpuCores': return `Needs ${task.gpuCoresMin} GPU cores`;
    case 'gpu': return task.tensor ? 'Needs tensor compute' : 'Needs GPU compute';
    case 'members': return `Needs ${task.members} systems`;
    case 'zones': return `Needs ${task.minZones} zones`;
    case 'region': return `Needs region ${task.region}`;
    case 'ecc': return 'Needs ECC';
    default: return `Needs ${task.blockedBy}`;
  }
}
