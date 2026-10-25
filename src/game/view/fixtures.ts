import { FLEETS, topSystem } from '../testkit/fleets';
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

export const FIXTURE_NAMES = ['chipBoot', 'chipTop', 'systemBoot', 'systemTop', 'rack', 'room', 'global', 'globalGroup'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];
export const FIXTURE_ROUNDS: readonly RoundPhase[] = ['running', 'ended', 'between'];

/** A one-server system with a top chip: 128 cores, full caches, scheduler, RAM and GPUs. */
const topOne = (): GameState => buildState({ seed: 42, sites: 1, zonesPerSite: 1, racksPerZone: 1, serversPerRack: 1, unlocks: 'max', system: topSystem });

interface FixtureDef {
  readonly base: () => GameState;
  readonly focus: NodeRef;
  readonly dress: Omit<DressOptions, 'round'>;
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
};

const BASES = new Map<FixtureDef['base'], GameState>();
const STATES = new Map<string, GameState>();

/** The dressed state behind a fixture: for selectors (research tree, queue pages, labels) and quotes. */
export function fixtureState(name: FixtureName, round: RoundPhase = 'running'): GameState {
  const key = `${name}:${round}`;
  let state = STATES.get(key);
  if (!state) {
    const def = DEFS[name];
    let base = BASES.get(def.base);
    if (!base) { base = def.base(); BASES.set(def.base, base); }
    state = dressState(base, { ...def.dress, round });
    STATES.set(key, state);
  }
  return state;
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
