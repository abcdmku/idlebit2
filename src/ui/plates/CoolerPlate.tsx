import { SETPOINT_MIN_F, SETPOINT_MAX_F, type CoolerView, type RackId, type RoomId } from '../../game';
import { genName } from './copy';
import { fahrenheit, percent, watts } from './format';
import { PartPlate } from './PartPlate';
import type { Line } from './widgets';
import type { PlateCommon } from './types';

export { SETPOINT_MIN_F, SETPOINT_MAX_F };
export const SETPOINT_STEP_F = 2;

export interface LumpView { tempF: number; crashS: number; crashed: boolean; eff?: number; outsideF?: number }
export type CoolerUnit = { readonly kind: 'rack'; readonly id: RackId } | { readonly kind: 'room'; readonly id: RoomId };

export function coolerLines(c: CoolerView, _lump: LumpView): Line[] {
  return [{ text: 'Cooling ' + watts(c.capacityW) + ' \u00b7 Power ' + watts(c.watts), tone: 'muted' }];
}

export interface CoolerPlateProps extends PlateCommon { unit: CoolerUnit; cooler: CoolerView; lump: LumpView; maxLevel?: number }

/** Rack or room cooling: °F, technology and generation, and the setpoint once researched. */
export function CoolerPlate({ unit, cooler: c, lump, maxLevel, ...common }: CoolerPlateProps) {
  const T = Math.round(lump.tempF);
  const status = lump.eff != null && lump.eff < 1 ? `${fahrenheit(T)} · efficiency ${percent(lump.eff)}`
    : `${fahrenheit(T)}${lump.outsideF != null ? ` · outside ${fahrenheit(lump.outsideF)}` : ''}`;
  const set = (f: number) => common.onAction({ type: 'setSetpoint', unit, setpointF: Math.max(SETPOINT_MIN_F, Math.min(SETPOINT_MAX_F, f)) });
  return <PartPlate {...common} className="cooler" title="Cooling" sub={`${genName(unit.kind === "rack" ? "rackCooler" : "roomCooler", c.generation)} · L${c.level}`}
    level={c.level} pips={maxLevel ? [c.level, maxLevel] : undefined} status={status} statusTone={T > 80 ? 'warn' : ''}
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
      : null}
  </PartPlate>;
}
