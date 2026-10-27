import type { ReactNode } from 'react';
import type { SupplyView } from '../../game';
import { genName } from './copy';
import { percent, watts } from './format';
import { PartPlate } from './PartPlate';
import type { Line } from './widgets';
import type { PlateCommon } from './types';

/** A supply fails at 10 accumulated overload seconds (program §7). */
export const OVERLOAD_FAIL_S = 10;
const TITLE: Readonly<Record<SupplyView['kind'], string>> = { psu: 'Power supply', pdu: 'PDU', ups: 'UPS', grid: 'Grid' };

/** The overload timer appears only once it is nonzero; a failed supply shows its reboot. */
export function supplyLines(s: SupplyView): Line[] {
  const lines: Line[] = [];
  if(s.kind==='psu'&&s.capacityW===0)return [{text:'No supply limit until Rack',tone:'muted'}];
  if (s.failed) lines.push({ text: `Failed · reboots in ${Math.ceil((s.rebootMs ?? 0) / 1000)} s`, tone: 'warn' });
  else if (s.overloadS > 0 && s.usage > 1) lines.push({ text: `Overloaded · fails in ${Math.max(0, Math.ceil(OVERLOAD_FAIL_S - s.overloadS))} s`, tone: 'warn' });
  else if (s.overloadS > 0) lines.push({ text: `Overload clearing · ${Math.ceil(s.overloadS)} s left`, tone: 'warn' });
  else if (s.usage > 0.9) lines.push({ text: 'Over 90%: heat ×1.5', tone: 'warn' });
  lines.push({ text: `Loss ${percent(s.loss)} · ${watts(s.lossW)} of heat${s.capped ? ` · capped at ${percent(s.capFactor)}` : ''}`, tone: 'muted' });
  return lines;
}

export interface SupplyPlateProps extends PlateCommon { supply: SupplyView; title?: string; maxLevel?: number; children?: ReactNode }

export function SupplyPlate({ supply: s, title, maxLevel, children, ...common }: SupplyPlateProps) {
  return <PartPlate {...common} beforeKeys className="supply" title={title ?? TITLE[s.kind]} sub={`${genName(s.kind, s.generation).replace(/ power supply$/, '')} · L${s.level}`}
    level={s.level} pips={maxLevel ? [s.level, maxLevel] : undefined}
    status={s.capacityW===0?watts(s.deliveredW):`${watts(s.deliveredW)} / ${watts(s.capacityW)} · ${percent(s.usage)}`}
    statusTone={s.failed || s.usage > 1 ? 'warn' : ''} progress={Math.min(1, s.usage)} lines={supplyLines(s)} lineSlots={2}>{children}</PartPlate>;
}
