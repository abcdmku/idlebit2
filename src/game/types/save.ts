import type { GameState } from './state';

export type SaveLoadResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: string };
