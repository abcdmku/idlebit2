import type { ReactNode } from 'react';
import type { SupplyView } from '../../game';
import { genName } from './copy';
import { percent, watts } from './format';
import { PartPlate } from './PartPlate';
import type { Line } from './widgets';
import type { PlateCommon } from './types';

const TITLE: Readonly<Record<SupplyView['kind'], string>> = { pdu: 'PDU', ups: 'UPS', grid: 'Grid' };

/** The supply's allocation, its heat warning above 90% load, and its loss. */
export function supplyLines(s: SupplyView): Line[] {
  const lines: Line[] = s.reservedW === undefined ? [] : [{ text: `Allocated ${watts(s.reservedW)} / ${watts(s.capacityW)} · full load`, tone: 'muted' }];

  if (s.overloadS != null) lines.push({ text: 'Overload · fails in ' + Math.ceil(s.overloadS) + 's', tone: 'warn' });
  else if (s.usage > 0.9) lines.push({ text: 'Over 90%: heat ×1.5', tone: 'warn' });
  lines.push({ text: `Loss ${percent(s.loss)} · ${watts(s.lossW)} of heat`, tone: 'muted' });
  return lines;
}

export interface SupplyPlateProps extends PlateCommon { supply: SupplyView; title?: string; maxLevel?: number; children?: ReactNode }

export function SupplyPlate({ supply: s, title, maxLevel, children, ...common }: SupplyPlateProps) {
  return <PartPlate {...common} beforeKeys className="supply" title={title ?? TITLE[s.kind]} sub={`${genName(s.kind, s.generation)} · L${s.level}`}
    level={s.level} pips={maxLevel ? [s.level, maxLevel] : undefined}
    status={s.capacityW===0?watts(s.deliveredW):`${watts(s.deliveredW)} / ${watts(s.capacityW)}`}
    progress={Math.min(1, s.usage)} lines={supplyLines(s)} lineSlots={2}>{children}</PartPlate>;
}
