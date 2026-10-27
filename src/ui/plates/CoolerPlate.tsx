import { SETPOINT_MIN_F, SETPOINT_MAX_F, type CoolerView, type RackId, type RoomId } from '../../game';
import { COOL_TECH, genName } from './copy';
import { fahrenheit, percent, watts } from './format';
import { PartPlate } from './PartPlate';
import { LockIcon } from './icons';
import type { Line } from './widgets';
import type { PlateCommon } from './types';

/** Crash after 10 s at or above 100 °F; reboot below 90 °F (program §8). */
export const CRASH_F = 100, CRASH_S = 10, REBOOT_BELOW_F = 90;
export { SETPOINT_MIN_F, SETPOINT_MAX_F };
export const SETPOINT_STEP_F = 2;

export interface LumpView { tempF: number; crashS: number; crashed: boolean; eff?: number; outsideF?: number }
export type CoolerUnit = { readonly kind: 'rack'; readonly id: RackId } | { readonly kind: 'room'; readonly id: RoomId };

export function coolerLines(c: CoolerView, lump: LumpView): Line[] {
  const T = Math.round(lump.tempF), hot: Line[] = [];
  if (lump.crashed) hot.push({ text: `Crashed. Reboots after ${CRASH_S} s once below ${REBOOT_BELOW_F}°F`, tone: 'warn' });
  else if (lump.crashS > 0) hot.push({ text: `At ${CRASH_F}°F: crash in ${Math.max(0, Math.ceil(CRASH_S - lump.crashS))} s`, tone: 'warn' });
  else if (T > 80 && lump.eff != null) hot.push({ text: `Over 80°F: servers at ${percent(lump.eff)}`, tone: 'warn' });
  else if (Math.round(c.equilibriumF) !== T) hot.push({ text: `Settles at ${fahrenheit(c.equilibriumF)}`, tone: 'muted' });
  return [...hot,
    { text: `Removes up to ${watts(c.capacityW)} · draws ${watts(c.watts)}`, tone: 'muted' },
    { text: c.setpointF != null ? `Fans ${percent(c.duty)}` : '', tone: 'muted' }];
}

export interface CoolerPlateProps extends PlateCommon { unit: CoolerUnit; cooler: CoolerView; lump: LumpView; maxLevel?: number }

/** Rack or room cooling: °F, technology and generation, and the setpoint once researched. */
export function CoolerPlate({ unit, cooler: c, lump, maxLevel, ...common }: CoolerPlateProps) {
  const T = Math.round(lump.tempF);
  const status = lump.eff != null && lump.eff < 1 ? `${fahrenheit(T)} · efficiency ${percent(lump.eff)}`
    : `${fahrenheit(T)}${lump.outsideF != null ? ` · outside ${fahrenheit(lump.outsideF)}` : ''}`;
  const setQuote = common.quotes?.quotes.find((q) => q.action.type === 'setSetpoint');
  const set = (f: number) => common.onAction({ type: 'setSetpoint', unit, setpointF: Math.max(SETPOINT_MIN_F, Math.min(SETPOINT_MAX_F, f)) });
  return <PartPlate {...common} className="cooler" title={`${COOL_TECH[c.tech]} cooling`} sub={`${genName(unit.kind === "rack" ? "rackCooler" : "roomCooler", c.generation)} · L${c.level}`}
    level={c.level} pips={maxLevel ? [c.level, maxLevel] : undefined} status={status} statusTone={T > 80 || lump.crashed ? 'warn' : ''}
    lines={coolerLines(c, lump).filter(l => l.text)} lineSlots={2} beforeKeys>
    {c.setpointF != null
      ? <div className="setpoint" role="group" aria-label="Setpoint">
        <span>Setpoint</span>
        <button type="button" className="step" aria-label="Lower setpoint" disabled={c.setpointF <= SETPOINT_MIN_F}
          onClick={() => set(c.setpointF! - SETPOINT_STEP_F)}>−</button>
        <b aria-live="polite">{fahrenheit(c.setpointF)}</b>
        <button type="button" className="step" aria-label="Raise setpoint" disabled={c.setpointF >= SETPOINT_MAX_F}
          onClick={() => set(c.setpointF! + SETPOINT_STEP_F)}>+</button>
      </div>
      : setQuote?.locked
        ? <div className="setpoint lock"><span>Setpoint</span><small><LockIcon /> {setQuote.locked.text}</small></div>
        : null}
  </PartPlate>;
}
