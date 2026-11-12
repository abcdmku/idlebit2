import { deserializeSave, serializeSave, type GameState } from '../game';
import type { PersistenceAdapter } from './persistence';
import { SAVE_KEY, freezeSaves, isStoredSave } from './saveGame';

export type SaveFile = { readonly ok: true; readonly state: GameState; readonly save: string } | { readonly ok: false; readonly error: string };
export type ImportOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** The stored envelope for a live state: the same file the `?rescue` page downloads. */
export function saveFileText(state: GameState, nowMs: number): string {
  return JSON.stringify({ savedAtMs: nowMs, save: serializeSave(state) });
}

/** `idlebit2-save-2026-11-12.json` for the local day of `nowMs`. */
export function saveFileName(nowMs: number): string {
  const d = new Date(nowMs), two = (n: number) => String(n).padStart(2, '0');
  return `idlebit2-save-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}.json`;
}

/** Parses an exported file through the real save parser. Reads only; a rejected file changes nothing. */
export function readSaveFile(text: string): SaveFile {
  let outer: unknown;
  try { outer = JSON.parse(text); } catch { return { ok: false, error: 'Not a save file.' }; }
  // An export is the stored envelope; a bare serialized save is accepted too.
  const save = isStoredSave(outer) ? outer.save : typeof outer === 'object' && outer !== null && 'schema' in outer ? text : null;
  if (save === null) return { ok: false, error: 'Not an idlebit2 save.' };
  const loaded = deserializeSave(save);
  if (loaded.ok) return { ok: true, state: loaded.state, save };
  // The parser's reasons are developer text; the player gets one short line.
  return { ok: false, error: /^Save version /.test(loaded.error) ? 'Save is from another version.' : 'Save file is damaged.' };
}

/**
 * Replaces the stored save with a validated file, then freezes autosave so the running game cannot
 * write over it. The caller reloads the page; the import then loads as any save does. It counts as
 * saved now, so it earns no time away.
 */
export function importSave(text: string, adapter: PersistenceAdapter, nowMs: number): ImportOutcome {
  const file = readSaveFile(text);
  if (!file.ok) return file;
  // Without browser storage the import would not survive the reload.
  if (adapter.driver !== 'browser' || !adapter.setImmediate(SAVE_KEY, { savedAtMs: nowMs, save: file.save })) {
    return { ok: false, error: 'Browser storage is unavailable.' };
  }
  freezeSaves();
  return { ok: true };
}
