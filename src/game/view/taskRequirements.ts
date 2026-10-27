import { accelNeed } from '../core/accelerators';
import { FAMILIES, workingSetAt, payoutCreditsAt, payloadAt } from '../market/families';
import type { FamilyId } from '../types/ids';
import type { TaskRequirementsView } from '../types/views';

/** Exact catalog facts for a task (or shard) of `size` units, shared by every task location; `deadline` is the instance's frozen window (D26.5). */
export function taskRequirements(family: FamilyId, size: number, deadline: number | null = null): TaskRequirementsView {
  const def = FAMILIES[family]!;
  const need = accelNeed(def, size);
  return {
    family, label: def.name, cpuOps: payoutCreditsAt(def, size), payloadBits: payloadAt(def, size),
    stages: def.stages.map((stage) => ({ resource: stage.resource, work: stage.work.fixed + stage.work.perSize * size })),
    grain: def.grain, size, workingSetBits: workingSetAt(def, size),
    gpuCoresMin: need.gpuCores, vramBits: need.vramBits, deadline,
    members: def.members, minZones: def.minZones, region: def.region.kind === 'in' ? def.region.region : null,
    ecc: def.ecc, tensor: def.tensor,
  };
}
