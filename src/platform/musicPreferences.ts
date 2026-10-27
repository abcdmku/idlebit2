import { MUSIC_TRACKS, type LevelId } from '../game';

const KEY = 'idlebit2.music';
export interface MusicPreferences {
  readonly enabled: boolean;
  readonly volume: number;
  readonly track: LevelId;
}
export const DEFAULT_MUSIC: MusicPreferences = { enabled: true, volume: 35, track: 'chip' };

export function readMusicPreferences(): MusicPreferences {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_MUSIC;
    const value = saved as Partial<MusicPreferences>;
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_MUSIC.enabled,
      volume: typeof value.volume === 'number' && Number.isFinite(value.volume)
        ? Math.round(Math.max(0, Math.min(100, value.volume))) : DEFAULT_MUSIC.volume,
      track: MUSIC_TRACKS.find(t => t.id === value.track)?.id ?? DEFAULT_MUSIC.track,
    };
  } catch { return DEFAULT_MUSIC; }
}

export function writeMusicPreferences(value: MusicPreferences): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(value)); } catch { /* Preferences are optional in private mode. */ }
}
