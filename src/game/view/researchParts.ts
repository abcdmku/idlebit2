import { RESEARCH } from '../build/research/tree';
import type { ResearchDef } from '../types/catalog';
import type { LevelId } from '../types/ids';
import type { ResearchPartId, ResearchTabId } from '../types/views';

/*
 * Which owned part each research node grows from (research screen concept C), and the tab of that
 * part's hardware level. Derived from the node's effects, never from `level` (where it first
 * matters): a CPU node stays on the CPU tab in every era. Fabs bring whole CPU generations: their
 * own `fab` root on the CPU tab. Structure nodes are `structure`, on the tab of the level they open.
 */

/** The hardware level of each part: the tab its research sits on. */
export const PART_TAB: Readonly<Record<Exclude<ResearchPartId, 'structure'>, ResearchTabId>> = {
  cores: 'cpu', clock: 'cpu', cache: 'cpu', queue: 'cpu', fab: 'cpu',
  cpu: 'system', ram: 'system', drive: 'system', gpu: 'system', psu: 'system', board: 'system',
  switch: 'rack', lb: 'rack', rackCooling: 'rack', rackPower: 'rack',
  netRack: 'room', roomCooling: 'room', ups: 'room',
  dataPlane: 'global', backbone: 'global', site: 'global', globalScheduler: 'global',
};

/** Generation effects: the part a new generation installs into. */
const GEN: Readonly<Record<string, ResearchPartId>> = {
  core: 'cores', clock: 'clock', l1: 'cache', l2: 'cache', l3: 'cache', scheduler: 'queue',
  ram: 'ram', gpu: 'gpu', npu: 'gpu', storage: 'drive', storageNode: 'drive', psu: 'psu',
  switch: 'switch', lb: 'lb', rackCooler: 'rackCooling', pdu: 'rackPower',
  roomCooler: 'roomCooling', ups: 'ups', dataPlane: 'dataPlane', backbone: 'backbone', grid: 'site',
  cpu: 'structure', row: 'structure', zone: 'structure', site: 'structure',
  // D31: Power control sits with rack power; room and global start controllers on the UPS and scheduler; generation at the site.
  powerCtl: 'rackPower', roomStart: 'ups', globalStart: 'globalScheduler', generation: 'site',
};
/** Ceilings: the part whose slots or levels they raise. */
const CEILING: Readonly<Record<string, ResearchPartId>> = {
  lanesPerCore: 'clock', coreSites: 'cores', threadsPerCore: 'cores', cpuSockets: 'cpu',
  l3LevelBonus: 'cache', ramSlots: 'ram', ramLevelBonus: 'ram', gpuSlots: 'gpu', driveSlots: 'drive',
  rackPorts: 'switch', roomPorts: 'netRack', uplinks: 'switch', researchQueue: 'board',
  roomRows: 'structure', siteZones: 'structure', sites: 'structure',
};
/** Rules: the part whose behaviour they change. */
const RULE: Readonly<Record<string, ResearchPartId>> = {
  coreIdle: 'clock', smt: 'cores', workStealing: 'cores',
  packageIdle: 'cpu', dvfs: 'cpu', turbo: 'cpu', socketFactor: 'cpu', socketSpanPenalty: 'cpu', numaAware: 'cpu',
  dma: 'ram', prefetch: 'ram', multiChannel: 'ram', dimmFactor: 'ram', ramWatts: 'ram', hotPages: 'ram', ecc: 'ram',
  tensorRate: 'gpu', vramPerLevel: 'gpu', vramScale: 'gpu', unifiedMemory: 'gpu', gpuLink: 'gpu', npuTensorOnly: 'gpu',
  ncq: 'drive', sharedStorage: 'drive', hotPlug: 'drive',
  powerCap: 'psu', s3Sleep: 'psu',
  accelBoard: 'board', telemetry: 'board', autoReturn: 'board', autoSkip: 'board', offlineCap: 'board', bootSeconds: 'board',
  configSave: 'board', rollingUpgrade: 'board', liveMigration: 'board', hotSwap: 'board', gracefulDrain: 'board',
  cutThrough: 'switch', qos: 'switch',
  shardSteal: 'lb', gather: 'lb', checkpointing: 'lb',
  thermalThrottle: 'rackCooling', rackSetpoint: 'rackCooling', rackWater: 'rackCooling',
  stealRoom: 'netRack',
  roomLeak: 'roomCooling', roomSetpoint: 'roomCooling', economizer: 'roomCooling',
  loadShed: 'ups', dualFeed: 'ups', upsRideThrough: 'ups',
  subseaLatency: 'backbone',
};
/** Strategy and filter scopes: the router (or scheduler) they configure. */
const SCOPE: Readonly<Record<string, ResearchPartId>> = {
  system: 'queue', rack: 'lb', net: 'lb', room: 'netRack', site: 'dataPlane', global: 'globalScheduler',
};

const LEVEL_TAB: Readonly<Record<LevelId, ResearchTabId>> = { chip: 'cpu', system: 'system', rack: 'rack', room: 'room', global: 'global' };

/** The part a node grows from, or null when none of its effects names one. */
export function derivePart(def: ResearchDef): ResearchPartId | null {
  if (def.category === 'structure') return 'structure';
  // A fab installs a whole CPU generation (package, cores, clock, caches, scheduler).
  if (def.effects.some((e) => e.kind === 'gen' && e.part === 'cpu')) return 'fab';
  for (const e of def.effects) {
    const part = e.kind === 'gen' ? GEN[e.part] : e.kind === 'ceiling' ? CEILING[e.key] : e.kind === 'rule' ? RULE[e.id]
      : e.kind === 'strategy' || e.kind === 'filter' ? SCOPE[e.scope] : e.kind === 'view' ? 'structure' : undefined;
    if (part) return part;
  }
  return null;
}

export interface ResearchRoot { readonly part: ResearchPartId; readonly tab: ResearchTabId }
const ROOTS = new Map<string, ResearchRoot>(RESEARCH.map((def) => {
  // An unmapped node shows as structure on its level's tab; researchParts.test.ts keeps that set empty.
  const part = derivePart(def) ?? 'structure';
  return [def.id, { part, tab: part === 'structure' ? LEVEL_TAB[def.level] : PART_TAB[part] }];
}));

/** The root and tab of a research node (concept C). */
export const researchRoot = (id: string): ResearchRoot => ROOTS.get(id) ?? { part: 'structure', tab: 'system' };
