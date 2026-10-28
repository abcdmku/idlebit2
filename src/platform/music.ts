import { selectMusicTracks, type LevelId } from '../game';
import type { GameStore } from './store';
import { readMusicPreferences, writeMusicPreferences, type MusicPreferences } from './musicPreferences';

const FILES: Readonly<Record<LevelId, string>> = {
  chip: 'clock-tones.mp3', system: 'system-handshake.mp3', rack: 'rack-mount.mp3',
  room: 'dial-tone.mp3', global: 'global-bit.mp3',
};
export type MusicStatus = 'ready' | 'playing' | 'paused' | 'blocked' | 'error';
export interface MusicSnapshot { readonly preferences: MusicPreferences; readonly status: MusicStatus }
export interface MusicPlayer {
  getSnapshot(): MusicSnapshot;
  update(change: Partial<MusicPreferences>): void;
  play(): void;
  visitLevel(level: LevelId): void;
  dispose(): void;
}

/** Browser audio and preferences never enter the simulation or its save. */
export function createMusicPlayer(store: GameStore, onChange: (snapshot: MusicSnapshot) => void): MusicPlayer {
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'none';
  let preferences = readMusicPreferences(), status: MusicStatus = preferences.enabled ? 'ready' : 'paused';
  let source: LevelId | null = null, disposed = false, interacted = false, pending = false, generation = 0;
  const snapshot = (): MusicSnapshot => ({ preferences, status });
  const setStatus = (next: MusicStatus) => { if (disposed || next === status) return; status = next; onChange(snapshot()); };
  const available = (id: LevelId) => selectMusicTracks(store.getSnapshot()).some(t => t.id === id && t.unlocked);
  const ready = () => { const life = store.getLifecycle(); return life.hydrated && !life.catchingUp; };
  const persist = (next: MusicPreferences) => { preferences = next; writeMusicPreferences(next); onChange(snapshot()); };
  const pause = () => { generation += 1; pending = false; audio.pause(); };
  const play = () => {
    if (disposed || !ready() || !preferences.enabled || document.hidden || !source || pending || !audio.paused) return;
    const request = ++generation;
    pending = true;
    void audio.play().then(() => {
      if (!disposed && request === generation) { pending = false; setStatus('playing'); }
    }).catch((error: unknown) => {
      if (disposed || request !== generation) return;
      pending = false;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus(error instanceof DOMException && error.name === 'NotAllowedError' ? 'blocked' : 'error');
    });
  };
  const sync = () => {
    if (disposed) return;
    if (!ready()) { pause(); setStatus(preferences.enabled ? 'ready' : 'paused'); return; }
    if (!available(preferences.track)) persist({ ...preferences, track: 'chip' });
    if (source !== preferences.track) {
      pause(); source = preferences.track;
      audio.src = `${import.meta.env.BASE_URL}assets/music/${FILES[source]}`;
      setStatus(preferences.enabled ? 'ready' : 'paused');
    }
    audio.volume = preferences.volume / 100;
    if (!preferences.enabled || document.hidden) {
      pause(); setStatus(preferences.enabled ? 'ready' : 'paused');
    } else if (interacted && status !== 'error') play();
  };
  const onGesture = (event: Event) => {
    if (!event.isTrusted || event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey || event.altKey || event.repeat)) return;
    interacted = true;
    if (status !== 'error') play();
  };
  const onError = () => { pending = false; setStatus('error'); };
  const onPlaying = () => setStatus('playing');
  audio.addEventListener('error', onError);
  audio.addEventListener('playing', onPlaying);
  // Deck and dialog controls stop bubbling pointer events; capture the browser gesture first.
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  document.addEventListener('visibilitychange', sync);
  const stop = store.subscribe(sync);
  sync(); onChange(snapshot());
  return {
    getSnapshot: snapshot,
    visitLevel(level) {
      if (disposed || !ready() || !available(level) || preferences.introduced.includes(level)) return;
      persist({ ...preferences, track: level, introduced: [...preferences.introduced, level] });
      sync();
    },
    update(change) {
      if (disposed || change.track && !available(change.track)) return;
      const volume = change.volume ?? preferences.volume;
      if (!Number.isFinite(volume)) return;
      persist({ ...preferences, ...change, volume: Math.round(Math.max(0, Math.min(100, volume))) });
      sync();
    },
    play() {
      if (disposed) return;
      interacted = true;
      persist({ ...preferences, enabled: true });
      if (status === 'error') { audio.load(); setStatus('ready'); }
      sync(); play();
    },
    dispose() {
      disposed = true; pause(); stop();
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('visibilitychange', sync);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('playing', onPlaying);
      audio.removeAttribute('src'); audio.load();
    },
  };
}
