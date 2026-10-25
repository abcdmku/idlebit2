import type { UnitMode } from '../../game';
import { marketKey, marketLine, type MarketState } from './market';

export type OnlineState = 'online' | 'offline' | 'paused' | 'going-online' | 'going-offline' | 'booting' | 'cold' | 'crashed';

/** The row's state for a unit mode. `boot` after an offline toggle reads as "Going online". */
export function onlineState(mode: UnitMode, added = false): OnlineState {
  switch (mode) {
    case 'onMarket': case 'asleep': return 'online';
    case 'paused': return 'paused';
    case 'boot': return added ? 'booting' : 'going-online';
    case 'goingOffline': case 'draining': return 'going-offline';
    case 'cold': return 'cold';
    case 'crashed': case 'dark': return 'crashed';
    // D31: standby (held off by a start controller) reads as offline until its controller wakes it.
    case 'offline': case 'empty': case 'standby': return 'offline';
  }
}

const WORDS: Readonly<Record<OnlineState, string>> = {
  online: 'Online', paused: 'Paused', offline: 'Offline', 'going-online': 'Going online', 'going-offline': 'Going offline',
  booting: 'Booting', cold: 'Swapping', crashed: 'Down',
};

export interface OnlineRowProps {
  mode: UnitMode;
  /** Seconds left in boot, goingOffline or cold; null otherwise. */
  timerS: number | null;
  /** The current boot time (10 s base, Fast boot lowers it). The 10 pips drain over it. */
  bootS?: number;
  /** A unit added mid-round boots rather than "goes online". */
  added?: boolean;
  market: MarketState;
  onToggle: (online: boolean) => void;
}

/**
 * The market row: what the unit is doing, ten pips draining in real time through a switch, boot or
 * swap, and the "On market" toggle key. Fixed height; the key never moves between states.
 */
export function OnlineRow({ mode, timerS, bootS = 10, added, market, onToggle }: OnlineRowProps) {
  const state = onlineState(mode, added);
  const left = Math.max(0, timerS ?? 0);
  const lit = Math.min(10, Math.ceil((left / Math.max(0.001, bootS)) * 10 - 1e-9));
  const moving = state === 'going-online' || state === 'going-offline' || state === 'booting' || state === 'cold';
  const label = marketKey(market);
  return <div className="p-online" data-state={state} data-market={market.on ? 'on' : 'off'}>
    <span className="sw-t"><b>{WORDS[state]}{moving && timerS !== null ? ` · ${Math.ceil(left)} s` : ''}</b>
      <span className="sw-pips" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}</span></span>
    <span className="sw-s">{state === 'crashed' ? 'Reboots on its own' : marketLine(market)}</span>
    <button type="button" className="mk" aria-pressed={market.on} data-qa-target disabled={state === 'cold' || state === 'crashed'}
      aria-label={`${label}, tap to ${market.on ? 'take it off' : 'put it on'}`}
      onClick={(e) => { e.stopPropagation(); onToggle(!market.on); }}>{label}</button>
  </div>;
}
