import type { SystemId } from '../types/ids';
import type { GameState } from '../types/state';
import { ECC_PRICE_FACTOR, installPrice, PARTS, scalePrice, upgradesBetween } from './catalog';
import { ruleLock } from './locks';
import { withSpec } from './partAccess';
import { coldScopes, fail, locked, planned, type Plan } from './plan';

/** Replace incompatible RAM together, at its current generation and level, so the ECC gate is met. */
export function planRamEcc(state: GameState, system: SystemId): Plan {
  const spec = state.build.systems[system]?.spec, label = 'Replace RAM with ECC';
  if (!spec || !spec.ram.length) return fail('invalid', 'No RAM installed', label);
  const lock = ruleLock(state.research.unlocks, 'ecc');
  if (lock) return locked(lock, label);
  const missing = spec.ram.filter(m => !m.ecc);
  if (!missing.length) return locked({ code: 'ceiling', node: null, text: 'All RAM is ECC' }, label);
  const price = missing.reduce((sum, m) => sum + scalePrice(installPrice(PARTS.ram, m.gen)
    + upgradesBetween(PARTS.ram, m.gen, 1, m.level, 1), ECC_PRICE_FACTOR), 0n);
  const unit = { kind: 'system', id: system } as const;
  return planned({ build: withSpec(state.build, system, { ...spec, ram: spec.ram.map(m => m.ecc ? m : { ...m, ecc: true }) }),
    price, cold: coldScopes(state, unit) }, label);
}
