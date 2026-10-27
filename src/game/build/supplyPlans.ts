import type { PartRef } from '../types/ids';
import type { GameAction } from '../types/actions';
import type { GameState } from '../types/state';
import { capacity, PARTS } from './catalog';
import { maxLevel } from './locks';
import { readPart } from './partAccess';
import { planReplace, planUpgradeTo } from './partPlans';
import type { Plan } from './plan';

/** Existing levels, sized to the requested load in one quote, with the same summed level prices. */
export function supplyPlans(state: GameState, part: PartRef, minimumCapacity: number): { action: GameAction; plan: Plan }[] {
  const p = readPart(state.build, part);
  if (!p || (p.id !== 'psu' && p.id !== 'pdu' && p.id !== 'ups') || !Number.isFinite(minimumCapacity) || minimumCapacity <= 0) return [];
  const row = PARTS[p.id];
  const need = Math.max(minimumCapacity, capacity(row, p.gen, p.level));
  const out: { action: GameAction; plan: Plan }[] = [];
  for (let generation = p.gen; generation < row.base.length; generation += 1) {
    if (generation === p.gen) {
      let level = p.level + 1, top = maxLevel(state.research.unlocks, p.id, generation);
      while (level <= top && capacity(row, generation, level) < need) level += 1;
      if (level <= top) out.push({ action: { type: 'upgradePartTo', part, level }, plan: planUpgradeTo(state, part, level) });
    } else out.push({ action: { type: 'replacePart', part, generation, preserveCapacity: true, minimumCapacity: need },
      plan: planReplace(state, part, generation, true, need) });
  }
  return out;
}
