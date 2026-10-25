import { amountCompare, amountSubtract, type Amount } from '../amount';
import { advanceGame } from '../core/advance';
import { cloneCompiled, cloneHot } from '../core/buffers';
import { FLEETS, topSystem } from '../testkit/fleets';
import { SPLIT_FLEETS } from '../testkit/splitFixtures';
import { SPILL_FLEETS } from '../testkit/spillFixtures';
import { buildState } from '../testkit/builders';
import { rackId, roomId, systemId, type NodeRef } from '../types/ids';
import type { RenderSnapshot, SnapshotScope } from '../types/snapshot';
import type { GameState, RoundPhase } from '../types/state';
import { dressState, type DressOptions } from './fixtureDress';
import { deriveRenderSnapshot, parentOf } from './snapshot';

/**
 * Snapshot fixtures derived from testkit fleets (architecture §7.2) and dressed with deterministic
 * live state, for every level and round state. Renderer and UI agents build against these before
 * the domains run. Test, harness and dev pages only (public entry: src/game/fixtures.ts).
 */

export const FIXTURE_NAMES = ['chipBoot', 'chipTop', 'systemBoot', 'systemTop', 'rack', 'room', 'global', 'globalGroup', 'rackSplit', 'roomSplit', 'globalSplit', 'spillSystem', 'spillRack'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];
export const FIXTURE_ROUNDS: readonly RoundPhase[] = ['running', 'ended', 'between'];

/** A one-server system with a top chip: 128 cores, full caches, scheduler, RAM and GPUs. */
const topOne = (): GameState => buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max', system: topSystem });

interface FixtureDef {
  readonly base: () => GameState;
  readonly focus: NodeRef;
  readonly dress: Omit<DressOptions, 'round'>;
  /**
   * Live (the D25 split fixtures): real sim state, undressed while running, so a store can keep
   * advancing it. Each call returns its own buffers (an owned advance updates them in place).
   */
  readonly live?: true;
}
const quiet = { tick: 600, front: 0, takesPerTick: 0.2, specials: false } as const;
const busy = { tick: 6_000, front: 1, takesPerTick: 0.3, specials: true } as const;
const DEFS: Readonly<Record<FixtureName, FixtureDef>> = {
  chipBoot: { base: FLEETS.boot, focus: { level: 'chip', id: systemId(0) }, dress: quiet },
  chipTop: { base: topOne, focus: { level: 'chip', id: systemId(0) }, dress: quiet },
  systemBoot: { base: FLEETS.boot, focus: { level: 'system', id: systemId(0) }, dress: quiet },
  systemTop: { base: topOne, focus: { level: 'system', id: systemId(0) }, dress: quiet },
  rack: { base: FLEETS.rackFull, focus: { level: 'rack', id: rackId(0) }, dress: busy },
  room: { base: FLEETS.roomFull, focus: { level: 'room', id: roomId(0) }, dress: busy },
  global: { base: FLEETS.fleetMax, focus: { level: 'global', id: 0 }, dress: busy },
  /** The global level at fleetMax: 40 takes a tick and two returned tasks at the queue front. */
  globalGroup: { base: FLEETS.fleetMax, focus: { level: 'global', id: 0 }, dress: { tick: 36_000, front: 2, takesPerTick: 40, specials: true } },
  /** Mid-game splits (D25): kHz servers on kHz links, shards visibly crossing links (testkit/splitFixtures). */
  rackSplit: { base: SPLIT_FLEETS.rackSplit, focus: { level: 'rack', id: rackId(0) }, dress: quiet, live: true },
  roomSplit: { base: SPLIT_FLEETS.roomSplit, focus: { level: 'room', id: roomId(0) }, dress: quiet, live: true },
  globalSplit: { base: SPLIT_FLEETS.globalSplit, focus: { level: 'global', id: 0 }, dress: quiet, live: true },
  /** D26: a small-RAM system whose data-heavy shards spill onto its SSD (testkit/spillFixtures). */
  spillSystem: { base: SPILL_FLEETS.spillSystem, focus: { level: 'system', id: systemId(0) }, dress: quiet, live: true },
  /** D26: a Rack-era ECC rack taking windowed Rack-scale tasks through its LB queue. */
  spillRack: { base: SPILL_FLEETS.spillRack, focus: { level: 'rack', id: rackId(0) }, dress: quiet, live: true },
};

const BASES = new Map<FixtureDef['base'], GameState>();
const STATES = new Map<string, GameState>();

function baseOf(def: FixtureDef): GameState {
  let base = BASES.get(def.base);
  if (!base) { base = def.base(); BASES.set(def.base, base); }
  return base;
}

/**
 * The dressed state behind a fixture: for selectors (research tree, queue pages, labels) and quotes.
 * A live fixture while running is its warmed sim state, a fresh copy per call.
 */
export function fixtureState(name: FixtureName, round: RoundPhase = 'running'): GameState {
  const def = DEFS[name];
  if (def.live && round === 'running') {
    const base = baseOf(def);
    return { ...base, hot: cloneHot(base.hot), compiled: cloneCompiled(base.compiled) };
  }
  const key = `${name}:${round}`;
  let state = STATES.get(key);
  if (!state) {
    state = dressState(baseOf(def), { ...def.dress, round });
    const credits = runway(name, def);
    if (amountCompare(credits, state.wallet.credits) > 0) state = { ...state, wallet: { ...state.wallet, credits } };
    STATES.set(key, state);
  }
  return state;
}

const RUNWAYS = new Map<FixtureName, Amount>();
const DAY_MS = 86_400_000;
/**
 * A dressed wallet that a store can advance for a day without going negative. The synthetic top
 * fleets (rack, room, global) draw far more energy than the fixture market pays: their whole-number
 * dressed balance went below zero within a second of running (about −1.5e17 Credits for one rack).
 * Measured: one second of the running dress, its energy bill × 86,400, rounded up to two digits.
 */
function runway(name: FixtureName, def: FixtureDef): Amount {
  let credits = RUNWAYS.get(name);
  if (credits === undefined) {
    const start = dressState(baseOf(def), { ...def.dress, round: 'running' });
    const end = advanceGame(start, 1_000).state;
    const day = BigInt(amountSubtract(end.ledger.energy, start.ledger.energy)) * BigInt(DAY_MS / 1_000);
    const digits = day.toString().length;
    const unit = digits > 2 ? 10n ** BigInt(digits - 2) : 1n;
    credits = ((day + unit - 1n) / unit * unit).toString() as Amount;
    RUNWAYS.set(name, credits);
  }
  return credits;
}

/** The focus ref of a fixture, and its zoom partner (one level up) when `partner` is set. */
export function fixtureScope(name: FixtureName, partner = false): SnapshotScope {
  const focus = DEFS[name].focus;
  return { focus, partner: partner ? parentOf(fixtureState(name), focus) : null };
}

/** A render snapshot for a fixture, round state and optional zoom partner. */
export function fixtureSnapshot(name: FixtureName, round: RoundPhase = 'running', partner = false): RenderSnapshot {
  return deriveRenderSnapshot(fixtureState(name, round), fixtureScope(name, partner));
}
