import { useLayoutEffect, useRef } from 'react';
import { selectMusicTracks, type MusicTrackView } from '../../game';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { closeTopmost } from '../shell/backGuard';
import { CloseKey } from '../shell/CloseKey';
import { useLayout } from '../shell/geometry';
import { shallowEqual, useGameSelector, useShell, useViewState } from '../storeHooks';
import { SaveSettings } from './SaveSettings';
import { SfxSettings } from './SfxSettings';
import { useMusic } from './useMusic';
import '../styles/settings.css';

type MusicControls = ReturnType<typeof useMusic>;

/** The shell's global keys (GameShell `useHotkeys`), in the order a player meets them. */
const SHORTCUTS: readonly { readonly keys: readonly string[]; readonly does: string }[] = [
  { keys: ['R'], does: 'Research' },
  { keys: ['+', '−'], does: 'Zoom' },
  { keys: ['Esc'], does: 'Close' },
];

export function SettingsScreen() {
  const music = useMusic(), state = useViewState();
  const unlocked = useGameSelector(s => s.unlocked, shallowEqual);
  return state.sheet === 'settings' ? <OpenSettings music={music} tracks={selectMusicTracks({ unlocked })} /> : null;
}

function OpenSettings({ music, tracks }: { music: MusicControls; tracks: readonly MusicTrackView[] }) {
  const ref = useRef<HTMLElement>(null), L = useLayout(), shell = useShell();
  // Escape first cancels an armed Import or Reset; the Close key always closes.
  useDialogFocus(ref, () => { closeTopmost(shell); });
  // Shortcuts need a keyboard: shown on the desktop layout with a mouse, never on touch-only screens.
  const keyboard = useMediaQuery('(hover: hover) and (pointer: fine)') && L.kind === 'desktop';
  const inset = L.kind === 'desktop' ? L.lat : 8;
  const wide = L.w - 2 * inset >= 640;
  const w = Math.min(wide ? 752 : 560, L.w - 2 * inset), h = L.h - 2 * inset;
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const align = () => {
      const x = (L.w - w) / 2, y = (L.h - panel.offsetHeight) / 2;
      panel.style.transform = `translate(${Math.floor(x / 8) * 8 - x}px, ${Math.floor(y / 8) * 8 - y}px)`;
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [L.w, L.h, w]);
  const { preferences, status } = music;
  const playing = status === 'playing';
  return <div className="settings-veil" onPointerDown={e => e.stopPropagation()}>
    <section ref={ref} className="panel settings-page" style={{ width: w, maxHeight: h }}
      role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} data-testid="settings-page" data-k="sheet">
      <header className="settings-head">
        <h1 id="settings-title">Settings</h1>
        <CloseKey L={L} w={w} onClose={() => shell.view.dispatch({ type: 'back' })} label="Close settings" />
      </header>
      <div className={`settings-body${wide ? ' wide' : ''}`}>
        <section className="settings-section settings-music">
          <div className="music-heading">
            <h2>Music</h2>
            <p className="music-status" role="status">{status === 'error' ? 'Track failed. Press Play.' : status === 'blocked' ? 'Press Play to start.' : ''}</p>
            <button type="button" className="skey music-play" data-qa-target aria-label={playing ? 'Pause music' : 'Play music'}
              onClick={() => playing ? music.update({ enabled: false }) : music.play()}>{playing ? 'Pause' : 'Play'}</button>
          </div>
          <div className="music-volume">
            <label htmlFor="music-volume">Volume</label>
            <output htmlFor="music-volume">{preferences.volume}%</output>
            <input id="music-volume" type="range" min="0" max="100" step="1" value={preferences.volume} data-qa-target
              aria-valuetext={`${preferences.volume}%`} onChange={e => music.update({ volume: Number(e.target.value) })} />
          </div>
        </section>
        <section className="settings-section settings-effects"><SfxSettings /></section>
        <section className="settings-section settings-tracks" aria-labelledby="settings-tracks-title">
          <h2 id="settings-tracks-title">Tracks</h2>
          <ul className="music-tracks">
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
        </section>
        {keyboard && <section className="settings-section settings-controls" aria-labelledby="settings-controls-title">
          <h2 id="settings-controls-title">Keys</h2>
          <dl className="shortcuts">
            {SHORTCUTS.map(s => <div key={s.does}>
              <dt>{s.keys.map(k => <kbd key={k}>{k}</kbd>)}</dt><dd>{s.does}</dd>
            </div>)}
          </dl>
        </section>}
        <SaveSettings />
      </div>
    </section>
  </div>;
}
