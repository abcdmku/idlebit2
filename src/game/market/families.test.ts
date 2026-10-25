import { MAX_FAMILIES, MAX_SHARDS } from '../core/constants';
import { BANDS, FAMILIES, familyKey, payPerUnit, payloadAt, payoutAt } from './families';
import { familyId } from '../types/ids';

describe('family catalog (tasks.md §5)', () => {
  it('has 50 families, ids equal to catalog index, within MAX_FAMILIES', () => {
    expect(FAMILIES).toHaveLength(50);
    expect(FAMILIES.length).toBeLessThanOrEqual(MAX_FAMILIES);
    FAMILIES.forEach((f, i) => expect(f.id).toBe(i));
    expect(new Set(FAMILIES.map((f) => f.key)).size).toBe(50);
  });

  it('has the documented family count per band', () => {
    const count = Object.fromEntries(BANDS.map((b) => [b, FAMILIES.filter((f) => f.band === b).length]));
    expect(count).toEqual({ bits: 5, ints: 8, threads: 3, ram: 6, gpu: 5, storage: 5, rackDist: 6, roomDist: 4, multiAz: 4, region: 4 });
  });

  it('pays the table\'s Pay/unit column', () => {
    const pay = Object.fromEntries(FAMILIES.map((f) => [f.key, payPerUnit(f)]));
    expect(pay).toMatchObject({ bitFlip: 1, compare: 2, regex: 5, mergeSort: 5, imageBlur: 11, rayTrace: 14, trainShard: 20, llmTrain: 30, exchangeFeed: 6 });
  });

  it('folds RAM and storage stages into one mem stage and disk into the working set (D26.3), with band windows (D26.5)', () => {
    const at = (key: string) => FAMILIES.find((f) => f.key === key)!;
    expect(at('indexBuild').stages.map((s) => [s.resource, s.work.perSize])).toEqual([['compute', 2], ['mem', 5]]);
    expect(at('indexBuild').workingSet).toEqual({ fixed: 0, perSize: 6 });
    expect(at('backup').stages.map((s) => [s.resource, s.work.perSize])).toEqual([['mem', 6]]);
    expect(at('backup').workingSet.perSize).toBe(16);
    expect(at('imageBlur').stages.map((s) => s.resource)).toEqual(['mem', 'gpu']);
    expect(['bitFlip', 'sqlScan', 'replWrite', 'teraSort', 'drBackup', 'euResidency', 'exchangeFeed'].map((k) => at(k).windowS))
      .toEqual([null, null, 120, 180, 240, 120, 60]);
    expect(FAMILIES.filter((f) => f.windowS !== null)).toHaveLength(18);
  });

  it('pays Σ stage work of the whole task, once (D2, D25.5)', () => {
    const replWrite = FAMILIES.find((f) => f.key === 'replWrite')!;
    expect(payoutAt(replWrite, 10)).toBe(7 * 10);
  });

  it('derives payload from whole-task work for every family (D10.4)', () => {
    for (const f of FAMILIES) {
      for (const size of [1, 10, 257]) expect(payloadAt(f, size)).toBe(payoutAt(f, size));
    }
  });

  it('keeps members ≤ 256, Data ratios in 10..100, tensor on 5 and ECC on 10 families', () => {
    expect(Math.max(...FAMILIES.map((f) => f.members))).toBe(MAX_SHARDS);
    for (const f of FAMILIES) {
      expect(f.dataRatio).toBeGreaterThanOrEqual(10);
      expect(f.dataRatio).toBeLessThanOrEqual(100);
    }
    expect(FAMILIES.filter((f) => f.tensor).map((f) => f.key)).toEqual(['inference', 'trainShard', 'bigTrain', 'hallTrain', 'llmTrain']);
    expect(FAMILIES.filter((f) => f.ecc)).toHaveLength(10);
  });

  it('names the region locks', () => {
    const regions = FAMILIES.filter((f) => f.region.kind === 'in').map((f) => [f.key, f.region.kind === 'in' ? f.region.region : '']);
    expect(regions).toEqual([['euResidency', 'eu-west'], ['apacPayments', 'ap-southeast'], ['exchangeFeed', 'ap-northeast']]);
    expect(familyKey(familyId(0))).toBe('bitFlip');
    expect(familyKey(familyId(99))).toBe('unknown');
  });
});

describe('catalog sync with scripts/market-model.ts', () => {
  it('transcribes every fam(...) row of the model exactly', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '../../..');
    const model = readFileSync(join(root, 'scripts/market-model.ts'), 'utf8').split('\n')
      .filter((l) => l.trimStart().startsWith('fam("'))
      .map((l) => l.trim().replace(/"/g, "'").replace(/\),$/, ');')
        // The model's WINX tuning knob scales windows; the sim carries the base value.
        .replace(' * Number(process.env.WINX ?? 1)', ''));
    const ours = readFileSync(join(__dirname, 'families.ts'), 'utf8').split('\n').filter((l) => l.startsWith("fam('"));
    expect(ours).toEqual(model);
  });

  it('uses the accepted fixed core floors and keeps affinity', () => {
    const cores = Object.fromEntries(FAMILIES.filter((f) => f.stages.some((s) => s.resource === 'gpu')).map((f) => [f.key, f.gpuCoresMin]));
    expect(cores).toEqual({ imageBlur: 1, thumbnail: 1, transcode: 4, inference: 0, rayTrace: 16, trainShard: 256,
      renderFarm: 128, bigTrain: 1024, hallTrain: 4096, llmTrain: 8192 });
    for (const f of FAMILIES) {
      expect(Number.isSafeInteger(f.gpuCoresMin)).toBe(true);
      expect(f.gpuCoresMin).toBeGreaterThanOrEqual(0);
      expect(f.vramBits.fixed).toBeGreaterThanOrEqual(0);
      expect(f.vramBits.perSize).toBeGreaterThanOrEqual(0);
      if (!f.stages.some((s) => s.resource === 'gpu')) expect([f.gpuCoresMin, f.vramBits.fixed, f.vramBits.perSize]).toEqual([0, 0, 0]);
      expect(f).not.toHaveProperty('gpus');
    }
    expect(FAMILIES.filter((f) => f.affinity === 'accelerator')).toHaveLength(14);
  });
});
