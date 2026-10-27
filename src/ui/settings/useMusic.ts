import { useEffect, useRef, useState } from 'react';
import { createMusicPlayer, readMusicPreferences, type MusicPlayer, type MusicPreferences, type MusicSnapshot } from '../../platform';
import { useShell } from '../storeHooks';

/** The player stays mounted when Settings closes, so playback is uninterrupted. */
export function useMusic() {
  const { store } = useShell(), player = useRef<MusicPlayer | null>(null);
  const [snapshot, setSnapshot] = useState<MusicSnapshot>(() => ({ preferences: readMusicPreferences(), status: 'ready' }));
  useEffect(() => {
    const next = createMusicPlayer(store, setSnapshot);
    player.current = next;
    return () => { player.current = null; next.dispose(); };
  }, [store]);
  return {
    ...snapshot,
    update: (change: Partial<MusicPreferences>) => player.current?.update(change),
    play: () => player.current?.play(),
  };
}
