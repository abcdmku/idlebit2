import { LEVEL_NAMES } from './core/constants';
import type { LevelId } from './types/ids';
import type { RenderSnapshot } from './types/snapshot';

/** One soundtrack unlock per hardware tier, using the tier's existing research gate. */
export const MUSIC_TRACKS: readonly { readonly id: LevelId; readonly title: string }[] = [
  { id: 'chip', title: 'Clock Tones' },
  { id: 'system', title: 'System Handshake' },
  { id: 'rack', title: 'Rack Mount' },
  { id: 'room', title: 'Dial Tone' },
  { id: 'global', title: 'Global Bit' },
];

export interface MusicTrackView {
  readonly id: LevelId;
  readonly title: string;
  readonly tier: string;
  readonly unlocked: boolean;
}

export function selectMusicTracks(snapshot: Pick<RenderSnapshot, 'unlocked'>): readonly MusicTrackView[] {
  return MUSIC_TRACKS.map(track => ({ ...track, tier: LEVEL_NAMES[track.id], unlocked: snapshot.unlocked[track.id] }));
}
