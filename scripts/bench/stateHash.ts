import { createHash, type Hash } from 'node:crypto';
import type { GameState } from '../../src/game';

/** Hashes every byte of a state: typed arrays by content, numbers by their float64 bits. */
function feed(h: Hash, value: unknown): void {
  if (ArrayBuffer.isView(value)) {
    h.update(`<${value.constructor.name}:${value.byteLength}>`);
    h.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  } else if (typeof value === 'number') {
    h.update(new Uint8Array(new Float64Array([value]).buffer));
  } else if (value === null || typeof value !== 'object') {
    h.update(`${typeof value}:${String(value)};`);
  } else if (Array.isArray(value)) {
    h.update(`[${value.length}`); for (const v of value) feed(h, v); h.update(']');
  } else {
    h.update('{');
    for (const [k, v] of Object.entries(value)) { h.update(`${k}=`); feed(h, v); }
    h.update('}');
  }
}
export function hashState(state: GameState): string {
  const h = createHash('sha256'); feed(h, state); return h.digest('hex').slice(0, 20);
}
