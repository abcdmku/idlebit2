import { G } from './buffers';
import { nextFloat, nextInt, nextU32, reseedForRound, roundSeed, seedRng, type RngHost } from './rng';

// Vectors produced by the v2 rng.ts (createRngState + nextRngUint32); v3 must match bit for bit.
const V2_VECTORS = [
  { seed: 42, words: [551831576, 3575138799, 2276219186, 2349975146], out: [2726265396, 265113989, 4262593846, 1494547604, 863275254, 764887023, 874210705, 3640465557] },
  { seed: 7, words: [3838393609, 2928551386, 2457862010, 2203898806], out: [2119412436, 6052732, 184142685, 2739731366, 2891843447, 4261758713, 1443905802, 425496720] },
  { seed: 0x1d1eb17, words: [2245219027, 460025792, 2435359308, 2315822946], out: [4048708196, 906091222, 3830976398, 1540226261, 3666823220, 3344677962, 973465378, 3540189675] },
];

const host = (seed: number): RngHost => {
  const h = { rng: new Uint32Array(4), g: new Float64Array(32) };
  seedRng(h.rng, seed);
  return h;
};

describe('v3 rng (in-place xoshiro128**)', () => {
  it.each(V2_VECTORS)('matches the v2 seeding and outputs for seed $seed', ({ seed, words, out }) => {
    const h = host(seed);
    expect([...h.rng]).toEqual(words);
    expect(out.map(() => nextU32(h))).toEqual(out);
    expect(h.g[G.rngDraws]).toBe(8);
  });

  it('keeps floats in [0, 1) and integers in range', () => {
    const h = host(1);
    for (let i = 0; i < 1000; i += 1) {
      const f = nextFloat(h);
      expect(f >= 0 && f < 1).toBe(true);
      const n = nextInt(h, 3, 9);
      expect(Number.isInteger(n) && n >= 3 && n < 9).toBe(true);
    }
    expect(() => nextInt(h, 5, 5)).toThrow();
  });

  it('reseeds each round reproducibly and differently', () => {
    const a = host(0), b = host(0);
    reseedForRound(a, 42, 3);
    reseedForRound(b, 42, 3);
    expect([...a.rng]).toEqual([...b.rng]);
    expect(roundSeed(42, 3)).not.toBe(roundSeed(42, 4));
    expect(roundSeed(42, 3)).not.toBe(roundSeed(43, 3));
  });
});
