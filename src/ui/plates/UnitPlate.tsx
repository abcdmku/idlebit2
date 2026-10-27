import type { ReactNode } from 'react';
import type { ServerSlotView, UnitMode, UnitRef } from '../../game';
import type { MarketState } from './market';
import { OnlineRow } from './OnlineRow';
import { PlateFrame } from './PlateFrame';
import { Key, Status, type Tone } from './widgets';
import type { PlateCommon } from './types';

export interface UnitPlateProps extends Omit<PlateCommon, 'quotes'> {
  unit: UnitRef;
  title: string;
  sub?: string;
  status: string;
  statusTone?: Tone;
  mode: UnitMode;
  timerS: number | null;
  /** The On market toggle; null before Rack (the lone system has none). */
  market: MarketState | null;
  /** Shows "Save this …" (the floppy icon in the world does the same). */
  onSave?: (() => void) | null;
  saveLabel?: string;
  className?: string;
  children?: ReactNode;
}

/** A unit's plate: what it is doing, its market row, and its keys. */
export function UnitPlate({ unit, title, sub, status, statusTone = '', mode, timerS, market, onSave, saveLabel = 'Save configuration',
  className = '', children, onAction, bootS, onResearch: _r, researchName: _n, ...frame }: UnitPlateProps) {
  return <PlateFrame {...frame} title={title} sub={sub} className={`unit ${className}`}>
    <Status text={status} tone={statusTone} />
    {market && <OnlineRow mode={mode} timerS={timerS} bootS={bootS} market={market} onToggle={(online) => onAction({ type: 'setOnline', unit, online })} />}
    <div className="keys">
      {children}
      {onSave && <Key tone="go" label={saveLabel} onPress={onSave} />}
    </div>
  </PlateFrame>;
}

export interface ServerPlateProps extends Omit<PlateCommon, 'quotes'> {
  slot: number;
  servers: readonly ServerSlotView[];
  onGoInside: () => void;
  /** Select another server of the rack by slot. */
  onStep: (slot: number) => void;
  market: MarketState | null;
}

/** Previous and next occupied slots, wrapping (mockup srv-prev / srv-next). */
export function neighbours(servers: readonly ServerSlotView[], slot: number): [number, number] | null {
  const used = servers.map((s, i) => (s.systemId !== null ? i : -1)).filter((i) => i >= 0);
  if (used.length < 2) return null;
  const k = Math.max(0, used.indexOf(slot));
  return [used[(k + used.length - 1) % used.length], used[(k + 1) % used.length]];
}

/** A server in the rack: state, port, online row, Go inside, and ‹ › to step through the rack. */
export function ServerPlate({ slot, servers, onGoInside, onStep, ...common }: ServerPlateProps) {
  const s = servers[slot];
  if (!s || s.systemId === null) return null;
  const nb = neighbours(servers, slot);
  const status = s.running > 0 ? `Running ${s.running} ${s.running === 1 ? 'task' : 'tasks'}` : 'Idle';
  return <UnitPlate {...common} bootS={s.timerTotalS ?? common.bootS} className="server" unit={{ kind: 'system', id: s.systemId }} title={`Server ${slot + 1}`}
    sub={s.kind === 'storageNode' ? 'Storage node' : undefined} status={status}
    mode={s.state} timerS={s.timerS}>
    <div className="key-pair">
      <Key tone="row" label={`‹ Server ${(nb?.[0] ?? slot) + 1}`} ariaLabel="Previous server" disabled={!nb} onPress={() => nb && onStep(nb[0])} />
      <Key tone="row" label={`Server ${(nb?.[1] ?? slot) + 1} ›`} ariaLabel="Next server" disabled={!nb} onPress={() => nb && onStep(nb[1])} />
    </div>
  </UnitPlate>;
}
