import { G, type HotBuffers } from './buffers';

/**
 * xoshiro128** in place on hot.rng (Uint32Array(4)), the same algorithm, seeding and outputs as
 * the v2 rng.ts. Only the market phase draws (architecture §1.7). Each draw bumps G.rngDraws.
 */
export type RngHost = Pick<HotBuffers, 'rng' | 'g'>;

const UINT32_RANGE = 0x1_0000_0000;
const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export function splitMix32(seed: number): number {
  let v = (seed + 0x9e3779b9) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x21f0aaad);
  v = Math.imul(v ^ (v >>> 15), 0x735a2d97);
  return (v ^ (v >>> 15)) >>> 0;
}

/** Seeds the four words exactly as v2 createRngState(seed). */
export function seedRng(rng: Uint32Array, seed: number): void {
  for (let i = 0; i < 4; i += 1) rng[i] = splitMix32(seed + i);
  if (rng[0] === 0 && rng[1] === 0 && rng[2] === 0 && rng[3] === 0) rng[0] = 1;
}

/** The seed of round `roundIndex`: fresh per round, reproducible from the game seed. */
export const roundSeed = (seed: number, roundIndex: number) => splitMix32((seed ^ Math.imul(roundIndex, 0x85ebca6b)) >>> 0);

/** Reseeds the stream for a round (called at Return to market, and for round 1 at creation). */
export function reseedForRound(host: RngHost, seed: number, roundIndex: number): void {
  seedRng(host.rng, roundSeed(seed, roundIndex));
}

export function nextU32(host: RngHost): number {
  const s = host.rng;
  const s0 = s[0]!, s1 = s[1]!, s2 = s[2]!, s3 = s[3]!;
  const value = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  const n2 = (s2 ^ s0) >>> 0;
  const n3 = (s3 ^ s1) >>> 0;
  s[0] = (s0 ^ n3) >>> 0;
  s[1] = (s1 ^ n2) >>> 0;
  s[2] = (n2 ^ t) >>> 0;
  s[3] = rotl(n3, 11);
  host.g[G.rngDraws] = host.g[G.rngDraws]! + 1;
  return value;
}

/** Uniform in [0, 1). */
export const nextFloat = (host: RngHost) => nextU32(host) / UINT32_RANGE;

/** Uniform integer in [min, maxExclusive). */
export function nextInt(host: RngHost, min: number, maxExclusive: number): number {
  if (!(maxExclusive > min)) throw new Error('RNG integer range must be non-empty');
  return min + Math.floor((nextU32(host) / UINT32_RANGE) * (maxExclusive - min));
}
