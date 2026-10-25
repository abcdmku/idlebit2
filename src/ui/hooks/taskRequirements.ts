import type { QueueEntryView, TaskRequirementsView } from '../../game';
import { bits, quantity } from '../plates/format';

/** Small memory requirements retain their published value, including fractions. */
export const taskBits = (n: number): string => n < 10_000 ? `${n} ${n === 1 ? 'bit' : 'bits'}` : bits(n);

export function accelRequirements(task: Pick<TaskRequirementsView, 'gpuCoresMin' | 'vramBits'>): string {
  const needs: string[] = [];
  if (task.gpuCoresMin > 0) needs.push(`${task.gpuCoresMin.toLocaleString('en-US')} GPU cores`);
  if (task.vramBits > 0) needs.push(`${taskBits(task.vramBits)} VRAM`);
  return needs.join(' · ');
}

/** One formatter for numerical simulation facts, wherever the task is shown. */
export function requirementText(task: TaskRequirementsView): string {
  const facts = task.stages.map(stage => `${stage.resource === 'io' ? 'IO' : stage.resource.toUpperCase()} ${quantity(stage.work, stage.resource === 'cpu' || stage.resource === 'gpu' ? 'ops' : 'bits')}`);
  if (task.workingSetBits > 0) facts.push(`${taskBits(task.workingSetBits)} cache / RAM`);
  if (task.stages.some(s => s.resource === 'cpu')) facts.push(`${task.threads} ${task.threads === 1 ? 'thread' : 'threads'} max`);
  const accel = accelRequirements(task);
  if (accel) facts.push(accel);
  if (task.storageBits > 0) facts.push(`${taskBits(task.storageBits)} storage`);
  if (task.members > 1) facts.push(`${task.members} members, per-member work`);
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
    case 'ram': return `Needs RAM, ${taskBits(task.workingSetBits)} working set`;
    case 'vram': return `Needs ${taskBits(task.vramBits)} VRAM`;
    case 'gpuCores': return `Needs ${task.gpuCoresMin} GPU cores`;
    case 'gpu': return task.tensor ? 'Needs tensor compute' : 'Needs GPU compute';
    case 'storage': return `Needs storage, ${taskBits(task.storageBits)} capacity`;
    case 'members': case 'gang': return `Needs ${task.members} members`;
    case 'zones': return `Needs ${task.minZones} zones`;
    case 'region': return `Needs region ${task.region}`;
    case 'ecc': return 'Needs ECC';
    default: return `Needs ${task.blockedBy}`;
  }
}
