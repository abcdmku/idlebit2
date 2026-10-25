import { DT_S, FLOOR_TEMP_F, HOME_TEMP_F, REGIONS, SETTLE_EPS_F } from '../core/constants';
import type { CompiledBuffers, HotBuffers } from '../core/buffers';
import type { World } from '../core/world';
import { COOLER_DELTA_F, ECONOMIZER_MARGIN_F, ECONOMIZER_WATTS, LIFT_BELOW_F, LIFT_PER_F } from './constants';
import { efficiency, rackHealth, roomHealth } from './efficiency';
import { zoneDark } from './modes';
import { scratch } from './scratch';
import { physSettings, type PhysSettings } from './settings';

/* ---------- The lump equation (spec §10.5) ---------- */

export interface LumpStep {
  /** Equilibrium for these inputs. */
  teq: number;
  /** Temperature at the end of the tick, floored at 50 °F and snapped within 0.05 °F of Teq. */
  next: number;
  /** W leaving the lump into its surroundings, from start-of-tick temperatures. */
  moved: number;
  /** Total conductance Gc + Gp, W/°F: how hard the lump's surroundings follow it. */
  g: number;
}
const step: LumpStep = { teq: 0, next: 0, moved: 0, g: 0 };

/**
 * One tick of a lump: cooler conductance Gc = d·Qc/ΔT to the supply air Tsurround − ΔT, leak
 * Gp = leak·Qc/ΔT to the surroundings, exponential approach to Teq with time constant τ.
 * A lump with no conductance (no cooler compiled) holds its temperature. Reused output object.
 *
 * `coupledG` is the conductance of the lumps that dump into this one (a zone's racks). Their
 * outflow is fixed for the tick at start-of-tick temperatures, but it falls as this lump warms:
 * with all of it counted, the lump can only reach T* = T + (Teq − T)·g/(g + coupledG) this tick.
 * When racks conduct far more than the zone (g·τ/dt ≪ coupledG), a plain step would overshoot
 * T* every tick, the floor would absorb the swing and the pair would diverge to ±∞ and NaN. So
 * the step stops at T*. The cap binds only in that stiff regime; otherwise the step is unchanged.
 */
export function lumpStep(tempF: number, heatW: number, qc: number, duty: number, leak: number, tauS: number, surroundF: number, coupledG = 0): LumpStep {
  const unit = qc / COOLER_DELTA_F;
  const gc = duty * unit, gp = leak * unit;
  const supplyF = surroundF - COOLER_DELTA_F;
  const g = gc + gp;
  step.g = g;
  if (!(g > 0)) {
    step.teq = tempF; step.next = tempF; step.moved = 0;
    return step;
  }
  const teq = (heatW + gc * supplyF + gp * surroundF) / g;
  const decay = tauS > 0 ? Math.exp(-DT_S / tauS) : 0;
  let next = tauS > 0 ? teq + (tempF - teq) * decay : teq;
  if (coupledG > 0) {
    const reach = g / (g + coupledG);
    if (1 - decay > reach) next = tempF + (teq - tempF) * reach;
  }
  step.teq = teq;
  if (Math.abs(next - teq) < SETTLE_EPS_F) {
    // Settled: the lump passes on exactly its heat input, which is what `moved` equals at T = Teq.
    // Using the formula with a snapped T would feed the ±0.05 °F snap error into the zone lump,
    // and coupled rack and zone lumps would trade it back and forth forever instead of settling.
    step.next = Math.max(FLOOR_TEMP_F, teq);
    step.moved = heatW;
    return step;
  }
  step.next = Math.max(FLOOR_TEMP_F, next);
  step.moved = gc * (tempF - supplyF) + gp * (tempF - surroundF);
  return step;
}

/** Equilibrium temperature for the given inputs (the cooler plate's Teq, spec §10.6). */
export const lumpEquilibrium = (heatW: number, qc: number, duty: number, leak: number, surroundF: number): number =>
  lumpStep(surroundF, heatW, qc, duty, leak, 0, surroundF).teq;

/** Variable-speed duty that holds setpoint S (spec §10.5), clamped to [0, 1]. */
export function setpointDuty(heatW: number, qc: number, leak: number, setpointF: number, surroundF: number): number {
  const unit = qc / COOLER_DELTA_F;
  const span = setpointF - (surroundF - COOLER_DELTA_F);
  if (!(unit > 0) || !(span > 0)) return 1;
  return Math.min(1, Math.max(0, (heatW - leak * unit * (setpointF - surroundF)) / (unit * span)));
}

/** Holding a lump below 70 °F costs more watts per watt removed (spec §10.5). */
export const lift = (tempF: number): number => 1 + LIFT_PER_F * Math.max(0, LIFT_BELOW_F - tempF);

export const coolerWatts = (idleW: number, loadW: number, duty: number, tempF: number): number => idleW + loadW * duty * lift(tempF);

/** The temperature a rack or room sits in: its zone lump, or 70 °F before Room; outside air for a zone. */
export const rackSurroundF = (w: World, r: number): number => {
  const room = w.compiled.rack.room[r]!;
  return w.compiled.room.opened[room] === 1 ? w.hot.room.tempF[room]! : HOME_TEMP_F;
};
export const roomSurroundF = (w: World, m: number): number => REGIONS[w.compiled.site.region[w.compiled.room.site[m]!]!]!.outsideF;

export const rackPowered = (w: World, r: number): boolean =>
  w.hot.rack.pduFailed[r] === 0
  && (w.hot.rack.drawW[r]! > 0 || w.hot.rack.crashed[r] === 1 || w.hot.room.crashed[w.compiled.rack.room[r]!] === 1);
export const roomPowered = (w: World, m: number): boolean =>
  !zoneDark(w, m) && (w.hot.room.drawW[m]! > 0 || w.hot.room.crashed[m] === 1);

/**
 * Stationary lumps (architecture §1.5). A lump step is a pure function of its temperature, heat,
 * surroundings, power, coupled conductance and the compiled and settings layers. When the last
 * step left the temperature exactly where it was, the same inputs give the same step, so it is
 * skipped and its outflow, duty and cooler watts stand. Keyed by hot buffers, like powerCache.
 */
interface LumpMemo {
  compiled: CompiledBuffers;
  settings: PhysSettings;
  readonly settled: Uint8Array;
  readonly temp: Float64Array;
  readonly heat: Float64Array;
  readonly surround: Float64Array;
  readonly powered: Uint8Array;
  readonly coupled: Float64Array;
  readonly moved: Float64Array;
  readonly g: Float64Array;
}
const memos = new WeakMap<HotBuffers, { rack: LumpMemo; room: LumpMemo }>();
const newMemo = (n: number, compiled: CompiledBuffers, settings: PhysSettings): LumpMemo => ({
  compiled, settings, settled: new Uint8Array(n), temp: new Float64Array(n), heat: new Float64Array(n),
  surround: new Float64Array(n), powered: new Uint8Array(n), coupled: new Float64Array(n), moved: new Float64Array(n), g: new Float64Array(n),
});
function lumpMemos(w: World, settings: PhysSettings): { rack: LumpMemo; room: LumpMemo } {
  const c = w.compiled;
  let m = memos.get(w.hot);
  if (!m || m.rack.compiled !== c) {
    m = { rack: newMemo(c.rack.len, c, settings), room: newMemo(c.room.len, c, settings) };
    memos.set(w.hot, m);
  } else if (m.rack.settings !== settings) {
    m.rack.settled.fill(0); m.room.settled.fill(0);
    m.rack.settings = settings; m.room.settings = settings;
  }
  return m;
}
const memoHit = (m: LumpMemo, i: number, temp: number, heat: number, surround: number, powered: boolean, coupled: number): boolean =>
  m.settled[i] === 1 && m.temp[i] === temp && m.heat[i] === heat && m.surround[i] === surround
  && m.powered[i] === (powered ? 1 : 0) && m.coupled[i] === coupled;
function memoize(m: LumpMemo, i: number, temp: number, heat: number, surround: number, powered: boolean, coupled: number, s: LumpStep): void {
  m.settled[i] = s.next === temp ? 1 : 0;
  m.temp[i] = temp; m.heat[i] = heat; m.surround[i] = surround; m.powered[i] = powered ? 1 : 0; m.coupled[i] = coupled;
  m.moved[i] = s.moved; m.g[i] = s.g;
}

/**
 * Thermal phase (tick step 9, spec §10). Every rack's effClock completes this tick at its eff,
 * then opened racks and rooms update from start-of-tick temperatures: racks dump `moved` into
 * their zone; zones reject to the site's outside air. Cooler watts and duty, crash timers,
 * throttle and e(T) are set for the next tick. Hidden containers stay at 70 °F with e = 1.
 */
export function thermalPhase(w: World): void {
  const settings = physSettings(w);
  const c = w.compiled, h = w.hot;
  const advancing = w.round.phase === 'running' || (w.research.active !== null && !w.research.stoppedInsolvent);
  const roomMoved = scratch('roomMoved', c.room.len), roomG = scratch('roomG', c.room.len);
  const memo = lumpMemos(w, settings);

  {
    // Hoisted: tables are dictionary-mode objects (built by computed keys), so a per-row column lookup is a hash probe.
    const cr = c.rack, hr = h.rack, roomOpened = c.room.opened, roomTemp = h.room.tempF, roomCrashed = h.room.crashed;
    const alive = cr.alive, openedOf = cr.opened, roomOf = cr.room, coolerQc = cr.coolerQc, leakOf = cr.leak, tau = cr.coolerTau;
    const coolerIdleW = cr.coolerIdleW, coolerLoadW = cr.coolerLoadW;
    const effClock = hr.effClock, eff = hr.eff, temp = hr.tempF, heat = hr.heatW, pduFailed = hr.pduFailed, drawW = hr.drawW;
    const crashed = hr.crashed, coolerDuty = hr.coolerDuty, coolerW = hr.coolerW;
    const setpoint = settings.rackSetpoint, setpointF = settings.rackSetpointF, m = memo.rack;
    for (let r = 0; r < cr.len; r += 1) {
      if (alive[r] !== 1) continue;
      if (advancing) effClock[r] = effClock[r]! + eff[r]! * DT_S;
      if (openedOf[r] !== 1) continue;
      const room = roomOf[r]!;
      const zoneOpen = roomOpened[room] === 1;
      const tempF = temp[r]!, heatW = heat[r]!, surround = zoneOpen ? roomTemp[room]! : HOME_TEMP_F;
      const powered = pduFailed[r] === 0 && (drawW[r]! > 0 || crashed[r] === 1 || roomCrashed[room] === 1);
      let next = tempF;
      if (!memoHit(m, r, tempF, heatW, surround, powered, 0)) {
        const qc = coolerQc[r]!, leak = leakOf[r]!;
        const duty = !powered ? 0 : setpoint ? setpointDuty(heatW, qc, leak, setpointF[r]!, surround) : 1;
        const s = lumpStep(tempF, heatW, qc, duty, leak, tau[r]!, surround);
        coolerDuty[r] = duty;
        coolerW[r] = powered ? coolerWatts(coolerIdleW[r]!, coolerLoadW[r]!, duty, tempF) : 0;
        next = s.next;
        memoize(m, r, tempF, heatW, surround, powered, 0, s);
      }
      if (zoneOpen) { roomMoved[room] = roomMoved[room]! + m.moved[r]!; roomG[room] = roomG[room]! + m.g[r]!; }
      temp[r] = next;
      rackHealth(w, r, next, settings.throttle);
      eff[r] = efficiency(next);
    }
  }

  const cm = c.room, hm = h.room, m = memo.room;
  for (let i = 0; i < cm.len; i += 1) {
    if (cm.alive[i] !== 1 || cm.opened[i] !== 1) continue;
    const tempF = hm.tempF[i]!, surround = roomSurroundF(w, i);
    const heatW = hm.heatW[i]! + roomMoved[i]!;
    const powered = roomPowered(w, i), coupled = roomG[i]!;
    let next = tempF;
    if (!memoHit(m, i, tempF, heatW, surround, powered, coupled)) {
      const qc = cm.coolerQc[i]!, leak = cm.leak[i]!;
      const duty = !powered ? 0 : settings.roomSetpoint ? setpointDuty(heatW, qc, leak, settings.roomSetpointF[i]!, surround) : 1;
      const s = lumpStep(tempF, heatW, qc, duty, leak, cm.coolerTau[i]!, surround, coupled);
      const free = settings.economizer && tempF > surround + ECONOMIZER_MARGIN_F ? ECONOMIZER_WATTS : 1;
      hm.coolerDuty[i] = duty;
      hm.coolerW[i] = powered ? coolerWatts(cm.coolerIdleW[i]!, cm.coolerLoadW[i]!, duty, tempF) * free : 0;
      next = s.next;
      memoize(m, i, tempF, heatW, surround, powered, coupled, s);
    }
    hm.heatW[i] = heatW;
    hm.tempF[i] = next;
    roomHealth(w, i, next);
  }
}
