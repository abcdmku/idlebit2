/** Base64 over bytes without browser or Node globals (the sim stays pure). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128).fill(255);
for (let i = 0; i < ALPHABET.length; i += 1) LOOKUP[ALPHABET.charCodeAt(i)] = i;
/** Two output characters per 12 input bits. */
const PAIRS: string[] = [];
for (let i = 0; i < 4096; i += 1) PAIRS.push(ALPHABET[i >> 6]! + ALPHABET[i & 63]!);

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    chunk.push(PAIRS[n >>> 12]! + PAIRS[n & 4095]!);
    if (chunk.length >= 4096) { parts.push(chunk.join('')); chunk = []; }
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    chunk.push(PAIRS[n >>> 12]! + '==');
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    chunk.push(PAIRS[n >>> 12]! + ALPHABET[(n >>> 6) & 63]! + '=');
  }
  parts.push(chunk.join(''));
  return parts.join('');
}

export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0) throw new Error('base64: length must be a multiple of 4');
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j += 1) {
      const code = text.charCodeAt(i + j);
      const v = code === 61 ? 0 : code < 128 ? LOOKUP[code]! : 255;
      if (v === 255) throw new Error('base64: invalid character');
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >>> 16) & 255;
    if (o < out.length) out[o++] = (n >>> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
