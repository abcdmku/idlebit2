import type { FamilyDef, Resource } from '../types/catalog';
import { familyId } from '../types/ids';

/**
 * Families for exec and net tests (test-only; installed with vi.mock of market/families). Every
 * stage coefficient is 1, so stage work = the record's scale. Weights are 0: the market never draws
 * them, tests put records in the feed themselves.
 */
interface Opts {
  readonly threads?: number; readonly ws?: number; readonly vram?: number; readonly disk?: number;
  readonly members?: number; readonly ecc?: boolean; readonly gpuCores?: number; readonly affinity?: FamilyDef['affinity']; readonly tensor?: boolean; readonly minZones?: number; readonly region?: FamilyDef['region'];
}
const rows: FamilyDef[] = [];
function fam(key: string, stages: readonly Resource[], o: Opts = {}): number {
  const id = rows.length;
  rows.push({
    id: familyId(id), key, name: key, band: 'bits', note: '', window: { from: 0, to: 0 }, weight: 0,
    stages: stages.map((resource) => ({ resource, work: { fixed: 0, perSize: 1 } })),
    threads: o.threads ?? 1, workingSet: { fixed: o.ws ?? 0, perSize: 0 }, vramBits: { fixed: o.vram ?? 0, perSize: 0 },
    storageBits: { fixed: o.disk ?? 0, perSize: 0 },
    members: o.members ?? 1, minZones: o.minZones ?? 1, region: o.region ?? { kind: 'any' },
    tensor: o.tensor ?? false, ecc: o.ecc ?? false, dataRatio: 10,
    gpuCoresMin: o.gpuCores ?? (stages.includes('gpu') ? 1 : 0), affinity: o.affinity ?? (stages.includes('gpu') || (o.ws ?? 0) >= 64 ? 'accelerator' : 'general'),
  });
  return id;
}

export const F = {
  cpu: fam('cpu', ['cpu']),
  cpu2: fam('cpu2', ['cpu'], { threads: 2 }),
  cpu4: fam('cpu4', ['cpu'], { threads: 4 }),
  ram: fam('ram', ['ram'], { ws: 4 }),
  mix: fam('mix', ['cpu', 'ram', 'io', 'cpu']),
  gpu: fam('gpu', ['gpu'], { vram: 2 }),
  io: fam('io', ['io'], { disk: 1 }),
  big: fam('big', ['cpu'], { ws: 64 }),
  ecc: fam('ecc', ['cpu'], { ecc: true }),
  net: fam('net', ['cpu']),
  gang: fam('gang', ['cpu'], { members: 4 }),
  gpu4: fam('gpu4', ['gpu'], { gpuCores: 4 }),
  gpu60: fam('gpu60', ['gpu'], { vram: 60 }),
  gpuIo: fam('gpuIo', ['gpu', 'io'], { vram: 60 }),
  cpuGpu: fam('cpuGpu', ['cpu', 'gpu'], { vram: 2 }),
  tensor: fam('tensor', ['gpu'], { gpuCores: 0, tensor: true, vram: 2 }),
  tensorCores: fam('tensorCores', ['gpu'], { gpuCores: 4, tensor: true, vram: 2 }),
} as const;

export const TEST_FAMILIES: readonly FamilyDef[] = rows;
