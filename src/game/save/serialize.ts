import type { AnyTypedArray } from '../core/table';
import type { GameState } from '../types/state';
import type { SaveLoadResult } from '../types/save';
import { refReplacer, resolveRefs } from './refs';
import { SAVE_SCHEMA, SAVE_VERSION, type SaveEnvelope } from './schema';
import { decodeArray, encodeArray, isEncodedArray, type EncodedArray } from './typedArrays';
import { validateState } from './validate';

export { SAVE_SCHEMA } from './schema';

/**
 * Full state as JSON: typed arrays as base64 (run-length when mostly uniform), shared plain
 * sub-objects written once (save/refs.ts). Saves are observations: they change nothing.
 */
export function serializeSave(state: GameState): string {
  const envelope: SaveEnvelope = { schema: SAVE_SCHEMA, version: SAVE_VERSION, state: { ...state, compiled: encodeCompiled(state.compiled) } };
  return JSON.stringify(envelope, refReplacer(envelope, (value) => encodeArray(value as AnyTypedArray)));
}

/**
 * Compiled columns are never written in place (actions replace them copy-on-write), so a column's
 * encoding is memoized by array identity: repeated autosaves re-encode only the hot buffers.
 */
const COMPILED_CODES = new WeakMap<object, EncodedArray>();
function encodeCompiled(compiled: GameState['compiled']): unknown {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, table] of Object.entries(compiled)) {
    const encoded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(table as object)) {
      if (!ArrayBuffer.isView(value)) { encoded[key] = value; continue; }
      let code = COMPILED_CODES.get(value);
      if (!code) { code = encodeArray(value as AnyTypedArray); COMPILED_CODES.set(value, code); }
      encoded[key] = code;
    }
    out[name] = encoded;
  }
  return out;
}

export function deserializeSave(text: string): SaveLoadResult {
  let parsed: unknown;
  try {
    parsed = resolveRefs(JSON.parse(text), (value) => (isEncodedArray(value) ? decodeArray(value) : undefined));
  } catch (error) {
    return { ok: false, error: `Unreadable save: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'Save is not an object' };
  const envelope = parsed as Partial<SaveEnvelope>;
  if (envelope.schema !== SAVE_SCHEMA) return { ok: false, error: `Save schema ${String(envelope.schema)} is not ${SAVE_SCHEMA}` };
  if (envelope.version !== SAVE_VERSION) return { ok: false, error: `Save version ${String(envelope.version)} is not ${SAVE_VERSION}` };
  return validateState(envelope.state);
}
