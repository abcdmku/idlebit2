import type { BandId, FamilyDef, RegionId, Resource, StageDef } from '../types/catalog';
import { familyId, type FamilyId } from '../types/ids';

/**
 * The 50 task families of docs/tasks.md §5, in catalog order. Catalog order is the RNG draw
 * order (§3.6). Stage coefficients, working set and VRAM are per unit of size (a shard of u units multiplies them by u, D25);
 * payload is derived from the task's stage work (D10.4). Transcribed from scripts/market-model.ts `FAMS`.
 * D26.3: the model's RAM-stream (r) and storage-IO (d) coefficients fold into one mem stage of bits touched
 * (adjacent ones merge), and its old disk capacity joins the working set (wsPerUnit + disk).
 */

export const BANDS: readonly BandId[] = ['bits', 'ints', 'threads', 'ram', 'gpu', 'storage', 'rackDist', 'roomDist', 'multiAz', 'region'];

const RES: Readonly<Record<string, Resource>> = { c: 'compute', r: 'mem', g: 'gpu', d: 'mem' };
/** D26.5 completion window in seconds by band (BANDS order): rackDist on; null before. */
const BAND_WINDOW: readonly (number | null)[] = [null, null, null, null, null, null, 120, 180, 240, 120];

/** D25.1 grain classes, in size units: a shard is never smaller than one grain (docs/tasks.md §2). */
const GRAIN = { serial: 65536, coarse: 4096, medium: 256, fine: 64, tile: 16 } as const;
/** Default grain per band (BANDS order); a family row may override it. */
const BAND_GRAIN = [GRAIN.coarse, GRAIN.coarse, GRAIN.fine, GRAIN.medium, GRAIN.fine, GRAIN.coarse, GRAIN.fine, GRAIN.fine, GRAIN.fine, GRAIN.fine];

interface Extra {
  /** The pre-D25 thread maximum, kept only so rows stay a verbatim copy of the model. Unused. */
  readonly th?: number;
  /** D26.5 completion window in seconds; defaults to the band's. */
  readonly dl?: number;
  /** Grain in size units (D25.1); defaults to the band's. */
  readonly g?: number; readonly wsF?: number; readonly wsP?: number; readonly vram?: number; readonly disk?: number;
  readonly m?: number; readonly z?: number; readonly reg?: RegionId;
  readonly tensor?: boolean; readonly ecc?: boolean; readonly dataRatio: number;
  /** Fixed GPU cores per member, independent of task size. */
  readonly gpuCoresMin?: number;
}

const rows: FamilyDef[] = [];
function fam(key: string, name: string, band: number, from: number, to: number, weight: number, stages: string, o: Extra, note: string): void {
  const st: StageDef[] = [];
  for (const token of stages.split(' ')) {
    const resource = RES[token[0]!]!, perSize = Number(token.slice(1));
    const last = st[st.length - 1];
    if (last && last.resource === resource) st[st.length - 1] = { resource, work: { fixed: 0, perSize: last.work.perSize + perSize } };
    else st.push({ resource, work: { fixed: 0, perSize } });
  }
  const gpuWork = st.find((s) => s.resource === 'gpu')?.work.perSize ?? 0;
  const pay = st.reduce((sum, s) => sum + s.work.perSize, 0);
  const gpuCoresMin = o.gpuCoresMin ?? 0;
  if (!Number.isSafeInteger(gpuCoresMin) || gpuCoresMin < 0 || !Number.isFinite(o.vram ?? 0) || (o.vram ?? 0) < 0
    || (gpuCoresMin > 0 || (o.vram ?? 0) > 0 || o.tensor) && gpuWork <= 0) throw new Error(`Invalid accelerator requirements: ${key}`);
  // Affinity reads the model's own working-set column (before D26 folds disk into it).
  const accelerator = (o.tensor ?? false) || gpuCoresMin > 0 || 2 * gpuWork >= pay || (o.wsP ?? 0) >= 4;
  rows.push({
    id: familyId(rows.length), key, name, band: BANDS[band]!, note, window: { from, to }, weight, stages: st,
    grain: o.g ?? BAND_GRAIN[band]!,
    workingSet: { fixed: o.wsF ?? 0, perSize: (o.wsP ?? 0) + (o.disk ?? 0) },
    vramBits: { fixed: 0, perSize: o.vram ?? 0 },
    windowS: o.dl ?? BAND_WINDOW[band]!,
    members: o.m ?? 1, minZones: o.z ?? 1,
    region: o.reg ? { kind: 'in', region: o.reg } : { kind: 'any' },
    tensor: o.tensor ?? false, ecc: o.ecc ?? false, dataRatio: o.dataRatio,
    gpuCoresMin, affinity: accelerator ? 'accelerator' : 'general',
  });
}

fam('bitFlip', 'Bit Flip', 0, 0, 5, 10, 'c1', { wsF: 1, dataRatio: 12 }, 'Toggle a stream of bits, one per op.');
fam('parity', 'Parity Check', 0, 0.8, 6.5, 8, 'c1', { wsF: 1, dataRatio: 15 }, 'XOR-fold a stream into one parity bit.');
fam('andMask', 'AND Mask', 0, 0.6, 7, 14, 'c1', { wsF: 2, dataRatio: 25 }, 'Clear bits with a mask, bit by bit.');
fam('compare', 'Compare', 0, 1.6, 8, 10, 'c2', { wsF: 2, dataRatio: 25 }, 'Which of two numbers is larger, MSB first?');
fam('intAdd', 'Integer Add', 0, 3.2, 9, 8, 'c2', { wsF: 3, dataRatio: 25 }, 'Ripple-carry add: a, b and the carry.');
fam('popcount', 'Bit Count', 1, 4, 9.5, 6, 'c2', { wsF: 4, dataRatio: 30 }, 'Count set bits into a 4-bit counter.');
fam('crc8', 'CRC-8', 1, 4.4, 10, 7, 'c3', { wsF: 8, dataRatio: 30 }, '8-bit polynomial check over a stream.');
fam('multiply', 'Multiply', 1, 5, 11, 6, 'c4', { wsF: 16, dataRatio: 60 }, 'Shift-and-add integer multiply.');
fam('fnvHash', 'FNV Hash', 1, 5.6, 12, 6, 'c3', { wsF: 32, dataRatio: 50 }, 'Hash short keys with FNV-1a.');
fam('crc32', 'CRC-32', 1, 6.4, 14, 7, 'c3', { wsF: 48, dataRatio: 40 }, 'The checksum on every zip file.');
fam('binSearch', 'Binary Search', 1, 7.2, 14, 5, 'c2', { wsF: 64, dataRatio: 60 }, 'Find a key in a sorted table.');
fam('regex', 'Regex Match', 1, 8, 16, 6, 'c5', { wsF: 128, dataRatio: 50 }, 'Run a compiled DFA over text.');
fam('intSort', 'Integer Sort', 1, 8.8, 16, 6, 'c4', { wsF: 64, wsP: 0.25, dataRatio: 60 }, 'Sort a small array in place.');
fam('hashBatch', 'Hash Batch', 2, 10, 18, 6, 'c6', { wsF: 768, th: 4, dataRatio: 80 }, 'SHA-256 over a batch, one block per thread.');
fam('lzCompress', 'LZ Compress', 2, 10.8, 18.5, 6, 'c5', { wsF: 512, th: 4, dataRatio: 40 }, 'Deflate logs, one window per thread.');
fam('monteCarlo', 'Monte Carlo', 2, 11.6, 18, 5, 'c6', { wsF: 64, th: 8, g: GRAIN.tile, dataRatio: 100 }, 'Estimate pi with independent samples.');
fam('jsonParse', 'JSON Parse', 3, 11.5, 20, 7, 'c5', { wsF: 256, wsP: 4, g: GRAIN.serial, dataRatio: 40 }, 'Parse a big API response into a tree.');
fam('mergeSort', 'Merge Sort', 3, 12, 21, 8, 'c2 r3', { wsP: 8, dataRatio: 60 }, 'Sort an array too big for cache.');
fam('kvGet', 'KV Cache Get', 3, 12.5, 22, 7, 'c1 r4', { wsP: 12, g: GRAIN.fine, dataRatio: 50 }, 'Serve hot keys from an in-RAM map.');
fam('sqlJoin', 'SQL Join', 3, 13, 23, 7, 'c2 r4', { th: 2, wsP: 12, dataRatio: 15 }, 'Hash-join two tables in RAM.');
fam('graphBfs', 'Graph BFS', 3, 18, 26, 5, 'c1 r5', { th: 4, wsP: 8, dataRatio: 20 }, 'Walk a social graph level by level.');
fam('matmul', 'Matrix Multiply', 3, 20, 28, 6, 'c4 r2', { th: 4, wsP: 2, g: GRAIN.fine, dataRatio: 70 }, 'Dense float matrix product.');
fam('imageBlur', 'Image Blur', 4, 12.5, 24, 7, 'r1 g4', { wsP: 1, gpuCoresMin: 1, vram: 1, dataRatio: 60 }, 'Gaussian blur on a photo.');
fam('thumbnail', 'Thumbnail', 4, 13, 23, 6, 'c1 r1 g3', { wsP: 1, gpuCoresMin: 1, vram: 1, g: GRAIN.tile, dataRatio: 70 }, 'Resize uploads for a feed.');
fam('transcode', 'Video Transcode', 4, 19.5, 28, 7, 'c1 r2 g10', { th: 2, wsP: 1, gpuCoresMin: 4, vram: 2, g: GRAIN.coarse, dataRatio: 60 }, 'H.264 to AV1, one segment.');
fam('inference', 'ML Inference', 4, 17, 29, 8, 'r1 g12', { wsP: 1, gpuCoresMin: 0, vram: 4, tensor: true, dataRatio: 12 }, 'Run a trained model on a batch.');
fam('rayTrace', 'Ray Trace Tile', 4, 22, 30, 5, 'g14', { gpuCoresMin: 16, vram: 2, g: GRAIN.tile, dataRatio: 80 }, 'Render one 64x64 tile.');
fam('logIngest', 'Log Ingest', 5, 12.5, 26, 7, 'c1 d4', { disk: 16, g: GRAIN.medium, dataRatio: 10 }, 'Append and index server logs.');
fam('backup', 'Backup', 5, 13.2, 27, 6, 'd6', { disk: 24, g: GRAIN.serial, dataRatio: 40 }, 'Snapshot a volume to disk.');
fam('indexBuild', 'Index Build', 5, 18.5, 29, 6, 'c2 r2 d3', { wsP: 2, disk: 4, dataRatio: 12 }, 'Build a B-tree over a table.');
fam('compaction', 'LSM Compaction', 5, 21, 31, 5, 'c1 r2 d4', { wsP: 1, disk: 8, dataRatio: 30 }, 'Merge sorted runs into one.');
fam('sqlScan', 'SQL Scan', 5, 23, 33, 6, 'c2 r3 d3', { th: 4, wsP: 2, disk: 2, g: GRAIN.medium, dataRatio: 12 }, 'Full table scan with filters.');
fam('replWrite', 'Replicated Write', 6, 26, 35, 7, 'c2 d5', { disk: 4, m: 3, ecc: true, dataRatio: 40 }, 'Commit one write to three replicas.');
fam('cdnFill', 'CDN Fill', 6, 26.6, 35, 6, 'd5', { disk: 4, g: GRAIN.coarse, dataRatio: 60 }, 'Pull an object into an edge cache.');
fam('apiFanout', 'API Fan-out', 6, 27.4, 36, 6, 'c3 r3', { wsP: 1, m: 4, dataRatio: 70 }, 'One request, four backend calls.');
fam('payroll', 'Payroll Run', 6, 28.2, 38, 5, 'c3 r2 d3', { wsP: 2, disk: 2, ecc: true, g: GRAIN.serial, dataRatio: 40 }, 'Nightly batch where a flipped bit costs money.');
fam('mapReduce', 'MapReduce', 6, 29, 39, 7, 'c3 r3 d3', { wsP: 2, disk: 2, m: 8, dataRatio: 12 }, 'Map, shuffle, reduce on 8 nodes.');
fam('trainShard', 'Training Shard', 6, 29.8, 40, 6, 'r2 g18', { wsP: 1, gpuCoresMin: 256, vram: 8, m: 8, tensor: true, dataRatio: 10 }, 'One data-parallel step across 8 systems.');
fam('teraSort', 'TeraSort', 7, 32, 42, 6, 'c2 r3 d4', { wsP: 2, disk: 4, m: 32, dataRatio: 25 }, 'Sort a huge file across 32 nodes.');
fam('renderFarm', 'Render Farm', 7, 32.8, 43, 6, 'g18', { gpuCoresMin: 128, vram: 4, m: 24, dataRatio: 80 }, 'Film frames across the farm.');
fam('pageRank', 'PageRank', 7, 33.6, 43, 5, 'c3 r5', { wsP: 4, m: 16, dataRatio: 12 }, 'Iterate link scores over a web graph.');
fam('bigTrain', 'Large Training', 7, 34.6, 44, 5, 'r2 g20', { wsP: 2, gpuCoresMin: 1024, vram: 64, m: 48, tensor: true, ecc: true, dataRatio: 10 }, 'A model too big for one rack.');
fam('activeActive', 'Active-Active DB', 8, 41, 51, 7, 'c3 r3 d3', { wsP: 2, disk: 2, m: 4, z: 2, ecc: true, dataRatio: 30 }, 'Accept writes in two zones at once.');
fam('quorumWrite', 'Quorum Write', 8, 41.8, 51, 6, 'c2 d5', { disk: 4, m: 3, z: 3, ecc: true, dataRatio: 40 }, 'Raft commit across three zones.');
fam('drBackup', 'DR Backup', 8, 42.6, 51, 5, 'd8', { disk: 16, m: 2, z: 2, g: GRAIN.coarse, dataRatio: 30 }, 'Copy a snapshot to another zone.');
fam('hallTrain', 'Multi-hall Train', 8, 43.6, 53, 5, 'r3 g22', { wsP: 2, gpuCoresMin: 4096, vram: 128, m: 96, z: 2, tensor: true, ecc: true, dataRatio: 10 }, 'Training that spans two halls.');
fam('euResidency', 'EU Residency', 9, 46.5, 57, 7, 'c3 r3 d3', { wsP: 1, disk: 2, m: 4, reg: 'eu-west', ecc: true, dataRatio: 20 }, 'EU personal data stays in the EU.');
fam('llmTrain', 'LLM Training', 9, 48.5, 59, 5, 'r4 g26', { wsP: 2, gpuCoresMin: 8192, vram: 256, m: 256, z: 2, tensor: true, ecc: true, dataRatio: 10 }, 'Pretrain on 256 systems; any region.');
fam('apacPayments', 'APAC Payments', 9, 47.5, 57, 6, 'c4 r3 d3', { wsP: 1, disk: 2, m: 4, reg: 'ap-southeast', ecc: true, dataRatio: 40 }, 'Card payments settled in-region.');
fam('exchangeFeed', 'Exchange Feed', 9, 50, 59, 6, 'c4 r2', { wsP: 0.5, m: 2, reg: 'ap-northeast', ecc: true, dl: 60, dataRatio: 15 }, 'Match orders next to the Tokyo exchange.');

/** Index = FamilyId. At most MAX_FAMILIES (core/constants). */
export const FAMILIES: readonly FamilyDef[] = rows;

/** Stable string key of a family (glyphs, labels); 'unknown' for an id outside the catalog. */
export const familyKey = (id: FamilyId): string => FAMILIES[id]?.key ?? 'unknown';

/** Credits per unit of size: Σ stage coefficients (D2, 1 Credit per op or bit). */
export const payPerUnit = (f: FamilyDef): number => f.stages.reduce((sum, s) => sum + s.work.perSize, 0);

/** Whole-unit stage work of a shard (or task) of `size` units. */
export const stageWork = (stage: StageDef, size: number): number => stage.work.fixed + stage.work.perSize * size;

/** Payout W of a task of `size` units: Σ stage work (tasks.md §2, D25.1); also a shard's payload at its units. */
export function payoutAt(f: FamilyDef, size: number): number {
  let work = 0;
  for (const s of f.stages) work += stageWork(s, size);
  return work;
}

/** Gate quantities of a shard of `size` units (bits, spec §6.3). */
export const workingSetAt = (f: FamilyDef, size: number) => f.workingSet.fixed + f.workingSet.perSize * size;
export const vramAt = (f: FamilyDef, size: number) => f.vramBits.fixed + f.vramBits.perSize * size;
/** Payload bits equal work (D10.4). */
export const payloadAt = (f: FamilyDef, size: number) => Math.ceil(payoutAt(f, size));

export const usesResource = (f: FamilyDef, r: Resource): boolean => f.stages.some((s) => s.resource === r);

