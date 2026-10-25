import type { FamilyDef, Resource } from '../types/catalog';
import { familyId } from '../types/ids';

/**
 * Families for exec and net tests (test-only; installed with vi.mock of market/families). Every
 * stage coefficient is 1, so stage work = the record's scale. Weights are 0: the market never draws
 * them, tests put records in the feed themselves.
 */
interface Opts {
  /** Grain (D25.1); the default never splits and runs one thread. `threads: k` sets grain = 1 for k-thread shards of k units. */
  readonly grain?: number;
  readonly threads?: number; readonly ws?: number; readonly wsPerUnit?: number; readonly vram?: number;
  readonly members?: number; readonly ecc?: boolean; readonly gpuCores?: number; readonly affinity?: FamilyDef['affinity']; readonly tensor?: boolean; readonly minZones?: number; readonly region?: FamilyDef['region']; readonly windowS?: number;
}
/** A grain above every test size: the task stays one shard on one thread. */
export const TEST_GRAIN = 2 ** 40;
const rows: FamilyDef[] = [];
function fam(key: string, stages: readonly Resource[], o: Opts = {}): number {
  const id = rows.length;
  rows.push({
    id: familyId(id), key, name: key, band: 'bits', note: '', window: { from: 0, to: 0 }, weight: 0,
    stages: stages.map((resource) => ({ resource, work: { fixed: 0, perSize: 1 } })),
    grain: o.grain ?? (o.threads ? 1 : TEST_GRAIN), workingSet: { fixed: o.ws ?? 0, perSize: o.wsPerUnit ?? 0 }, vramBits: { fixed: o.vram ?? 0, perSize: 0 },
    members: o.members ?? 1, minZones: o.minZones ?? 1, region: o.region ?? { kind: 'any' },
    tensor: o.tensor ?? false, ecc: o.ecc ?? false, dataRatio: 10, windowS: o.windowS ?? null,
    gpuCoresMin: o.gpuCores ?? (stages.includes('gpu') ? 1 : 0), affinity: o.affinity ?? (stages.includes('gpu') || (o.ws ?? 0) >= 64 ? 'accelerator' : 'general'),
  });
  return id;
}

export const F = {
  cpu: fam('cpu', ['compute']),
  cpu2: fam('cpu2', ['compute'], { threads: 2 }),
  cpu4: fam('cpu4', ['compute'], { threads: 4 }),
  ram: fam('ram', ['mem'], { ws: 4 }),
  mix: fam('mix', ['compute', 'mem', 'compute'], { ws: 1 }),
  gpu: fam('gpu', ['gpu'], { vram: 2 }),
  io: fam('io', ['mem'], { ws: 1 }),
  big: fam('big', ['compute'], { ws: 64 }),
  ecc: fam('ecc', ['compute'], { ecc: true }),
  net: fam('net', ['compute']),
  gang: fam('gang', ['compute'], { members: 4 }),
  gpu4: fam('gpu4', ['gpu'], { gpuCores: 4 }),
  gpu60: fam('gpu60', ['gpu'], { vram: 60 }),
  gpuIo: fam('gpuIo', ['gpu', 'mem'], { vram: 60, ws: 1 }),
  cpuGpu: fam('cpuGpu', ['compute', 'gpu'], { vram: 2 }),
  tensor: fam('tensor', ['gpu'], { gpuCores: 0, tensor: true, vram: 2 }),
  tensorCores: fam('tensorCores', ['gpu'], { gpuCores: 4, tensor: true, vram: 2 }),
  /** D25 split families: a 1,000-unit grain; a 1-unit grain whose working set grows per unit; an 8-member minimum split. */
  par: fam('par', ['compute'], { grain: 1000 }),
  wide: fam('wide', ['compute'], { grain: 1, wsPerUnit: 1 }),
  gang8: fam('gang8', ['compute'], { grain: 1, members: 8 }),
  /** D26: a mem stage over a working set of 1 bit per unit; one shard (spill), or 1-unit grain (spillPar). */
  spill: fam('spill', ['mem'], { wsPerUnit: 1 }),
  spillPar: fam('spillPar', ['mem'], { grain: 1, wsPerUnit: 1 }),
} as const;

export const TEST_FAMILIES: readonly FamilyDef[] = rows;
