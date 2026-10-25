import type { UnitMode } from '../../game';

export type OnlineState = 'online' | 'offline' | 'paused' | 'going-online' | 'going-offline' | 'booting' | 'cold' | 'crashed';

/** The switch row's state for a unit mode. `boot` after an offline toggle reads as "Going online". */
export function onlineState(mode: UnitMode, added = false): OnlineState {
  switch (mode) {
    case 'onMarket': case 'asleep': return 'online';
    case 'paused': return 'paused';
    case 'boot': return added ? 'booting' : 'going-online';
    case 'goingOffline': case 'draining': return 'going-offline';
    case 'cold': return 'cold';
    case 'crashed': case 'dark': return 'crashed';
    case 'offline': case 'empty': return 'offline';
  }
}

const WORDS: Readonly<Record<OnlineState, readonly [string, string | null]>> = {
  online: ['Online', 'On the market'],
  paused: ['Online', 'Paused between rounds'],
  offline: ['Offline', 'Off the market'],
  'going-online': ['Going online', null],
  'going-offline': ['Going offline', null],
  booting: ['Booting', null],
  cold: ['Swapping', null],
  crashed: ['Down', 'Reboots on its own'],
};

export interface OnlineRowProps {
  mode: UnitMode;
  /** Seconds left in boot, goingOffline or cold; null otherwise. */
  timerS: number | null;
  /** The current boot time (10 s base, Fast boot lowers it). The 10 pips drain over it. */
  bootS?: number;
  /** A unit added mid-round boots rather than "goes online". */
  added?: boolean;
  onToggle: (online: boolean) => void;
}

/**
 * Online switch row (mockup core/plate.js onlineRow). Fixed height: the switch never moves.
 * Ten pips drain in real time while a switch, boot or cold change is in progress.
 */
export function OnlineRow({ mode, timerS, bootS = 10, added, onToggle }: OnlineRowProps) {
  const state = onlineState(mode, added);
  const [word, sub] = WORDS[state];
  const left = Math.max(0, timerS ?? 0);
  const lit = Math.min(10, Math.ceil((left / Math.max(0.001, bootS)) * 10 - 1e-9));
  const settled = state === 'online' || state === 'offline' || state === 'paused';
  const on = state === 'online' || state === 'paused';
  return <div className="p-online" data-state={state}>
    <button type="button" className="sw" role="switch" aria-checked={on} disabled={!settled}
      aria-label={`${word}${settled ? ', tap to switch' : ''}`}
      onClick={(e) => { e.stopPropagation(); if (settled) onToggle(!on); }}><i className="knob" /></button>
    <span className="sw-t"><b>{word}</b><span>{sub ?? `${Math.ceil(left)} s`}</span></span>
    <span className="sw-pips" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}</span>
  </div>;
}
