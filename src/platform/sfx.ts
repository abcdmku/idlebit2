// Synthesized sound effects: square and triangle tones from the Web Audio API, no asset files.
// Every sound answers one real sim event read from the store; nothing plays on a timer.
import type { GameState, RenderSnapshot } from '../game';
import type { GameStore } from './store';

const KEY = 'idlebit2.sfx';
export interface SfxPreferences { readonly enabled: boolean; readonly volume: number }
export const DEFAULT_SFX: SfxPreferences = { enabled: true, volume: 40 };

const clampVolume = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
function readSfxPreferences(): SfxPreferences {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_SFX;
    const value = saved as Partial<SfxPreferences>;
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SFX.enabled,
      volume: typeof value.volume === 'number' && Number.isFinite(value.volume) ? clampVolume(value.volume) : DEFAULT_SFX.volume,
    };
  } catch { return DEFAULT_SFX; }
}

let preferences: SfxPreferences | null = null;
const watchers = new Set<() => void>();
/** Local preferences, separate from the game save. Settings writes them; the engine follows at once. */
export const sfxPreferences = {
  get: (): SfxPreferences => preferences ??= readSfxPreferences(),
  update(change: Partial<SfxPreferences>): void {
    const now = sfxPreferences.get(), volume = change.volume ?? now.volume;
    if (!Number.isFinite(volume)) return;
    preferences = { enabled: change.enabled ?? now.enabled, volume: clampVolume(volume) };
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(preferences)); } catch { /* Preferences are optional in private mode. */ }
    for (const watcher of [...watchers]) watcher();
  },
  subscribe(watcher: () => void): () => void {
    watchers.add(watcher);
    return () => { watchers.delete(watcher); };
  },
};

export type SfxKind = 'met' | 'failed' | 'roundEnded' | 'milestone' | 'purchase' | 'research';
/** [frequency Hz, start s, length s] */
type Note = readonly [number, number, number];
export interface Voice { readonly wave: OscillatorType; readonly level: number; readonly notes: readonly Note[] }

/** Payout blip pitch by size class: one step per three decimal orders of Credits. */
export const MET_HZ = [659, 784, 880, 988, 1175] as const;
export const VOICES: Readonly<Record<Exclude<SfxKind, 'met'>, Voice>> = {
  failed: { wave: 'square', level: 0.5, notes: [[110, 0, 0.09], [82, 0.09, 0.14]] },
  roundEnded: { wave: 'square', level: 0.5, notes: [[523, 0, 0.1], [392, 0.1, 0.1], [262, 0.2, 0.2]] },
  milestone: { wave: 'square', level: 0.5, notes: [[523, 0, 0.07], [659, 0.07, 0.07], [784, 0.14, 0.07], [1047, 0.21, 0.16]] },
  purchase: { wave: 'square', level: 0.4, notes: [[440, 0, 0.05], [660, 0.05, 0.08]] },
  research: { wave: 'triangle', level: 0.9, notes: [[587, 0, 0.09], [880, 0.09, 0.16]] },
};
export const metVoice = (credits: number): Voice => ({
  wave: 'square', level: 0.3,
  notes: [[MET_HZ[Math.min(MET_HZ.length - 1, Math.floor(Math.log10(Math.max(1, credits)) / 3))]!, 0, 0.06]],
});
/** Sim time between blips: a fleet finishing hundreds of tasks a second sounds at most 4 payouts and 2 failures a second. */
export const MET_GAP_MS = 250, FAIL_GAP_MS = 500;
export const MASTER = 0.3;
/** A note fades in and out over these, so its envelope has no step. */
const ATTACK_S = 0.004, RELEASE_S = 0.01;
/** Time constant of a master level change: the switch, the volume and a hidden page fade, they do not cut. */
const LEVEL_TAU_S = 0.008;

/** Schedules one voice into `out` from `t0`. The live engine and the offline QA render (scripts/qa/sfx-render.mjs) share it. */
export function scheduleVoice(context: BaseAudioContext, out: AudioNode, voice: Voice, t0: number): void {
  for (const [hz, at, length] of voice.notes) {
    const tone = context.createOscillator(), envelope = context.createGain(), start = t0 + at, end = start + length;
    tone.type = voice.wave;
    tone.frequency.value = hz;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(voice.level, start + ATTACK_S);
    envelope.gain.setValueAtTime(voice.level, end - RELEASE_S);
    envelope.gain.linearRampToValueAtTime(0, end);
    tone.connect(envelope);
    envelope.connect(out);
    tone.start(start);
    tone.stop(end);
  }
}
/** Moves the master gain to `level` without a step. */
export function fadeMaster(master: GainNode, level: number, now: number): void {
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(level, now, LEVEL_TAU_S);
}

/** How far the engine has listened: each stream has its own sequence; spending and rewards are lifetime totals. */
interface Heard {
  readonly epoch: number; readonly completion: number; readonly failure: number; readonly event: number;
  readonly reward: number; readonly spent: string;
  /** Sim time of the last payout and failure sound, for the rate limit. */
  readonly metAtMs: number; readonly failAtMs: number;
}
const listen = (s: RenderSnapshot, state: GameState, prev: Heard | null): Heard => ({
  epoch: s.epoch,
  completion: s.completions.reduce((m, c) => Math.max(m, c.seq), prev?.completion ?? 0),
  failure: s.failures.reduce((m, f) => Math.max(m, f.seq), prev?.failure ?? 0),
  event: Math.max(s.lastSeq, prev?.event ?? 0),
  reward: state.roundRewards.highest,
  spent: `${state.ledger.creditsSpent}/${state.ledger.dataSpent}`,
  metAtMs: prev?.metAtMs ?? -Infinity, failAtMs: prev?.failAtMs ?? -Infinity,
});

/** The sounds owed for what happened between `heard` and now, and the new position. Pure. */
export function sfxSince(s: RenderSnapshot, state: GameState, heard: Heard): { readonly sounds: readonly Voice[]; readonly heard: Heard } {
  const next = listen(s, state, heard), sounds: Voice[] = [];
  let { metAtMs, failAtMs } = heard;
  let payout = -1;
  for (const c of s.completions) if (c.seq > heard.completion) payout = Math.max(payout, c.credits);
  if (payout >= 0 && s.simTimeMs - metAtMs >= MET_GAP_MS) { sounds.push(metVoice(payout)); metAtMs = s.simTimeMs; }
  if (next.failure > heard.failure && s.simTimeMs - failAtMs >= FAIL_GAP_MS) { sounds.push(VOICES.failed); failAtMs = s.simTimeMs; }
  let roundEnded = false, research = false;
  for (const e of s.events) {
    if (e.seq <= heard.event) continue;
    if (e.kind === 'roundEnded') roundEnded = true;
    else if (e.kind === 'researchCompleted') research = true;
  }
  if (roundEnded) sounds.push(VOICES.roundEnded);
  if (research) sounds.push(VOICES.research);
  if (next.reward > heard.reward) sounds.push(VOICES.milestone);
  if (next.spent !== heard.spent) sounds.push(VOICES.purchase);
  return { sounds, heard: { ...next, metAtMs, failAtMs } };
}

export interface Sfx { dispose(): void }

/** Browser audio never enters the simulation or its save. Never throws when Web Audio is missing. */
export function createSfx(store: GameStore): Sfx {
  let context: AudioContext | null = null, master: GainNode | null = null, heard: Heard | null = null;
  let disposed = false, wasReady = false;
  const ready = () => { const life = store.getLifecycle(); return life.hydrated && !life.catchingUp; };
  const level = () => { const p = sfxPreferences.get(); return p.enabled && !document.hidden ? p.volume / 100 * MASTER : 0; };
  // The switch, the volume and a hidden page all act on the master gain, so a sounding tail is cut too.
  const setLevel = () => { try { if (context && master) fadeMaster(master, level(), context.currentTime); } catch { /* Audio is optional. */ } };
  const play = (voice: Voice) => {
    if (!context || !master) return;
    try { scheduleVoice(context, master, voice, context.currentTime + 0.01); } catch { /* Audio is optional. */ }
  };
  const onStore = () => {
    if (disposed) return;
    const snapshot = store.getSnapshot(), state = store.getState(), isReady = ready();
    // Loading, catch-up, a reset and anything missed while muted are skipped, never replayed.
    const audible = isReady && wasReady && heard !== null && heard.epoch === snapshot.epoch
      && context !== null && context.state === 'running' && level() > 0;
    wasReady = isReady;
    if (!heard || heard.epoch !== snapshot.epoch) { heard = listen(snapshot, state, null); return; }
    const news = sfxSince(snapshot, state, heard);
    if (!audible) { heard = { ...news.heard, metAtMs: heard.metAtMs, failAtMs: heard.failAtMs }; return; }
    heard = news.heard;
    for (const voice of news.sounds) play(voice);
  };
  const onGesture = (event: Event) => {
    if (disposed || !event.isTrusted || event instanceof KeyboardEvent && (event.ctrlKey || event.metaKey || event.altKey || event.repeat)) return;
    try {
      if (!context) {
        const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Context = g.AudioContext ?? g.webkitAudioContext;
        if (!Context) return;
        context = new Context();
        master = context.createGain();
        master.connect(context.destination);
        master.gain.value = level();
      }
      if (context.state === 'suspended') void context.resume().catch(() => { /* Audio is optional. */ });
    } catch { context = null; master = null; }
  };
  // Deck and dialog controls stop bubbling pointer events; capture the browser gesture first.
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  document.addEventListener('visibilitychange', setLevel);
  const stopPreferences = sfxPreferences.subscribe(setLevel), stopStore = store.subscribe(onStore);
  onStore();
  return {
    dispose() {
      disposed = true; stopStore(); stopPreferences();
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      document.removeEventListener('visibilitychange', setLevel);
      try { void context?.close().catch(() => { /* Audio is optional. */ }); } catch { /* Audio is optional. */ }
      context = null; master = null;
    },
  };
}
