import type { FamilyId, LevelId, ResearchId } from './ids';
import type { Amount } from '../amount';

/* ---------- Code tables. Index = the byte stored in compiled buffers. Order is part of the save format. ---------- */

/** System (scheduler) strategies, spec §8.1. Index 0 is the no-scheduler default. */
export const QUEUE_STRATEGY_IDS = ['fifo', 'sjf', 'timeSlice', 'priority', 'mlfq'] as const;
export type QueueStrategyId = (typeof QUEUE_STRATEGY_IDS)[number];
/** Network strategies, spec §8.3. Index 0 is the free base (D1.5). */
export const ROUTE_STRATEGY_IDS = ['firstFit', 'roundRobin', 'leastConn', 'weighted', 'leastWork', 'binPack', 'latency', 'price', 'affinity', 'linkAware'] as const;
export type RouteStrategyId = (typeof ROUTE_STRATEGY_IDS)[number];
export type StrategyId = QueueStrategyId | RouteStrategyId;
/** Filters in application order (spec §8.4). Bit i of a filter mask = FILTER_IDS[i]. */
export const FILTER_IDS = ['region', 'capability', 'health', 'power', 'thermal', 'local'] as const;
export type FilterId = (typeof FILTER_IDS)[number];

export const REGION_IDS = ['us-east', 'us-west', 'eu-west', 'eu-north', 'sa-east', 'af-south', 'ap-southeast', 'ap-northeast'] as const;
export type RegionId = (typeof REGION_IDS)[number];
export type Continent = 'americas' | 'europe' | 'africa' | 'asiaPacific';
export interface RegionDef {
  readonly id: RegionId;
  readonly continent: Continent;
  readonly opensWith: 'start' | 'regions' | 'intercontinental';
  readonly outsideF: number;
  /** Credits per joule, float64 (spec §3.3). */
  readonly energyPrice: number;
}

/** Task stage resources (spec §5.1, D26.3): compute ops, mem bits touched (the old RAM stream and storage IO), GPU ops. */
export const RESOURCES = ['compute', 'mem', 'gpu'] as const;
export type Resource = (typeof RESOURCES)[number];
/** D26.1: the memory tiers, fastest first. A shard's working set is placed cache, then RAM, then disk. */
export const MEM_TIERS = ['cache', 'ram', 'disk'] as const;
export type MemTier = (typeof MEM_TIERS)[number];

/* ---------- Parts (spec Appendix A) ---------- */

export const PART_IDS = [
  'core', 'clock', 'l1', 'l2', 'l3', 'scheduler', 'cpu', 'psu',
  'ram', 'gpu', 'npu', 'storage', 'storageNode',
  'rackCooler', 'pdu', 'lb', 'switch', 'roomCooler', 'ups', 'row', 'roomLb', 'roomSwitch',
  'dataPlane', 'grid', 'zone', 'site', 'backbone', 'globalScheduler', 'rack', 'acceleratorBoard',
] as const;
export type PartId = (typeof PART_IDS)[number];
/** `step`: the CSV progression for clocks and RAM (hardware-progression.md): ×1.5 per level, 36 levels, prices ×1.7. */
export type Curve = 'flow' | 'core' | 'linear' | 'fixed' | 'step';
export type CoolTech = 'air' | 'water' | 'closedLoop';
export type PartScope = 'chip' | 'system' | 'rack' | 'room' | 'site' | 'global';

/** How a part draws (spec §9.1, D6.1: watts follow work). */
export type WattsRule =
  /** Rate parts: wPerUnit × rate × push^0.3. */
  | { readonly kind: 'rate'; readonly wPerUnit: number }
  /** Non-rate parts: idle[g] × x^0.25. */
  | { readonly kind: 'idle'; readonly idle: readonly number[] }
  | { readonly kind: 'cooler'; readonly wpw: readonly number[] }
  | { readonly kind: 'supply'; readonly loss: readonly number[]; readonly lossPerLevel: number };
/** Spec Appendix A.5. Prices are whole Credits per generation; upgrades grow as x^1.2. */
export interface PartRow {
  readonly id: PartId; readonly scope: PartScope; readonly names: readonly string[]; readonly gates: readonly ResearchId[];
  readonly curve: Curve; readonly levelMax?: number;
  readonly base: readonly number[]; readonly base2?: readonly number[];
  readonly watts: WattsRule;
  readonly price: readonly number[]; readonly upgrade: readonly number[];
  /** clock: upgrade price × lanes on the socket. */
  readonly upgradeDrive?: 'lanes';
  readonly tech?: readonly CoolTech[]; readonly tau?: readonly number[];
  readonly tensorFactor?: readonly number[];
}
export interface LadderRow {
  readonly id: 'switch' | 'roomSwitch' | 'dataPlane' | 'backbone'; readonly scope: PartScope;
  readonly names: readonly string[]; readonly gates: readonly ResearchId[];
  readonly baseK: readonly number[]; readonly topK: readonly number[]; readonly latency: readonly number[];
  readonly minPorts: number; readonly portCeiling?: 'rackPorts' | 'roomPorts';
  /** W per bit/s of port speed. */
  readonly wPerUnit: number;
  readonly price: readonly number[]; readonly portStep: readonly number[];
  readonly portAdd?: readonly number[]; readonly portAddGrowth?: number;
}

/* ---------- Task families (docs/tasks.md; scripts/market-model.ts) ---------- */

export type BandId = 'bits' | 'ints' | 'threads' | 'ram' | 'gpu' | 'storage' | 'rackDist' | 'roomDist' | 'multiAz' | 'region';
/** A quantity that grows with the cohort's size draw: value = fixed + perSize × size. */
export interface SizeTerm { readonly fixed: number; readonly perSize: number }
export interface StageDef { readonly resource: Resource; readonly work: SizeTerm }
export type RegionReq =
  | { readonly kind: 'any' }
  | { readonly kind: 'in'; readonly region: RegionId }
  | { readonly kind: 'spread'; readonly regions: number };
export interface FamilyDef {
  readonly id: FamilyId;
  readonly key: string;
  readonly name: string;
  readonly band: BandId;
  readonly note: string;
  /** Intensity window [from, to) in which the family is in the mix. */
  readonly window: { readonly from: number; readonly to: number };
  readonly weight: number;
  /** Per unit of size, run in order: a shard of u units has stage work perSize × u (D25.1). */
  readonly stages: readonly StageDef[];
  /**
   * D25.1: the fewest size units that must run together. A task has at most floor(s / ĝ) shards,
   * ĝ = max(grain, ceil(s / 256)); a shard of u units runs on max(1, floor(u / grain)) threads.
   */
  readonly grain: number;
  readonly workingSet: SizeTerm;
  readonly vramBits: SizeTerm;
  /** D25.6 minimum split: at least this many shards on distinct systems; 1 for ordinary tasks. */
  readonly members: number;
  readonly minZones: number;
  readonly region: RegionReq;
  /** Tensor units accelerate GPU stages (D1.4). */
  readonly tensor: boolean;
  /** Every member's system needs all-ECC RAM (D1.4). */
  readonly ecc: boolean;
  /** Fixed per-task GPU core minimum. Cores are a compatibility gate, never reserved. */
  readonly gpuCoresMin: number;
  /** Preferred board class for the affinity router (D7.7): GPU, tensor and big-memory families are 'accelerator'. */
  readonly affinity: 'general' | 'accelerator';
  /** Credits per Data, 10 to 100 (D3.2). Jittered per round by the market. */
  readonly dataRatio: number;
  /** D26.5 completion window in seconds from take, before size jitter; null before rackDist. */
  readonly windowS: number | null;
}

/* ---------- Research (docs/research.md §9) ---------- */

export type ResearchCategory = 'compute' | 'memory' | 'accel' | 'storage' | 'scheduling' | 'network' | 'power' | 'cooling' | 'structure' | 'operations';
export type Era = 'hz' | 'khz' | 'mhz' | 'ghz';
export type WorkTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
export type CeilingId =
  | 'coreSites' | 'lanesPerCore' | 'threadsPerCore' | 'cpuSockets'
  | 'ramSlots' | 'ramLevelBonus' | 'l3LevelBonus' | 'gpuSlots' | 'driveSlots'
  | 'rackPorts' | 'roomPorts' | 'uplinks' | 'researchQueue'
  | 'roomRows' | 'siteZones' | 'sites' | 'regions';
/** "net" = every network scope the player has opened. */
export type Scope = 'system' | 'rack' | 'room' | 'site' | 'global' | 'net';
export const RULE_IDS = [
  'workStealing', 'numaAware', 'smt', 'socketSpanPenalty', 'dma', 'prefetch', 'multiChannel', 'ecc',
  'hotPages', 'tensorRate', 'gpuLink', 'npuTensorOnly', 'vramPerLevel', 'vramScale', 'ramWatts', 'ncq',
  'sharedStorage', 'cutThrough', 'qos', 'routingCapacity', 'linkScale', 'subseaLatency',
  'coreIdle', 'packageIdle', 's3Sleep', 'dvfs', 'turbo', 'powerCap', 'loadShed', 'lossFraction',
  'supplyCapacity', 'dualFeed', 'upsRideThrough', 'thermalThrottle', 'rackSetpoint', 'rackWater', 'roomLeak',
  'roomSetpoint', 'economizer', 'telemetry', 'autoReturn', 'autoSkip', 'gracefulDrain', 'bootSeconds', 'offlineCap',
  'configSave', 'rollingUpgrade', 'hotPlug', 'liveMigration', 'hotSwap', 'checkpointing',
  /** D25.9 split rules (spec §8.5). */
  'gather', 'shardSteal', 'stealRoom',
  /** D26.4: VRAM overflows to RAM, then disk. */
  'unifiedMemory',
] as const;
export type RuleId = (typeof RULE_IDS)[number];
export type ResearchEffect =
  | { readonly kind: 'gen'; readonly part: PartId; readonly gen: number }
  | { readonly kind: 'ceiling'; readonly key: CeilingId; readonly value: number }
  | { readonly kind: 'strategy'; readonly scope: Scope; readonly id: StrategyId }
  | { readonly kind: 'filter'; readonly scope: Scope; readonly id: FilterId }
  | { readonly kind: 'view'; readonly level: LevelId }
  | { readonly kind: 'rule'; readonly id: RuleId; readonly params?: Readonly<Record<string, number>> };
export type AnswerCode =
  | BandId | 'pickup' | 'misroute' | 'gate' | 'overload' | 'heat' | 'energy' | 'transfer' | 'downtime' | 'density' | 'idle';
export interface ResearchDef {
  /** D32: whole Credits paid once when research starts, 10 × the node's price. */
  readonly creditCost: Amount;
  readonly id: ResearchId;
  readonly name: string;
  readonly category: ResearchCategory;
  readonly requires: readonly ResearchId[];
  readonly level: LevelId;
  readonly era: Era;
  readonly tier: WorkTier;
  /** Whole Data paid at start (D3.4); 0 for D32 Credits-only nodes. Literals up to ~6e19 are exact doubles. */
  readonly data: number;
  /** Compute work volume in ops. */
  readonly work: number;
  readonly effects: readonly ResearchEffect[];
  /** One-line effect copy, docs/research.md §5. */
  readonly effect: string;
  /** R45: the short effect line, at most about 40 characters (§5 Short column). */
  readonly summary: string;
  readonly answers: readonly AnswerCode[];
  /** False hides the node until its mechanic lands (architecture §8 risk 2). */
  readonly implemented: boolean;
}
