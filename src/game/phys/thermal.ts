import { DT_S, FLOOR_TEMP_F, HOME_TEMP_F, REGIONS, SETTLE_EPS_F } from '../core/constants';
import { G, type CompiledBuffers, type HotBuffers } from '../core/buffers';
import type { World } from '../core/world';
import { COOLER_DELTA_F, ECONOMIZER_MARGIN_F, ECONOMIZER_WATTS, EFF_FLAT_HIGH_F, EFF_LOSS_PER_F, LIFT_BELOW_F, LIFT_PER_F } from './constants';

/** Where the thermal duty line reaches 0 (120 °F). */
const DUTY_ZERO_F = EFF_FLAT_HIGH_F + 1 / EFF_LOSS_PER_F;
import { thermalDuty } from './draw';
import { efficiency, rackThrottle } from './efficiency';
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
  return lumpStepDecay(tempF, heatW, qc, duty, leak, lumpDecay(tauS), surroundF, coupledG);
}

/** The share of its distance to Teq a lump keeps over one tick: exp(−dt / τ), 0 for a lump with no time constant. */
export const lumpDecay = (tauS: number): number => (tauS > 0 ? Math.exp(-DT_S / tauS) : 0);

/**
 * Where a lump settles when `dutyHeatW` of its heat falls on the thermal duty line as it warms
 * (spec §10.4): the T with g × T = envW + fixed + h1 × duty(T), where h1 is that heat at duty 1.
 * Above 80 °F the line is linear in T, so the answer is closed form, and it is below 120 °F unless
 * the surroundings alone hold the lump above it. NO_STOP when the lump settles at or below 80 °F
 * with all of that heat: the duty stays 1 there and the plain step is already exact.
 */
const NO_STOP = -1;
/** A balance point this close to the lump's temperature is the same point (float noise in the heat). */
const STOP_EPS_F = 1e-9;
function dutyEquilibrium(tempF: number, heatW: number, dutyHeatW: number, g: number, envW: number): number {
  const h1 = dutyHeatW / thermalDuty(tempF), fixed = heatW - dutyHeatW;
  if (envW + fixed + h1 <= EFF_FLAT_HIGH_F * g) return NO_STOP;
  // (envW + fixed + h1 × (1 + 0.025 × 80)) / (g + 0.025 × h1), written as its distance below 120 °F:
  // with h1 far above g the plain quotient rounds to 120 and loses the balance point.
  const below = (DUTY_ZERO_F * g - envW - fixed) / (g + EFF_LOSS_PER_F * h1);
  return below > 0 ? DUTY_ZERO_F - below : (envW + fixed) / g;
}

/**
 * lumpStep with the tick decay already computed: it depends on the cooler alone, so the thermal phase keeps it per lump.
 *
 * `dutyHeatW` is the part of heatW drawn by equipment on the lump's thermal duty line, at the
 * start-of-tick temperature. That heat falls as the lump warms, so the step stops at the
 * temperature where heat and cooling balance (dutyEquilibrium) instead of at the Teq of the
 * start-of-tick heat: a lump whose equipment far outruns its cooler would otherwise jump past
 * 120 °F in one tick and swing between extremes. Heat counted here that does not fall with the
 * duty only makes the step shorter, never longer, so the approach stays one-sided.
 */
function lumpStepDecay(tempF: number, heatW: number, qc: number, duty: number, leak: number, decay: number, surroundF: number, coupledG: number, dutyHeatW = 0): LumpStep {
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
  let next = decay > 0 ? teq + (tempF - teq) * decay : teq;
  if (coupledG > 0) {
    const reach = g / (g + coupledG);
    if (1 - decay > reach) next = tempF + (teq - tempF) * reach;
  }
  // Where the lump comes to rest: Teq, or the duty line's balance point when that is nearer.
  let rest = teq;
  // A lump at or below 80 °F whose Teq is too has no balance point to find (NO_STOP), so the hot path skips it.
  if (dutyHeatW > 0 && (teq > EFF_FLAT_HIGH_F || tempF > EFF_FLAT_HIGH_F)) {
    // The coupled lumps' outflow falls by coupledG per °F this lump warms: one more linear term.
    let stop = dutyEquilibrium(tempF, heatW, dutyHeatW, g + coupledG, gc * supplyF + gp * surroundF + coupledG * tempF);
    if (stop !== NO_STOP) {
      // Already there, to within float noise: hold, so a balanced lump is bit-stable.
      if (Math.abs(stop - tempF) < STOP_EPS_F) stop = tempF;
      // The lump moves toward its balance point and never past it.
      if (tempF <= stop) { next = Math.max(tempF, Math.min(next, stop)); rest = Math.min(rest, stop); }
      else { next = Math.min(tempF, Math.max(next, stop)); rest = Math.max(rest, stop); }
    }
  }
  step.teq = teq;
  if (Math.abs(next - rest) < SETTLE_EPS_F) {
    // Settled: the lump passes on exactly its heat input, which is what `moved` equals at T = Teq.
    // Using the formula with a snapped T would feed the ±0.05 °F snap error into the zone lump,
    // and coupled rack and zone lumps would trade it back and forth forever instead of settling.
    step.next = Math.max(FLOOR_TEMP_F, rest);
    step.moved = heatW;
    return step;
  }
  step.next = Math.max(FLOOR_TEMP_F, next);
  step.moved = gc * (tempF - supplyF) + gp * (tempF - surroundF);
  return step;
}


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

/**
 * A rack cooler stands in its zone's air and duty-cycles on the zone's line (spec §10.4): above
 * 80 °F it runs at most that share of full speed (`duty` is what it would run at in a cool zone)
 * and its idle watts fall with it, so a zone its racks' coolers overheat settles below 120 °F.
 */
const zoneCappedDuty = (duty: number, zoneDuty: number): number => (duty < zoneDuty ? duty : zoneDuty);

/** The temperature a rack or room sits in: its zone lump, or 70 °F before Room; outside air for a zone. */
export const rackSurroundF = (w: World, r: number): number => {
  const room = w.compiled.rack.room[r]!;
  return w.compiled.room.opened[room] === 1 ? w.hot.room.tempF[room]! : HOME_TEMP_F;
};
export const roomSurroundF = (w: World, m: number): number => REGIONS[w.compiled.site.region[w.compiled.room.site[m]!]!]!.outsideF;

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
  /** The duty-line part of `heat` (lumpStepDecay's dutyHeatW). */
  readonly dutyHeat: Float64Array;
  readonly moved: Float64Array;
  readonly g: Float64Array;
  /** lumpDecay of each lump's cooler (compiled, so fixed for the memo's life). */
  readonly decay: Float64Array;
}
const memos = new WeakMap<HotBuffers, { rack: LumpMemo; room: LumpMemo }>();
const newMemo = (n: number, compiled: CompiledBuffers, settings: PhysSettings, tau: Float64Array): LumpMemo => ({
  compiled, settings, settled: new Uint8Array(n), temp: new Float64Array(n), heat: new Float64Array(n),
  surround: new Float64Array(n), powered: new Uint8Array(n), coupled: new Float64Array(n), dutyHeat: new Float64Array(n),
  moved: new Float64Array(n), g: new Float64Array(n),
  decay: Float64Array.from({ length: n }, (_, i) => lumpDecay(tau[i]!)),
});
function lumpMemos(w: World, settings: PhysSettings): { rack: LumpMemo; room: LumpMemo } {
  const c = w.compiled;
  let m = memos.get(w.hot);
  if (!m || m.rack.compiled !== c) {
    m = { rack: newMemo(c.rack.len, c, settings, c.rack.coolerTau), room: newMemo(c.room.len, c, settings, c.room.coolerTau) };
    memos.set(w.hot, m);
  } else if (m.rack.settings !== settings) {
    m.rack.settled.fill(0); m.room.settled.fill(0);
    m.rack.settings = settings; m.room.settings = settings;
  }
  return m;
}
const memoHit = (m: LumpMemo, i: number, temp: number, heat: number, surround: number, powered: boolean, coupled: number, dutyHeat: number): boolean =>
  m.settled[i] === 1 && m.temp[i] === temp && m.heat[i] === heat && m.surround[i] === surround
  && m.powered[i] === (powered ? 1 : 0) && m.coupled[i] === coupled && m.dutyHeat[i] === dutyHeat;
function memoize(m: LumpMemo, i: number, temp: number, heat: number, surround: number, powered: boolean, coupled: number, dutyHeat: number, s: LumpStep): void {
  m.settled[i] = s.next === temp ? 1 : 0;
  m.temp[i] = temp; m.heat[i] = heat; m.surround[i] = surround; m.powered[i] = powered ? 1 : 0; m.coupled[i] = coupled; m.dutyHeat[i] = dutyHeat;
  m.moved[i] = s.moved; m.g[i] = s.g;
}

/**
 * Thermal phase (tick step 9, spec §10). Every rack's effClock completes this tick at its eff,
 * then opened racks and rooms update from start-of-tick temperatures: racks dump `moved` into
 * their zone; zones reject to the site's outside air. Cooler watts and duty, throttle and e(T)
 * are set for the next tick. Hidden containers stay at 70 °F with e = 1.
 */
export function thermalPhase(w: World): void {
  const settings = physSettings(w);
  const c = w.compiled, h = w.hot;
  const advancing = w.round.phase === 'running' || h.g[G.researchHolders]! > 0;
  const roomMoved = scratch('roomMoved', c.room.len), roomG = scratch('roomG', c.room.len);
  const memo = lumpMemos(w, settings);

  {
    // Columns hoisted: one load each for the whole loop.
    const cr = c.rack, hr = h.rack, roomOpened = c.room.opened, roomTemp = h.room.tempF;
    const alive = cr.alive, openedOf = cr.opened, roomOf = cr.room, coolerQc = cr.coolerQc, leakOf = cr.leak;
    const coolerIdleW = cr.coolerIdleW, coolerLoadW = cr.coolerLoadW;
    const effClock = hr.effClock, eff = hr.eff, temp = hr.tempF, heat = hr.heatW, drawW = hr.drawW;
    const coolerDuty = hr.coolerDuty, coolerW = hr.coolerW;
    const setpoint = settings.rackSetpoint, setpointF = settings.rackSetpointF, throttle = settings.throttle, m = memo.rack;
    const decay = m.decay, moved = m.moved, conductance = m.g;
    for (let r = 0; r < cr.len; r += 1) {
      if (alive[r] !== 1) continue;
      if (advancing) effClock[r] = effClock[r]! + eff[r]! * DT_S;
      if (openedOf[r] !== 1) continue;
      const room = roomOf[r]!;
      const zoneOpen = roomOpened[room] === 1;
      const tempF = temp[r]!, heatW = heat[r]!, surround = zoneOpen ? roomTemp[room]! : HOME_TEMP_F;
      const powered = drawW[r]! > 0;
      // Everything that heats a rack is on its duty line (the PDU loss on the cooler's watts is the small exception).
      const dutyHeat = tempF < DUTY_ZERO_F ? heatW : 0;
      // A settled lump with the same inputs keeps its temperature, and so its throttle and e(T).
      if (memoHit(m, r, tempF, heatW, surround, powered, 0, dutyHeat)) {
        if (zoneOpen) { roomMoved[room] = roomMoved[room]! + moved[r]!; roomG[room] = roomG[room]! + conductance[r]!; }
        continue;
      }
      {
        const qc = coolerQc[r]!, leak = leakOf[r]!;
        const zoneDuty = zoneOpen ? thermalDuty(surround) : 1;
        const duty = !powered ? 0 : zoneCappedDuty(setpoint ? setpointDuty(heatW, qc, leak, setpointF[r]!, surround) : 1, zoneDuty);
        const s = lumpStepDecay(tempF, heatW, qc, duty, leak, decay[r]!, surround, 0, dutyHeat);
        coolerDuty[r] = duty;
        coolerW[r] = powered ? coolerWatts(coolerIdleW[r]! * zoneDuty, coolerLoadW[r]!, duty, tempF) : 0;
        const next = s.next;
        memoize(m, r, tempF, heatW, surround, powered, 0, dutyHeat, s);
        if (zoneOpen) { roomMoved[room] = roomMoved[room]! + moved[r]!; roomG[room] = roomG[room]! + conductance[r]!; }
        temp[r] = next;
        rackThrottle(w, r, next, throttle);
        eff[r] = efficiency(next);
      }
    }
  }

  const cm = c.room, hm = h.room, m = memo.room;
  for (let i = 0; i < cm.len; i += 1) {
    if (cm.alive[i] !== 1 || cm.opened[i] !== 1) continue;
    const tempF = hm.tempF[i]!, surround = roomSurroundF(w, i);
    const heatW = hm.heatW[i]! + roomMoved[i]!;
    // The zone's own heat (rack coolers, network rack) is on its duty line, and so is what its racks' coolers
    // push into it: a rack cooler runs at the zone's duty. The UPS loss and the racks' leak are the small exceptions.
    const dutyHeat = tempF < DUTY_ZERO_F ? heatW : 0;
    const powered = hm.drawW[i]! > 0, coupled = roomG[i]!;
    let next = tempF;
    if (!memoHit(m, i, tempF, heatW, surround, powered, coupled, dutyHeat)) {
      const qc = cm.coolerQc[i]!, leak = cm.leak[i]!;
      const duty = !powered ? 0 : settings.roomSetpoint ? setpointDuty(heatW, qc, leak, settings.roomSetpointF[i]!, surround) : 1;
      const s = lumpStepDecay(tempF, heatW, qc, duty, leak, m.decay[i]!, surround, coupled, dutyHeat);
      const free = settings.economizer && tempF > surround + ECONOMIZER_MARGIN_F ? ECONOMIZER_WATTS : 1;
      hm.coolerDuty[i] = duty;
      hm.coolerW[i] = powered ? coolerWatts(cm.coolerIdleW[i]!, cm.coolerLoadW[i]!, duty, tempF) * free : 0;
      next = s.next;
      memoize(m, i, tempF, heatW, surround, powered, coupled, dutyHeat, s);
    }
    hm.heatW[i] = heatW;
    hm.tempF[i] = next;
  }
}
