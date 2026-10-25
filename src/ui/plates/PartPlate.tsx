import type { ReactNode } from 'react';
import { PlateFrame } from './PlateFrame';
import { PartKeys } from './PartKeys';
import { Lines, Status, type Line, type Tone } from './widgets';
import type { PlateCommon } from './types';

export interface PartPlateProps extends PlateCommon {
  title: string;
  sub: string;
  level: number;
  /** Level pips: [level, ceiling]. */
  pips?: readonly [number, number];
  status: string;
  statusTone?: Tone;
  progress?: number | null;
  /** Up to `lineSlots` lines; empty slots keep their height. */
  lines?: readonly Line[];
  lineSlots?: number;
  className?: string;
  /** Widgets between the facts and the keys (setpoint, online row). */
  children?: ReactNode;
}

/** Any part with an upgrade-versus-replace choice: board parts, supplies, coolers, links. */
export function PartPlate({ title, sub, level, pips, status, statusTone = '', progress, lines = [], lineSlots = 2,
  className = '', children, quotes, onAction, onResearch, researchName, ...frame }: PartPlateProps) {
  return <PlateFrame {...frame} title={title} sub={sub} pips={pips} className={`part ${className}`}>
    <Status text={status} tone={statusTone} progress={progress} />
    <Lines lines={lines} slots={lineSlots} />
    {children}
    <PartKeys quotes={quotes} level={level} onAction={onAction} onResearch={onResearch} researchName={researchName} />
  </PlateFrame>;
}
