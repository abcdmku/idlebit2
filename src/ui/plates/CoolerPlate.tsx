import { SETPOINT_MIN_F, SETPOINT_MAX_F, researchId, type CoolerView, type RackId, type RoomId } from '../../game';
import { genName } from './copy';
import { fahrenheit, percent, watts } from './format';
import { LockIcon } from './icons';
import { PartPlate } from './PartPlate';
import type { Line } from './widgets';
import type { PlateCommon } from './types';

export { SETPOINT_MIN_F, SETPOINT_MAX_F };
export const SETPOINT_STEP_F = 1;
/** The research that opens each cooler's thermostat, and its name where the plate's name table has none. */
const THERMOSTAT = { rack: { node: researchId('rackVarSpeed'), name: 'Fan control' }, room: { node: researchId('roomVarSpeed'), name: 'Chiller VFD' } } as const;

export interface LumpView { tempF: number; eff?: number; outsideF?: number }
export type CoolerUnit = { readonly kind: 'rack'; readonly id: RackId } | { readonly kind: 'room'; readonly id: RoomId };

export function coolerLines(c: CoolerView, _lump: LumpView): Line[] {
  return [{ text: 'Cooling ' + watts(c.capacityW) + ' \u00b7 Power ' + watts(c.watts) + ' \u00b7 duty ' + percent(c.duty), tone: 'muted' }];
}

export interface CoolerPlateProps extends PlateCommon { unit: CoolerUnit; cooler: CoolerView; lump: LumpView; maxLevel?: number }

/**
 * Rack or room cooling: °F, technology and generation, and its thermostat. The thermostat is a slider over the
 * setpoint range: colder runs the chips faster and costs more cooling power, warmer saves it. Before its research
 * it is a locked row that opens that project.
 */
export function CoolerPlate({ unit, cooler: c, lump, maxLevel, ...common }: CoolerPlateProps) {
  const T = Math.round(lump.tempF), lock = THERMOSTAT[unit.kind];
  const status = lump.eff != null && lump.eff < 1 ? `${fahrenheit(T)} · efficiency ${percent(lump.eff)}`
    : `${fahrenheit(T)}${lump.outsideF != null ? ` · outside ${fahrenheit(lump.outsideF)}` : ''}`;
  const set = (f: number) => common.onAction({ type: 'setSetpoint', unit, setpointF: Math.max(SETPOINT_MIN_F, Math.min(SETPOINT_MAX_F, f)) });
  const listed = common.researchName?.(lock.node), project = listed && listed !== lock.node ? listed : lock.name;
  return <PartPlate {...common} className="cooler" title="Cooling" sub={`${genName(unit.kind === "rack" ? "rackCooler" : "roomCooler", c.generation)} · L${c.level}`}
    level={c.level} pips={maxLevel ? [c.level, maxLevel] : undefined} status={status} statusTone={T > 80 ? 'warn' : ''}
    lines={coolerLines(c, lump).filter(l => l.text)} lineSlots={2} beforeKeys>
    {c.setpointF != null
      ? <div className="thermostat" role="group" aria-label="Thermostat">
        <label className="range-setting"><span>Thermostat</span>
          <input type="range" aria-label="Thermostat setpoint" min={SETPOINT_MIN_F} max={SETPOINT_MAX_F} step={SETPOINT_STEP_F} value={c.setpointF}
            onChange={e => set(Number(e.currentTarget.value))} />
          <output aria-live="polite">{fahrenheit(c.setpointF)}</output></label>
      </div>
      : <button type="button" className="cx-tog lock thermostat-lock" disabled={!common.onResearch} aria-label={`Thermostat, locked. Research ${project}`}
        onClick={(e) => { e.stopPropagation(); common.onResearch?.(lock.node); }}>
        <i className="lock-well"><LockIcon /></i><span>Thermostat<small>Research {project}</small></span>
      </button>}
  </PartPlate>;
}
