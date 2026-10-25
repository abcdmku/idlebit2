import { ARRAY_CTORS, type AnyTypedArray, type ArrayKind } from '../core/table';
import { decodeBase64, encodeBase64 } from './base64';

/**
 * A typed array in JSON. Raw: its bytes (little-endian) as base64. Runs: when the array is mostly
 * repeats of one block of `p` elements (p = a column stride, so a uniform fleet's columns shrink
 * to a few runs), `rl` holds the run lengths in blocks (u32) and `rv` one block per run.
 * Equality keeps -0 apart from 0, so every value round-trips exactly.
 */
export type EncodedArray =
  | { readonly $ta: ArrayKind; readonly b64: string }
  | { readonly $ta: ArrayKind; readonly n: number; readonly p: number; readonly rl: string; readonly rv: string };

const KINDS = Object.keys(ARRAY_CTORS) as ArrayKind[];
const PERIODS = [1, 2, 3, 4, 8, 9, 12, 18, 24];
const bytesOf = (a: AnyTypedArray) => new Uint8Array(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength);
const same = (a: number, b: number) => (a === b ? a !== 0 || 1 / a === 1 / b : a !== a && b !== b);

/** Runs of identical p-blocks, or Infinity once more than `limit`. */
function countRuns(v: AnyTypedArray, p: number, limit: number): number {
  const n = v.length;
  if (n % p !== 0) return Infinity;
  if (p === 1) {
    let runs = 1;
    let prev = v[0]!;
    for (let i = 1; i < n; i += 1) {
      const x = v[i]!;
      if (x !== prev || (x === 0 && 1 / x !== 1 / prev)) {
        runs += 1;
        if (runs > limit) return Infinity;
      }
      prev = x;
    }
    return runs;
  }
  let runs = 1;
  for (let i = p; i < n; i += p) {
    for (let j = 0; j < p; j += 1) {
      if (!same(v[i + j]!, v[i + j - p]!)) {
        runs += 1;
        if (runs > limit) return Infinity;
        break;
      }
    }
  }
  return runs;
}

export function encodeArray(value: AnyTypedArray): EncodedArray {
  const kind = KINDS.find((k) => value instanceof ARRAY_CTORS[k]);
  if (!kind) throw new Error('serializeSave: unsupported typed array');
  const n = value.length;
  const raw = (): EncodedArray => ({ $ta: kind, b64: encodeBase64(bytesOf(value)) });
  if (n < 32) return raw();
  const unit = value.BYTES_PER_ELEMENT;
  let best = { p: 0, runs: 0, bytes: n * unit / 2 };
  for (const p of PERIODS) {
    const runs = countRuns(value, p, Math.floor(best.bytes / (4 + p * unit)));
    const bytes = runs * (4 + p * unit);
    if (bytes < best.bytes) best = { p, runs, bytes };
    if (runs === 1 || best.bytes <= 512 || best.bytes * 16 <= n * unit) break;
  }
  if (best.p === 0) return raw();
  const { p, runs } = best;
  const lengths = new Uint32Array(runs);
  const values = new ARRAY_CTORS[kind](runs * p);
  let r = 0;
  values.set(value.subarray(0, p) as never, 0);
  lengths[0] = 1;
  for (let i = p; i < n; i += p) {
    let match = true;
    for (let j = 0; j < p; j += 1) if (!same(value[i + j]!, value[i + j - p]!)) { match = false; break; }
    if (!match) { r += 1; values.set(value.subarray(i, i + p) as never, r * p); }
    lengths[r] = lengths[r]! + 1;
  }
  return { $ta: kind, n, p, rl: encodeBase64(bytesOf(lengths)), rv: encodeBase64(bytesOf(values)) };
}

function view(kind: ArrayKind, b64: string): AnyTypedArray {
  const ctor = ARRAY_CTORS[kind];
  if (!ctor) throw new Error(`deserializeSave: unknown typed array kind ${String(kind)}`);
  const bytes = decodeBase64(b64);
  if (bytes.byteLength % ctor.BYTES_PER_ELEMENT !== 0) throw new Error('deserializeSave: typed array byte length mismatch');
  return new ctor(bytes.buffer as ArrayBuffer, 0, bytes.byteLength / ctor.BYTES_PER_ELEMENT);
}

export function decodeArray(encoded: EncodedArray): AnyTypedArray {
  if ('b64' in encoded) return view(encoded.$ta, encoded.b64);
  const { n, p } = encoded;
  const lengths = view('u32', encoded.rl);
  const values = view(encoded.$ta, encoded.rv);
  if (!(p >= 1) || values.length !== lengths.length * p) throw new Error('deserializeSave: run table mismatch');
  const out = new ARRAY_CTORS[encoded.$ta](n);
  let at = 0;
  for (let r = 0; r < lengths.length; r += 1) {
    const block = values.subarray(r * p, r * p + p);
    for (let k = lengths[r]!; k > 0; k -= 1) {
      if (at + p > n) throw new Error('deserializeSave: runs exceed length');
      if (p === 1) { out.fill(block[0]! as never, at, at + 1); at += 1; continue; }
      out.set(block as never, at);
      at += p;
    }
  }
  if (at !== n) throw new Error('deserializeSave: runs short of length');
  return out;
}

export const isEncodedArray = (value: unknown): value is EncodedArray =>
  typeof value === 'object' && value !== null && '$ta' in value && ('b64' in value || 'rl' in value);
