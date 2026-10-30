import { graceOf, prepareQueue } from '../market/queue';
import { ZERO_AMOUNT } from '../amount';
import type { BuildState } from '../types/build';
import { PART_IDS, type PartId } from '../types/catalog';
import { rackId, roomId, siteId, systemId } from '../types/ids';
import type { GameState, MarketState, ResearchState, RoundState, Unlocks } from '../types/state';
import { allocHot, type HotBuffers } from './buffers';
import {
  AUTO_RETURN_DELAY_TICKS, BOOT_TICKS_BASE, CEILINGS_START, DEFAULT_SEED, OFFLINE_CAP_HOURS_BASE,
} from './constants';
import { barebonesRack, barebonesRoom, barebonesSite, barebonesSystem } from './defaults';
import { reseedForRound } from './rng';
import { MODE } from './timers';
import { compileAll, syncHotSizes } from './topology';
import { runwayMark } from '../build/research/runway';
import { initialRoundRewards } from '../rewards/progress';

/** D39: Control deck, level 3 and the scheduler are bought from the start; research never unlocks a part type. */
const START_GENS: readonly PartId[] = ['cpu', 'core', 'clock', 'cache', 'scheduler', 'psu'];

export function baseUnlocks(): Unlocks {
  const gens = Object.fromEntries(PART_IDS.map((p) => [p, START_GENS.includes(p) ? 1 : 0])) as Record<PartId, number>;
  return {
    levels: { chip: true, system: false, rack: false, room: false, global: false },
    gens, ceilings: CEILINGS_START,
    queueStrategies: ['fifo'], routeStrategies: ['firstFit'], filters: [], rules: [], ruleParams: {},
    bootTicks: BOOT_TICKS_BASE, autoReturnDelayTicks: AUTO_RETURN_DELAY_TICKS, offlineCapHours: OFFLINE_CAP_HOURS_BASE,
  };
}

export function baseResearch(unlocks: Unlocks = baseUnlocks()): ResearchState {
  return {
    completed: [], active: null, activeProgress: 0, parked: {}, queue: [],
    stoppedInsolvent: false, needsData: false, unlocks,
  };
}

export function newRound(index: number, startTick: number, reports: RoundState['reports'] = [], autoReturnOn = true): RoundState {
  return {
    phase: 'running', index, startTick, endTick: null, autoReturnTick: null, autoReturnOn, peakIntensity: 0, grace: 0,
    gross: ZERO_AMOUNT, data: ZERO_AMOUNT, energy: ZERO_AMOUNT, researchOps: 0, reports,
    frontier: { bestI: 0, bestRound: 0, bestMet: 0, bestMetRound: 0, taken: [], takenAtStart: 0 }, runwayStart: null,
  };
}

/** Boot owns system 0 inside hidden bench rack 0, room 0 and site 0 (architecture §1.3). */
export function bootBuild(): BuildState {
  const rack = barebonesRack(rackId(0), roomId(0), 0, false);
  const room = barebonesRoom(roomId(0), siteId(0), 0, false);
  const site = barebonesSite(siteId(0), 'us-east', false);
  return {
    investments: {},
    systems: [barebonesSystem(systemId(0), rackId(0), 0)],
    racks: [{ ...rack, servers: rack.servers.map((s, i) => (i === 0 ? systemId(0) : s)) }],
    rooms: [{ ...room, racks: room.racks.map((r, i) => (i === 0 ? rackId(0) : r)) }],
    sites: [{ ...site, zones: site.zones.map((z, i) => (i === 0 ? roomId(0) : z)) }],
    global: { scheduler: null, start: null },
    revision: 0,
  };
}

/** Hot buffers for a compiled build: every live system rests in its §4.3 mode for `phase`. */
export function initialHot(state: Pick<GameState, 'compiled' | 'seed' | 'round'>): HotBuffers {
  const hot = allocHot({ systems: 0, racks: 0, rooms: 0, sites: 0, links: 0 });
  syncHotSizes(hot, state.compiled);
  const c = state.compiled.sys;
  for (let s = 0; s < c.len; s += 1) {
    if (c.alive[s] !== 1) continue;
    hot.sys.mode[s] = state.round.phase !== 'running' ? MODE.paused : c.intent[s] === 1 ? MODE.onMarket : MODE.offline;
  }
  reseedForRound(hot, state.seed, state.round.index);
  return hot;
}

/**
 * The prepared queue of round `roundIndex` at intensity I (spec §5.2), its head on the clock from
 * `headTick`. Draws the round seed, jitters and the head plus 50 incoming tasks from `hot`.
 */
export function preparedMarket(hot: HotBuffers, seed: number, roundIndex: number, I = 0, headTick = 0): MarketState {
  const { tasks, intensity } = prepareQueue(hot, seed, roundIndex, I);
  return { roundIndex, window: tasks, headTick, intensity };
}

/** A new game: round 1 running with its queue saved, so the first screen is playable (spec §4.1). */
export function createInitialState(seed: number = DEFAULT_SEED): GameState {
  const build = bootBuild();
  const research = baseResearch();
  const compiled = compileAll(build, research);
  const hot = initialHot({ compiled, seed: seed >>> 0, round: newRound(1, 0) });
  const market = preparedMarket(hot, seed >>> 0, 1);
  const round = { ...newRound(1, 0), grace: graceOf(market.window), runwayStart: runwayMark(research, 0, 0) };
  return {
    schema: 'bitrouge-v3', epoch: 0, seed: seed >>> 0,
    clock: { tick: 0, carryMs: 0 },
    wallet: { credits: ZERO_AMOUNT, data: ZERO_AMOUNT, energyMeter: 0, dataMeter: 0 },
    ledger: {
      gross: ZERO_AMOUNT, energy: ZERO_AMOUNT, dataEarned: ZERO_AMOUNT, creditsSpent: ZERO_AMOUNT, dataSpent: ZERO_AMOUNT,
      netRing: [{ tick: 0, gross: ZERO_AMOUNT, energy: ZERO_AMOUNT }],
      walletHistory: [{ tick: 0, credits: ZERO_AMOUNT, data: ZERO_AMOUNT, checkpoint: true }],
    },
    round,
    market,
    build, research, roundRewards: initialRoundRewards(),
    configs: { system: [], rack: [], room: [], site: [] },
    compiled,
    hot,
    events: { nextSeq: 0, entries: [] },
  };
}
