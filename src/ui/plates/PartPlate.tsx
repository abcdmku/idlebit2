import { type ReactNode } from 'react';
import { PlateFrame } from './PlateFrame';
import { PartKeys, generationKey, partLevel } from './PartKeys';
import type { Quote } from '../../game';
import { Bar, Lines, type Line, type Tone } from './widgets';
import type { PlateCommon } from './types';

export interface PartPlateProps extends PlateCommon {
  title: string;
  sub: string;
  level: number;
  /** Level pips: [level, ceiling]. */
  pips?: readonly [number, number];
  /** The live usage or state, inline on the title line. */
  status: string;
  statusTone?: Tone;
  progress?: number | null;
  /** Current facts only; empty rows are omitted. */
  lines?: readonly Line[];
  lineSlots?: number;
  className?: string;
  /** Widgets between the facts and the keys (setpoint, online row). */
  children?: ReactNode;
  extraFooter?: ReactNode;
  beforeKeys?: boolean;
  compactStatus?: boolean;
  /** Tasks in the line blocked on what this part supplies (QA-21). */
  unblocks?: number;
  /** The minimal-level buy that lets the first of them run (the sim's meet line). */
  unblock?: Quote | null;
}

/** Any part with an upgrade-versus-replace choice: board parts, supplies, coolers, links. */
export function PartPlate({ title, sub, level, pips, status, statusTone = '', progress, lines = [], lineSlots = 0,
  className = '', children, extraFooter, beforeKeys: _beforeKeys = false, compactStatus: _compact = false, quotes, onAction, onResearch, researchName,
  unblocks: _unblocks, unblock: _unblock, ...frame }: PartPlateProps) {
  const keys = { quotes, level, onAction, onResearch, researchName };
  const main = partLevel(quotes?.quotes ?? [], level);
  // The component's upgrade stays pinned. Stats and limits live inside its fixed-height key.
  return <PlateFrame {...frame} title={title} sub={sub} usage={status} usageTone={statusTone} pips={pips} className={`part ${className}`}
    generation={generationKey(keys)}
    footer={extraFooter ? <div className="memory-upgrades">{main && <PartKeys {...keys} />}{extraFooter}</div> : main && <PartKeys {...keys} />}>
    {progress != null && <Bar progress={progress} tone={statusTone} label={status} />}
    <Lines lines={lines} slots={lineSlots} />
    {children}
  </PlateFrame>;
}
