import { capacity } from '../build/catalog/curves';
import { GENERATION, GENERATION_FUEL, POWER_CTL } from '../build/catalog/infra';
import { REGIONS, SERVERS_PER_RACK, TICK_MS } from '../core/constants';
import { MODE } from '../core/timers';
import type { StartCtl } from '../types/build';
import type { GameState } from '../types/state';
import type { GenerationView, PowerCtlView, StartCtlView } from '../types/views';

/**
 * D31 views: start controllers, the rack Power control (battery and start) and site generation.
 * Everything reads saved build and hot state; nothing here changes the sim.
 */

const AWAKE = new Set<number>([MODE.onMarket, MODE.boot, MODE.draining, MODE.goingOffline, MODE.cold, MODE.paused]);

export function startCtlView(ctl: StartCtl, awake: number, total: number, nextWakeInMs: number | null): StartCtlView {
  return {
    generation: ctl.gen, level: ctl.level, startWith: ctl.startWith, headWaitS: ctl.trigger.headWaitS,
    busyPct: ctl.gen >= 1 ? ctl.trigger.busyPct : null, order: ctl.order, awake, total, nextWakeInMs,
  };
}

const wakeMs = (ticks: number | undefined): number | null => (ticks && ticks > 0 ? ticks * TICK_MS : null);

/** Systems awake (not asleep, standby, offline or empty) of the rack's systems. */
function rackAwake(state: GameState, rack: number): { awake: number; total: number } {
  const c = state.compiled.rack;
  let awake = 0, total = 0;
  for (let slot = 0; slot < SERVERS_PER_RACK; slot += 1) {
    const s = c.servers[rack * SERVERS_PER_RACK + slot] ?? -1;
    if (s < 0 || state.compiled.sys.alive[s] !== 1) continue;
    total += 1;
    if (AWAKE.has(state.hot.sys.mode[s] ?? MODE.empty)) awake += 1;
  }
  return { awake, total };
}

/** D31.3: the rack's Power control, or null when none is installed. */
export function powerCtlView(state: GameState, rack: number): PowerCtlView | null {
  const ctl = state.build.racks[rack]?.powerCtl;
  if (!ctl) return null;
  const h = state.hot.rack;
  const capacityJ = capacity(POWER_CTL, ctl.gen, ctl.level);
  const chargeJ = Math.min(capacityJ, h.batteryJ[rack] ?? 0);
  const drawW = h.drawW[rack] ?? 0;
  const powered = (h.powered[rack] ?? 1) === 1;
  const { awake, total } = rackAwake(state, rack);
  return {
    generation: ctl.gen, level: ctl.level,
    battery: {
      capacityJ, chargeJ, secondsLeft: drawW > 0 ? chargeJ / drawW : null,
      discharging: state.round.phase === 'running' && powered && chargeJ > 0 && drawW > 0,
    },
    start: startCtlView(ctl, awake, total, wakeMs(h.wakeTicks[rack])),
  };
}

/** D31.2: a rack slot's powered flag and power-on countdown (room view). */
export function rackPowerFields(state: GameState, rack: number): { powered: boolean; wakeMs: number | null } {
  const h = state.hot.rack;
  return { powered: (h.powered[rack] ?? 1) === 1, wakeMs: wakeMs(h.wakeTicks[rack]) };
}

/** D31.2: the room start controller on the UPS, with its powered-rack count. */
export function roomStartView(state: GameState, room: number, racks: readonly number[]): StartCtlView | null {
  const ctl = state.build.rooms[room]?.start;
  if (!ctl) return null;
  const live = racks.filter((r) => r >= 0 && state.compiled.rack.alive[r] === 1);
  const powered = live.filter((r) => (state.hot.rack.powered[r] ?? 1) === 1).length;
  return startCtlView(ctl, powered, live.length, wakeMs(state.hot.room.wakeTicks[room]));
}

export function zonePowerFields(state: GameState, room: number): { powered: boolean; wakeMs: number | null } {
  const h = state.hot.room;
  return { powered: (h.powered[room] ?? 1) === 1, wakeMs: wakeMs(h.wakeTicks[room]) };
}

export function sitePowerFields(state: GameState, site: number): { powered: boolean; wakeMs: number | null } {
  const h = state.hot.site;
  return { powered: (h.powered[site] ?? 1) === 1, wakeMs: wakeMs(h.wakeTicks[site]) };
}

/** D31.2: the global start controller on the scheduler, with its online-site count. */
export function globalStartView(state: GameState): StartCtlView | null {
  const ctl = state.build.global.start;
  if (!ctl) return null;
  let online = 0, total = 0;
  state.build.sites.forEach((s, i) => {
    if (s === null || !s.opened) return;
    total += 1;
    if ((state.hot.site.powered[i] ?? 1) === 1) online += 1;
  });
  return startCtlView(ctl, online, total, null);
}

const GEN_KINDS = ['solar', 'wind', 'fuelCell', 'ownPlant'] as const;
/** D31.4: a site's generation: output × region factor, what this tick used, and the marginal price. */
export function generationView(state: GameState, site: number): GenerationView | null {
  const b = state.build.sites[site];
  const gen = b?.generation;
  if (!b || !gen) return null;
  const region = REGIONS.find((r) => r.id === b.region)!;
  const factor = gen.gen === 0 ? region.sun : gen.gen === 1 ? region.wind : 1;
  const outputW = capacity(GENERATION, gen.gen, gen.level) * factor;
  const usedW = state.hot.site.genUsedW[site] ?? 0;
  const fuelPrice = GENERATION_FUEL[gen.gen]! * region.energyPrice;
  return { kind: GEN_KINDS[gen.gen]!, level: gen.level, outputW, usedW, marginalPrice: usedW < outputW ? fuelPrice : region.energyPrice };
}
