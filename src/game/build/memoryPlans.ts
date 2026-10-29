import type { MemoryUpgrade } from '../types/build';
import type { PartRef } from '../types/ids';
import type { GameState } from '../types/state';
import { ECC_PRICE_FACTOR, partName, PARTS, scalePrice } from './catalog';
import { levelLock } from './locks';
import { memorySteps } from './memory';
import { withSpec } from './partAccess';
import { fail, locked, planned, type Plan } from './plan';

/** A hot purchase changes only the selected capacity or speed track. */
export function planMemoryUpgrade(state: GameState, ref: PartRef, axis: MemoryUpgrade, target?: number): Plan {
  const { unit, slot } = ref;
  if (unit.kind !== 'system' || (slot.kind !== 'ram' && slot.kind !== 'drive')) return fail('invalid', 'Not RAM or storage');
  const spec = state.build.systems[unit.id]?.spec;
  const part = slot.kind === 'ram' ? spec?.ram[slot.index] : spec?.drives[slot.index];
  if (!spec || !part) return fail('invalid', 'No such part');
  if (axis !== 'capacity' && axis !== 'speed') return fail('invalid', 'Unknown upgrade');
  const id = slot.kind === 'ram' ? 'ram' : 'storage', row = PARTS[id];
  const current = axis === 'speed' ? part.speedLevel : part.level, level = target ?? current + 1;
  const label = `${partName(id, part.gen)} · ${axis === 'capacity' ? 'Space' : 'Speed'} L${level}`;
  if (!Number.isSafeInteger(level) || level <= current) return fail('invalid', 'Already at that level', label);
  const ecc = 'ecc' in part && part.ecc === true;
  // Check the ceiling before summing so an invalid client target cannot create an unbounded loop.
  const lock = levelLock(state.research.unlocks, id, part.gen, level, ecc);
  const price = scalePrice(memorySteps(row, part.gen, current, lock ? current + 1 : level), ecc ? ECC_PRICE_FACTOR : 1);
  if (lock) return locked(lock, label, price);
  const next = { ...part, ...(axis === 'speed' ? { speedLevel: level } : { level }) };
  const after = slot.kind === 'ram' ? { ...spec, ram: spec.ram.map((p, i) => i === slot.index ? { ...p, ...next } : p) }
    : { ...spec, drives: spec.drives.map((p, i) => i === slot.index ? next : p) };
  return planned({ build: withSpec(state.build, unit.id, after), price }, label);
}
