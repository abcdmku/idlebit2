import type { Quote, ResearchId } from '../../game';
import { bitRate, bits, measureUnit, ops } from './format';

/** The component's resulting stats, kept within the existing two-line buy key. */
export function purchaseGain(q: Quote): string {
  const gpu = q.gpu?.after;
  if (gpu) return `${ops(gpu.opsPerS)}/s · ${bits(gpu.vramBits)} VRAM`;
  const e = q.effect;
  if (!e) {
    const a = q.action;
    return a.type === 'replacePart' && (a.part.slot.kind === 'roomStart' || a.part.slot.kind === 'globalStart')
      ? a.generation > 0 ? 'Head wait + busy triggers' : 'Head wait trigger' : '';
  }
  const before = measureUnit(e.capacityBefore, e.unit), after = measureUnit(e.capacityAfter, e.unit);
  let gain = before === after ? after : `${before} → ${after}`;
  if (e.capacityLabel) gain = `${e.capacityLabel} ${gain}`;
  if (e.throughputAfter !== undefined) gain += ` · ${bitRate(e.throughputAfter)}${e.throughputBefore !== undefined && e.throughputAfter < e.throughputBefore ? ' ↓' : ''}`;
  if (e.lossPctAfter !== undefined && before === after) gain = `${Math.round(e.lossPctBefore ?? 0)}% → ${Math.round(e.lossPctAfter)}% loss`;
  return gain;
}

export function purchaseReason(q: Quote, researchName?: (id: ResearchId) => string): string | null {
  if (q.overSupply || q.locked?.code === 'power') return 'No available power';
  const lock = q.locked;
  if (lock?.code === 'research' && lock.node) return `Needs ${researchName?.(lock.node) ?? lock.text.replace(/^Needs /, '')}`;
  if (lock) return lock.text === 'Max' ? 'Max level' : lock.text;
  return q.affordable ? null : 'Not enough Credits';
}
