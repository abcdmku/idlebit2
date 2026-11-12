import { useEffect, useSyncExternalStore } from 'react';
import { createSfx, sfxPreferences, type GameStore, type SfxPreferences } from '../../platform';

/** Mounted once by the shell: the engine lives as long as the store, whatever screen is open. */
export function useSfx(store: GameStore): void {
  useEffect(() => {
    const sfx = createSfx(store);
    return () => sfx.dispose();
  }, [store]);
}

export function useSfxPreferences(): SfxPreferences {
  return useSyncExternalStore(sfxPreferences.subscribe, sfxPreferences.get, sfxPreferences.get);
}
