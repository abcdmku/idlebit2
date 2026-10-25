import { graceOf } from '../market/queue';
import { amount } from '../amount';
import { CEILINGS_MAX, MAX_ROWS, MAX_SITES, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, RACK_SLOTS_PER_ROW, SERVERS_PER_RACK } from '../core/constants';
import { barebonesRack, barebonesRoom, barebonesSite, barebonesSystem } from '../core/defaults';
import { baseResearch, baseUnlocks, createInitialState, initialHot, newRound, preparedMarket } from '../core/state';
import { compileAll } from '../core/topology';
import { RESEARCH } from '../build/research/tree';
import { deriveUnlocks } from '../build/research/effects';
import type { BuildState, GlobalBuild, RackBuild, RoomBuild, SiteBuild, SystemBuild } from '../types/build';
import {
  FILTER_IDS, PART_IDS, PLACEMENT_IDS, QUEUE_STRATEGY_IDS, REGION_IDS, ROUTE_STRATEGY_IDS, RULE_IDS, type PartId,
} from '../types/catalog';
import { rackId, roomId, siteId, systemId, type LevelId, type RackId, type RoomId, type SiteId, type SystemId } from '../types/ids';
import type { GameState, RoundPhase, Unlocks } from '../types/state';

/** A fleet to build. Every count is clamped to the architecture caps (§1.9). */
export interface FleetSpec {
  readonly seed?: number;
  readonly sites: number;
  readonly zonesPerSite: number;
  readonly racksPerZone: number;
  readonly serversPerRack: number;
  readonly round?: RoundPhase;
  readonly unlocks?: 'base' | 'max';
  /** Builds each system; default barebones at tier 0. */
  readonly system?: (id: SystemId, rack: RackId, slot: number) => SystemBuild;
  readonly rack?: (rack: RackBuild) => RackBuild;
  readonly room?: (room: RoomBuild) => RoomBuild;
  readonly site?: (site: SiteBuild) => SiteBuild;
  readonly global?: GlobalBuild;
  readonly credits?: string;
  readonly data?: string;
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.floor(n)));

/** The zoom level a fleet needs: more than one server opens Rack, and so on up. */
export function fleetLevel(spec: FleetSpec): LevelId {
  if (spec.sites > 1 || spec.zonesPerSite > 1) return 'global';
  if (spec.racksPerZone > 1) return 'room';
  if (spec.serversPerRack > 1) return 'rack';
  return 'system';
}
const LEVEL_ORDER: readonly LevelId[] = ['chip', 'system', 'rack', 'room', 'global'];
const levelsUpTo = (top: LevelId) => Object.fromEntries(LEVEL_ORDER.map((l) => [l, LEVEL_ORDER.indexOf(l) <= LEVEL_ORDER.indexOf(top)])) as Record<LevelId, boolean>;

/** Everything researched: every generation, ceilings at the caps, every option and rule, fastest boot. */
export function maxUnlocks(): Unlocks {
  const researched = deriveUnlocks(RESEARCH.map((node) => node.id)), gpuParams = researched.ruleParams;
  return {
    levels: levelsUpTo('global'),
    gens: Object.fromEntries(PART_IDS.map((p) => [p, p === 'gpu' ? 0x1ff : 0x7f])) as Record<PartId, number>,
    ceilings: { ...CEILINGS_MAX, gpuSlots: 2 },
    queueStrategies: QUEUE_STRATEGY_IDS, routeStrategies: ROUTE_STRATEGY_IDS, filters: FILTER_IDS, placements: PLACEMENT_IDS,
    rules: RULE_IDS, ruleParams: { tensorRate: gpuParams.tensorRate, vramPerLevel: gpuParams.vramPerLevel },
    bootTicks: 20, autoReturnDelayTicks: researched.autoReturnDelayTicks, offlineCapHours: 24,
  };
}

export function buildFleet(spec: FleetSpec): BuildState {
  const nSites = clamp(spec.sites, MAX_SITES) || 1;
  const nZones = clamp(spec.zonesPerSite, MAX_ZONES_PER_SITE) || 1;
  const nRacks = clamp(spec.racksPerZone, RACKS_PER_ROOM) || 1;
  const nServers = clamp(spec.serversPerRack, SERVERS_PER_RACK);
  const top = fleetLevel(spec);
  const open = levelsUpTo(top);
  const rows = Math.max(2, Math.min(MAX_ROWS, Math.ceil(nRacks / RACK_SLOTS_PER_ROW)));
  const makeSystem = spec.system ?? ((id, rack, slot) => barebonesSystem(id, rack, slot));
  const systems: SystemBuild[] = [], racks: RackBuild[] = [], rooms: RoomBuild[] = [], sites: SiteBuild[] = [];

  for (let s = 0; s < nSites; s += 1) {
    const sid: SiteId = siteId(s);
    const zones: (RoomId | null)[] = Array(MAX_ZONES_PER_SITE).fill(null);
    for (let z = 0; z < nZones; z += 1) {
      const mid = roomId(rooms.length);
      zones[z] = mid;
      const slots: (RackId | null)[] = Array(rows * RACK_SLOTS_PER_ROW).fill(null);
      for (let r = 0; r < nRacks; r += 1) {
        const rid = rackId(racks.length);
        slots[r] = rid;
        const servers: (SystemId | null)[] = Array(SERVERS_PER_RACK).fill(null);
        for (let v = 0; v < nServers; v += 1) {
          const id = systemId(systems.length);
          servers[v] = id;
          systems.push(makeSystem(id, rid, v));
        }
        const rack = { ...barebonesRack(rid, mid, r, open.rack), servers };
        racks.push(spec.rack ? spec.rack(rack) : rack);
      }
      const room = { ...barebonesRoom(mid, sid, z, open.room, rows), racks: slots };
      rooms.push(spec.room ? spec.room(room) : room);
    }
    const site = { ...barebonesSite(sid, REGION_IDS[s]!, open.global), zones };
    sites.push(spec.site ? spec.site(site) : site);
  }
  return { systems, racks, rooms, sites, global: spec.global ?? { scheduler: null }, revision: 0 };
}

/** Builds a complete, consistent GameState for any fleet up to the caps. */
export function buildState(spec: FleetSpec): GameState {
  const base = createInitialState(spec.seed ?? 42);
  const build = buildFleet(spec);
  const levels = levelsUpTo(fleetLevel(spec));
  const unlocks = { ...(spec.unlocks === 'max' ? maxUnlocks() : baseUnlocks()), levels };
  const research = { ...baseResearch(unlocks), completed: spec.unlocks === 'max' ? RESEARCH.map((node) => node.id) : [] };
  const compiled = compileAll(build, research);
  const phase = spec.round ?? 'running';
  const hot = initialHot({ compiled, seed: base.seed, round: { ...newRound(1, 0), phase } });
  const market = preparedMarket(hot, base.seed, phase === 'running' ? 1 : 2);
  const round = { ...newRound(1, 0), phase, grace: graceOf(market.window) };
  return {
    ...base, build, research, compiled, round, market,
    hot,
    wallet: { ...base.wallet, credits: amount(spec.credits ?? 0), data: amount(spec.data ?? 0) },
  };
}
