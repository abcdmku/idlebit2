import { accelNeed } from '../core/accelerators';
import { FAMILIES, storageAt, workingSetAt } from '../market/families';
import type { FamilyId } from '../types/ids';
import type { TaskRequirementsView } from '../types/views';

/** Exact catalog facts for the frozen per-member size, shared by every task location. */
export function taskRequirements(family: FamilyId, size: number): TaskRequirementsView {
  const def = FAMILIES[family]!;
  const need = accelNeed(def, size);
  return {
    family, label: def.name,
    stages: def.stages.map((stage) => ({ resource: stage.resource, work: stage.work.fixed + stage.work.perSize * size })),
    threads: def.threads, workingSetBits: workingSetAt(def, size),
    gpuCoresMin: need.gpuCores, vramBits: need.vramBits, storageBits: storageAt(def, size),
    members: def.members, minZones: def.minZones, region: def.region.kind === 'in' ? def.region.region : null,
    ecc: def.ecc, tensor: def.tensor,
  };
}
