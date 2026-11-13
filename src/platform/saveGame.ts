import { createInitialState, deserializeSave, serializeSave, type GameState } from '../game';
import { bitRougePersistence, type PersistenceAdapter } from './persistence';

export const SAVE_KEY = 'save-v3';
/** Slots written by older builds. Their saves reset; they are left in place, never read. */
export const LEGACY_SAVE_KEYS = ['save-v1'] as const;
export const DURABILITY_NOTICE = 'Save is held in this tab. Browser storage is unavailable.';
export const LEGACY_RESET_NOTICE = 'Old save reset.';

/** `savedAtMs` is the wall time the state represents, used to measure time away. */
interface StoredSave { readonly savedAtMs: number; readonly save: string; readonly absence?: PendingAbsence }

/**
 * An absence whose catch-up has not finished: when it began and how much sim time it has been
 * credited. Saved with each catch-up checkpoint, so a reload or a hidden tab mid-catch-up resumes
 * the same absence under the same offline cap instead of starting a new one.
 */
export interface PendingAbsence { readonly departedAtMs: number; readonly creditedMs: number }
const isAbsence = (value: unknown, savedAtMs: number): value is PendingAbsence =>
  typeof value === 'object' && value !== null && Number.isFinite((value as PendingAbsence).departedAtMs)
  && Number.isFinite((value as PendingAbsence).creditedMs) && (value as PendingAbsence).creditedMs >= 0
  && (value as PendingAbsence).departedAtMs <= savedAtMs;

export interface LoadedGame {
  readonly state: GameState;
  /** Null for a new game. */
  readonly savedAtMs: number | null;
  readonly absence: PendingAbsence | null;
  /** Why the player starts over, if they had a save that could not be used. */
  readonly resetReason: string | null;
}

export const isStoredSave = (value: unknown): value is StoredSave =>
  typeof value === 'object' && value !== null && Number.isFinite((value as StoredSave).savedAtMs)
  && typeof (value as StoredSave).save === 'string';

export async function loadGame(adapter: PersistenceAdapter = bitRougePersistence, seed?: number): Promise<LoadedGame> {
  const fresh = (resetReason: string | null): LoadedGame => ({ state: createInitialState(seed), savedAtMs: null, absence: null, resetReason });
  const stored = await adapter.get(SAVE_KEY);
  if (adapter.readError) return fresh(adapter.readError);
  if (stored === null) {
    for (const key of LEGACY_SAVE_KEYS) if (await adapter.get(key) !== null) return fresh(LEGACY_RESET_NOTICE);
    return fresh(null);
  }
  if (!isStoredSave(stored)) return fresh('Invalid save reset.');
  const loaded = deserializeSave(stored.save);
  if (!loaded.ok) return fresh(`Save reset: ${loaded.error}`);
  return { state: loaded.state, savedAtMs: stored.savedAtMs, absence: isAbsence(stored.absence, stored.savedAtMs) ? stored.absence : null, resetReason: null };
}

let frozen = false;
/** Stops every later save in this page. An imported save is in storage and the page is about to reload. */
export function freezeSaves(): void { frozen = true; }

/** False when browser storage refused the write; the save then lives only in this tab. */
export function saveGame(state: GameState, savedAtMs: number, adapter: PersistenceAdapter = bitRougePersistence,
  absence: PendingAbsence | null = null): boolean {
  if (frozen) return true;
  return adapter.setImmediate(SAVE_KEY, { savedAtMs, save: serializeSave(state), ...(absence ? { absence: { ...absence } } : {}) });
}
