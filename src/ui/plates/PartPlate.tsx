import type { ReactNode } from 'react';
import { PlateFrame } from './PlateFrame';
import { PartKeys } from './PartKeys';
import { MeetKey } from '../queue/MeetKey';
import type { Quote } from '../../game';
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
  /** Tasks in the line blocked on what this part supplies (QA-21). */
  unblocks?: number;
  /** The minimal-level buy that lets the first of them run (the sim's meet line). */
  unblock?: Quote | null;
}

/** Any part with an upgrade-versus-replace choice: board parts, supplies, coolers, links. */
export function PartPlate({ title, sub, level, pips, status, statusTone = '', progress, lines = [], lineSlots = 2,
  className = '', children, quotes, onAction, onResearch, researchName, unblocks, unblock, ...frame }: PartPlateProps) {
  return <PlateFrame {...frame} title={title} sub={sub} pips={pips} className={`part ${className}`}>
    <Status text={status} tone={statusTone} progress={progress} />
    <Lines lines={lines} slots={lineSlots} />
    {children}
    {unblock && <div className="keys"><MeetKey quote={unblock} n={frame.bounds ? 3 : 2} onAction={onAction} onResearch={onResearch} researchName={researchName} /></div>}
    <PartKeys quotes={quotes} level={level} onAction={onAction} onResearch={onResearch} researchName={researchName} unblocks={unblocks} />
  </PlateFrame>;
}
