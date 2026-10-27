import { useRef } from 'react';
import { selectMusicTracks, type MusicTrackView } from '../../game';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { CloseKey } from '../shell/CloseKey';
import { box, useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { useMusic } from './useMusic';
import '../styles/settings.css';

type MusicControls = ReturnType<typeof useMusic>;

export function SettingsScreen() {
  const music = useMusic(), state = useViewState();
  const unlocked = useGameSelector(s => s.unlocked, shallowEqual);
  return state.sheet === 'settings' ? <OpenSettings music={music} tracks={selectMusicTracks({ unlocked })} /> : null;
}

function OpenSettings({ music, tracks }: { music: MusicControls; tracks: readonly MusicTrackView[] }) {
  const ref = useRef<HTMLElement>(null), L = useLayout(), { view } = useShell();
  const close = () => view.dispatch({ type: 'back' });
  useDialogFocus(ref, close);
  const inset = L.kind === 'desktop' ? L.lat : 8;
  const w = Math.min(560, L.w - 2 * inset), h = Math.min(640, L.h - 2 * inset);
  const { preferences, status } = music;
  const playing = status === 'playing';
  return <div className="settings-veil" onPointerDown={e => e.stopPropagation()}>
    <section ref={ref} className="panel settings-page" style={box({ x: Math.floor((L.w - w) / 16) * 8, y: Math.floor((L.h - h) / 16) * 8, w, h })}
      role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} data-testid="settings-page" data-k="sheet">
      <header className="settings-head">
        <h1 id="settings-title">Settings</h1>
        <CloseKey L={L} w={w} onClose={close} label="Close settings" />
      </header>
      <div className="settings-body">
        <div className="music-heading">
          <h2>Music</h2>
          <button type="button" className="skey music-play" data-qa-target aria-label={playing ? 'Pause music' : 'Play music'}
            onClick={() => playing ? music.update({ enabled: false }) : music.play()}>{playing ? 'Pause' : 'Play'}</button>
        </div>
        <div className="music-volume">
          <label htmlFor="music-volume">Volume</label>
          <output htmlFor="music-volume">{preferences.volume}%</output>
          <input id="music-volume" type="range" min="0" max="100" step="1" value={preferences.volume} data-qa-target
            aria-valuetext={`${preferences.volume}%`} onChange={e => music.update({ volume: Number(e.target.value) })} />
        </div>
        <h2 className="music-tracks-title">Tracks</h2>
        <ul className="music-tracks" aria-label="Music tracks">
          {tracks.map(track => <li key={track.id}>
            <button type="button" className="music-track" data-qa-target disabled={!track.unlocked}
              aria-pressed={track.unlocked && preferences.track === track.id}
              aria-label={`${track.title}, ${track.unlocked ? track.tier : `unlock ${track.tier}`}`}
              onClick={() => music.update({ track: track.id })}>
              <span className="music-track-mark" aria-hidden="true">{track.unlocked && preferences.track === track.id ? '●' : '○'}</span>
              <span className="music-track-name">{track.title}</span>
              <span className="music-track-tier">{track.unlocked ? track.tier : `Unlock ${track.tier}`}</span>
            </button>
          </li>)}
        </ul>
        <p className="music-status" role="status">{status === 'error' ? 'Could not load track. Press Play to retry.'
          : status === 'blocked' ? 'Press Play to start music.' : ''}</p>
      </div>
    </section>
  </div>;
}
