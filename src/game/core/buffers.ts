import { FAIL_CAUSES, FAIL_DETAILS } from '../types/events';
import { MAX_CPUS, MAX_FAMILIES, MAX_RACK_PORTS, MAX_ROOM_PORTS, MAX_SITES, MAX_UPLINKS, MAX_UPS, MAX_ZONES_PER_SITE, RACKS_PER_ROOM, RATE_RING_TICKS, SERVERS_PER_RACK } from './constants';
import { allocTable, cloneTable, type Layout, type Table } from './table';
import { ACCEL_CLOCKS, ACCEL_DOMAINS, DEADLINE_BUCKETS, MAX_ACCELS, RES_CLOCKS, ROUTER_QUEUE_MAX } from './constants';
import { copyCompletionLog } from './completions';

/*
 * Buffer layouts (architecture §1.3). Row index = unit id. Field-writer table (architecture §2.2):
 *
 * | Group                                                         | Writer                         |
 * |---------------------------------------------------------------|--------------------------------|
 * | compiled: alive, opened, kind, parents, slots, children, intent | core/topology                 |
 * | compiled: every other column                                  | build/compile (S5)             |
 * | hot sys mode, timer                                           | core/timers; phys via setMode  |
 * | hot clocks, due, nextDue, threads, used, queues, reserved,    | exec (S3)                      |
 * |   freeSlots, admitted, estS, sockBusy, researchRate, busy,    |                                |
 * |   pipe*; takeTick/takes (exec before Rack, net from Rack on); |                                |
 * |   record stage/start/finish/flags; G.execStamp                |                                |
 * |   rack dirty (phys may also set it to 1, never clear it);     |                                |
 * |   G.running; G.researchOps (adds; build reads and zeroes it)  |                                |
 * | hot link FIFOs, backlog, busyS, bitClock; lb cursors, routed, | net (S3)                       |
 * |   lbLast, wrr, globalWrr, G.globalCursor/Routed/Last          |                                |
 * |   wrr counters; rq; parent rows                               |                                |
 * | queue front list, record taken/payout, rate ring, family      | market (S2)                    |
 * |   jitter, round counters (G met/failed/work/taken/dismissed), |                                |
 * |   rng; zeroes detailRound at round start                      |                                |
 * | drawW, supply usage/timers/flags, capFactor, clockFactor,     | phys (S4)                      |
 * |   emptySinceTick, temps, eff, effClock, crash timers, cooler  |                                |
 * |   duty/W, region bill W                                       |                                |
 * | per-family tallies (fam.*Tick, metSys, failDetail), tally     | exec/market/phys add through   |
 * |   pairs, detailRound                                          |   core/events; core clears     |
 * | pool free lists (G.recFree, G.parentFree, rec.next on free)   | core/pool                      |
 * | wallet, ledger                                                | core/ledger (plain state)      |
 * | research progress; build and compiled inside a tick (step 12) | build (World.build, .compiled) |
 *
 * Timers are whole ticks (Int32), never float seconds, so 10 s is exactly 100 ticks.
 */

const u8 = { t: 'u8' } as const;
const u16 = { t: 'u16' } as const;
const u32 = { t: 'u32' } as const;
const i32 = { t: 'i32' } as const;
const f64 = { t: 'f64' } as const;
const neg1 = { t: 'i32', fill: -1 } as const;
const R = RES_CLOCKS;

/* ---------- compiled ---------- */
const COOLER = { coolerQc: f64, coolerTau: f64, coolerIdleW: f64, coolerLoadW: f64, coolerTech: u8, setpointF: f64, hasSetpoint: u8, leak: f64 } as const;
/** lbQueueSlots: the router queue's level L (D25.7), 1–32. */
const ROUTER = { lbStrategy: u8, lbFilters: u8, lbQueueSlots: u8, lbIdleW: f64, lbLoadW: f64 } as const;

export const SYS_COMPILED = {
  alive: u8, kind: u8, intent: u8, rack: i32, room: i32, site: i32, slot: u8,
  port: neg1, threads: u16, cores: u16, sockets: u8, K: u16, Q: u16, keff: u16, slots: u16, strategy: u8,
  /**
   * D26.1 memory tiers: cacheBits (Σ L1+L2+L3), ramCap (Σ modules), storageCap (Σ own drives) and diskNode, the
   * rack's storage node whose free capacity extends the disk tier (sharedStorage; -1 none). memCap is the whole
   * hierarchy, cache + RAM + drives + the node's drives: the only memory gate. ioRate is the disk tier's IO.
   */
  threadRate: f64, clockHz: f64, cacheBits: f64, ramCap: f64, memCap: f64, hasRam: u8, ramBw: f64, ecc: u8,
  gpuOps: f64, tensorOps: f64, vram: f64, npu: u8, storageCap: f64, diskNode: neg1, ioRate: f64, ioConc: u8,
  /** D26.4 unifiedMemory: RAM + disk a VRAM need may overflow into (static gate); 0 without the rule. */
  unifiedBits: f64,
  accelKind: { t: 'u8', stride: MAX_ACCELS }, gpuLinked: u8,
  accelCores: { t: 'f64', stride: MAX_ACCELS }, accelClockHz: { t: 'f64', stride: MAX_ACCELS },
  accelVram: { t: 'f64', stride: MAX_ACCELS }, accelOps: { t: 'f64', stride: MAX_ACCELS },
  accelTensorOps: { t: 'f64', stride: MAX_ACCELS }, accelIdleW: { t: 'f64', stride: MAX_ACCELS }, accelLoadW: { t: 'f64', stride: MAX_ACCELS },
  idleW: { t: 'f64', stride: R }, loadW: { t: 'f64', stride: R },
  /** Cores and clock watts over every socket at their gen and level, before §9.3 factors; idleW/loadW[cpu] hold only the uncore. */
  coreIdleW: f64, coreLoadW: f64, clockIdleW: f64, clockLoadW: f64,
  psuCapW: f64, psuLoss: f64, psuCapSwitch: u8, rules: u32,
  /** D7: board (0 general, 1 accelerator; `sockets` = CPU count) and configuration efficiency η_cfg (× rate, ÷ heat, with e(T)). */
  board: u8, etaCfg: { t: 'f64', fill: 1 },
  /** D10.4: the inbound pipe in bit/s. Before Rack it carries every task; from Rack on the switch port does. */
  pipeSpeed: f64,
  /** Pipe watts per bit/s sent (the rack-switch port rule, A.3); billed on the system before Rack. */
  pipeWPerBit: f64,
} as const satisfies Layout;
export const RACK_COMPILED = {
  alive: u8, opened: u8, intent: u8, room: i32, slot: u8, servers: { t: 'i32', stride: SERVERS_PER_RACK, fill: -1 },
  ...COOLER, pduCapW: f64, pduLoss: f64, pduCapSwitch: u8, ...ROUTER,
  ports: u8, uplinks: u8, portLink: { t: 'i32', stride: MAX_RACK_PORTS, fill: -1 }, uplinkLink: { t: 'i32', stride: MAX_UPLINKS, fill: -1 },
} as const satisfies Layout;
export const ROOM_COMPILED = {
  alive: u8, opened: u8, intent: u8, site: i32, zone: u8, rows: u8, racks: { t: 'i32', stride: RACKS_PER_ROOM, fill: -1 },
  ...COOLER, upsCount: u8, upsCapW: { t: 'f64', stride: MAX_UPS }, upsLoss: { t: 'f64', stride: MAX_UPS }, upsGen: { t: 'u8', stride: MAX_UPS },
  ...ROUTER, ports: u8, uplinks: u8,
  portLink: { t: 'i32', stride: MAX_ROOM_PORTS, fill: -1 }, uplinkLink: { t: 'i32', stride: MAX_UPLINKS, fill: -1 },
} as const satisfies Layout;
export const SITE_COMPILED = {
  alive: u8, opened: u8, intent: u8, region: u8, zones: { t: 'i32', stride: MAX_ZONES_PER_SITE, fill: -1 },
  gridCapW: f64, gridLoss: f64, dpSpeed: f64, dpLatencyTicks: i32, dpStrategy: u8, dpFilters: u8, dpQueueSlots: u8,
  dpLink: { t: 'i32', stride: MAX_ZONES_PER_SITE, fill: -1 }, backboneLink: neg1,
} as const satisfies Layout;
/** One row. */
export const GLOBAL_COMPILED = { exists: u8, ...ROUTER } as const satisfies Layout;
/** Link kind: LINK_KIND. One row per link; a link has `channels` channels sharing one FIFO. */
export const LINK_COMPILED = { kind: u8, owner: i32, channels: u8, rung: u8, speed: f64, latencyTicks: i32, idleW: f64, loadW: f64 } as const satisfies Layout;
export const LINK_KIND = { server: 0, rack: 1, zone: 2, backbone: 3 } as const;

/* ---------- hot ---------- */
export const SYS_HOT = {
  mode: u8, timer: i32,
  accelUsedVram: { t: 'f64', stride: ACCEL_DOMAINS }, accelHolders: { t: 'u16', stride: ACCEL_DOMAINS },
  accelWAnchor: { t: 'f64', stride: ACCEL_CLOCKS }, accelEAnchor: { t: 'f64', stride: ACCEL_CLOCKS },
  accelRate: { t: 'f64', stride: ACCEL_CLOCKS }, accelDue: { t: 'f64', stride: ACCEL_CLOCKS, fill: Infinity },
  accelHead: { t: 'i32', stride: ACCEL_CLOCKS, fill: -1 }, accelActive: { t: 'u16', stride: ACCEL_CLOCKS },
  accelTaskS: { t: 'f64', stride: MAX_ACCELS }, accelResearchS: { t: 'f64', stride: MAX_ACCELS }, accelResearchOps: f64,
  wAnchor: { t: 'f64', stride: R }, eAnchor: { t: 'f64', stride: R }, rate: { t: 'f64', stride: R },
  due: { t: 'f64', stride: R, fill: Infinity }, head: { t: 'i32', stride: R, fill: -1 }, active: { t: 'u16', stride: R },
  busyThreads: u16,
  /** D26.1: bits held per tier by running shards (and unified-memory VRAM overflow); a storage node's usedDisk includes servers' spill onto it. */
  usedCache: f64, usedRam: f64, usedDisk: f64, usedVram: f64, queueHead: neg1, queueTail: neg1, queueLen: u16,
  running: u16, reserved: u16, ioHolds: u8, busy: f64, researchOps: f64,
  /** D27: threads this system holds for the research task (0 = not a holder). Counted in busyThreads and as one admitted slot. */
  researchThreads: u16,
  /** Σ est seconds of admitted + reserved tasks (leastWork); busy threads per socket; research ops/s at e = 1. */
  estS: f64, sockBusy: { t: 'u16', stride: MAX_CPUS }, researchRate: f64,
  drawW: f64, psuUsage: f64, psuOverTicks: i32, psuRebootTicks: i32, capFactor: { t: 'f64', fill: 1 },
  idleSinceTick: i32, cstate: u8, turboOn: u8, dvfsOn: u8, wakeTicks: i32, failedTick: neg1,
  /** DVFS × turbo × throttle × PSU and PDU cap, set by phys for the next tick; exec multiplies it into the clock. */
  clockFactor: { t: 'f64', fill: 1 },
  /** Last tick the system held an admitted or reserved task (S3 sleep). */
  emptySinceTick: i32,
  /**
   * The inbound pipe before Rack (D10.4, spec §6.4): the record in transfer (-1 none), its bits
   * still to send from tick fraction pipeT0, and the bits sent this tick (0.1 W per bit/s).
   */
  pipeRec: neg1, pipeLeft: f64, pipeT0: f64, pipeBits: f64,
  /** Takes this tick (spec §6.4: at most `slots` per tick); `takes` counts for tick `takeTick` only. */
  takeTick: neg1, takes: u16,
} as const satisfies Layout;
const LUMP = {
  tempF: { t: 'f64', fill: 70 }, crashTicks: i32, crashed: u8, recoverTicks: i32,
  coolerDuty: f64, coolerW: f64, heatW: f64, drawW: f64, failedTick: neg1,
} as const;
const ROUTER_HOT = { lbCursor: i32, lbRouted: u32, lbLast: neg1 } as const;
export const RACK_HOT = {
  ...LUMP, eff: { t: 'f64', fill: 1 }, effClock: f64, throttled: u8,
  pduUsage: f64, pduOverTicks: i32, pduRebootTicks: i32, pduFailed: u8, capFactor: { t: 'f64', fill: 1 },
  nextDue: { t: 'f64', fill: Infinity }, dirty: u8, freeSlots: u16, admitted: u32, estS: f64, researchRate: f64,
  ...ROUTER_HOT, wrr: { t: 'f64', stride: SERVERS_PER_RACK },
} as const satisfies Layout;
export const ROOM_HOT = {
  ...LUMP, upsUsage: { t: 'f64', stride: MAX_UPS }, upsOverTicks: { t: 'i32', stride: MAX_UPS },
  upsRebootTicks: { t: 'i32', stride: MAX_UPS }, upsFailed: { t: 'u8', stride: MAX_UPS }, rideTicks: i32,
  freeSlots: u32, admitted: u32, estS: f64, ...ROUTER_HOT, wrr: { t: 'f64', stride: RACKS_PER_ROOM },
} as const satisfies Layout;
export const SITE_HOT = {
  drawW: f64, gridUsage: f64, gridOverTicks: i32, gridRebootTicks: i32, gridFailed: u8, failedTick: neg1,
  freeSlots: u32, admitted: u32, estS: f64, ...ROUTER_HOT, wrr: { t: 'f64', stride: MAX_ZONES_PER_SITE },
} as const satisfies Layout;
/** `backlog`: queued, unsent bits on the link (first-link room, spec §7.4). */
export const LINK_HOT = { head: neg1, tail: neg1, qlen: i32, backlog: f64, busyS: f64, bitClock: f64 } as const satisfies Layout;

/** Record location codes (rec.loc). */
/** front: taken work returned to the queue front (spec §5.2). probe: the head materialized for a take attempt. */
export const LOC = { free: 0, front: 1, link: 2, queue: 3, running: 4, probe: 5 } as const;
/**
 * Task cohort records (architecture §1.4). Since D25 a record is a task or one shard of a task:
 * `units` its size units, `parent` its parent row (-1 for an unsplit task), `shard` its index
 * and `sib` the next record of the same parent. `payout` is the whole task's W for an unsplit
 * task and unused for a shard (pay comes from the parent row).
 */
export const RECORD = {
  /** Lifetime accelerator assignment, including stages on other resources. */
  accelDomain: neg1,
  family: u16, count: u32, stage: u8, units: f64, payout: f64, shard: u16, sib: neg1,
  /** Owning resource's work clock W when the current stage started, and the W at which it finishes. */
  /** `taken`: the tick the task was taken (strategy ties: earlier take first). */
  start: f64, finish: f64, taken: i32, taskId: f64,
  /** Exec record bits (socket span, IO hold, waiting). */
  flags: u8,
  /** D26.5: completion window in ticks from take (-1 none), frozen at the draw; with `taken` it is the task's clock. */
  deadline: neg1,
  /**
   * D26.1 placement per task, bits, written at start (exec/memory) and released once: cache, RAM, disk (memN
   * of it on the rack storage node). trafR/trafD: frozen traffic fractions of its mem stages (D26.2).
   * vramR/vramD (vramN on the node): unified-memory VRAM overflow (D26.4). `part`: the current stage part.
   */
  memC: f64, memR: f64, memD: f64, memN: f64, trafR: f64, trafD: f64, vramR: f64, vramD: f64, vramN: f64, part: u8,
  loc: u8, owner: neg1, target: neg1, prev: neg1, next: neg1, parent: neg1, threads: u16,
} as const satisfies Layout;
/**
 * The parent pool (D25 data layout): one row per split task. `units` and `work` are the whole
 * task's s and W; `placed` shards hold indices 0 … placed − 1, `done` of them finished, and
 * `pending` shares still wait in router queues. The task is met when done === placed with
 * nothing pending. `head` starts the sibling list (rec.sib); `taken` is the pickup tick.
 * With checkpointing a lost shard leaves `lostCause`, `replaceDeadline` (tick), and the
 * replacement's rack and units in `replaceRack` / `replaceUnits`. `next` chains the free list.
 */
export const PARENT = {
  taskId: f64, family: u16, units: f64, work: f64, minShards: u16, placed: u16, done: u16, pending: u16,
  head: neg1, taken: i32,
  /**
   * D26.5: the window in ticks (-1 none) and the deadline ring links (core/deadlines: bucket
   * (taken + deadline − 1) % DEADLINE_BUCKETS, doubly linked through dlPrev/dlNext). `tier`: the slowest
   * tier its shards' traffic touched (0 none, 1 RAM, 2 disk); ramBits/diskBits: that traffic of done shards.
   */
  deadline: neg1, dlPrev: neg1, dlNext: neg1, tier: u8, ramBits: f64, diskBits: f64,
  lostCause: { t: 'u8', fill: 255 }, replaceDeadline: neg1, replaceRack: neg1, replaceUnits: f64, replaceShard: u16, next: neg1,
} as const satisfies Layout;
/**
 * Router queues (D25.7), one row per router: global 0, then sites, zones (rooms), racks, each in id
 * order (rqRow). A ring of ROUTER_QUEUE_MAX entries from rqHead, rqLen long, oldest first. An entry
 * is a whole task (rqParent -1: its family in rqFamily) or a share of parent row rqParent.
 * `rqWait` 1: the front entry could not be split and nothing below the router has changed since
 * (net/hops.ts retries it only after a wake, core/routerQueue.ts).
 */
export const RQ = {
  rqTask: { t: 'f64', stride: ROUTER_QUEUE_MAX }, rqParent: { t: 'i32', stride: ROUTER_QUEUE_MAX, fill: -1 },
  rqUnits: { t: 'f64', stride: ROUTER_QUEUE_MAX }, rqSince: { t: 'i32', stride: ROUTER_QUEUE_MAX },
  rqFamily: { t: 'u16', stride: ROUTER_QUEUE_MAX }, rqHead: u8, rqLen: u8, rqWait: u8,
} as const satisfies Layout;
/** Completed cohorts this tick: (payout per task, count). Ledger sums and clears. */
export const TALLY = { pay: f64, count: f64 } as const satisfies Layout;
/** Fixed MAX_FAMILIES rows. *Tick columns are this tick's tallies; core clears them at tick end.
 * metSys / metRack / metRoom / metSite: the one unit where the family's cohorts completed this tick, -1 none yet, -2 several. */
export const FAMILY_HOT = {
  /** Round report work sums and dismissals. Saved so a mid-round reload preserves the breakdown. */
  metWorkRound: f64, failedWorkRound: f64, dismissedRound: f64,
  metTick: u32, metSys: { t: 'i32', fill: -1 }, metRack: { t: 'i32', fill: -1 }, metRoom: { t: 'i32', fill: -1 }, metSite: { t: 'i32', fill: -1 }, failTick: { t: 'u32', stride: FAIL_CAUSES.length },
  /** Detail of the last failure per cause this tick (FAIL_DETAILS index, 255 none). */
  failDetail: { t: 'u8', stride: FAIL_CAUSES.length, fill: 255 },
  dataTick: f64, weightJitter: { t: 'f64', fill: 1 }, dataRatio: f64,
} as const satisfies Layout;
/**
 * Fixed RATE_RING_TICKS rows (10 s), ring indexed by tick % rows (market). `at` = the tick that
 * wrote the row (-1 never), so readers skip rows left from skipped ticks or an earlier round.
 */
export const RING_HOT = {
  at: neg1, taken: u32, met: u32, failed: u32, failBy: { t: 'u32', stride: FAIL_CAUSES.length },
} as const satisfies Layout;

/** Global hot scalars: index into `hot.g`. Integers are stored exactly in float64. */
export const G = {
  /** The queue front: taken work returned to the market (spec §5.2), a record list. */
  frontHead: 0, frontTail: 1, frontLen: 2, transitCount: 3, nextTaskId: 4, rngDraws: 5, met: 6, failed: 7,
  /** failByCause: G.fail + FAIL_CAUSES index (7 slots, 8..14; D26.5 added late). */
  fail: 8, running: 15, researchOps: 16, recFree: 17, parentFree: 18,
  /** Round SLA sums in ops (spec §4.2). */
  deliveredWork: 19, globalCursor: 20, globalRouted: 21, utilityW: 22, onlineThreads: 23, busyThreads: 24,
  /** Live rows in rec / parent (core/pool). */
  recUsed: 25, parentUsed: 26,
  /** Exec: build revision + research mode it last anchored rates against; the global scheduler's last pick. */
  execStamp: 27, globalLast: 28,
  failedWork: 30,
  /** This tick's met and failed work; the SLA step folds them into the round sums. */
  metWorkTick: 31, failWorkTick: 32,
  /** Tasks taken and dismissed this round. */
  taken: 33, dismissed: 34,
  /** The site and room counts hot.rq rows are laid out for (rqRow); syncHotSizes moves rows when they change. */
  rqSites: 35, rqRooms: 36,
  /** Router-queue entries over every router (feed counts). */
  rqTotal: 37,
  /** Parent rows waiting for a checkpoint replacement shard (net scans them only when > 0). */
  replacing: 38,
  /** Build revision and research count the router-queue waits were last valid for (net/hops.ts). */
  routeStamp: 39,
  /** D26 round spill sums: bits met tasks' shards touched in RAM and on disk (RoundReport.spill). */
  ramWork: 40, diskWork: 41,
  /** Queued tasks over every system (moved here when late took slot 14). */
  queued: 42,
  /** D27: systems holding the research task, and the TREE_INDEX of the project they hold it for (-1 none). */
  researchHolders: 43, researchProject: 44,
} as const;
export const G_SIZE = 45;

export interface CompiledBuffers {
  readonly sys: Table<typeof SYS_COMPILED>;
  readonly rack: Table<typeof RACK_COMPILED>;
  readonly room: Table<typeof ROOM_COMPILED>;
  readonly site: Table<typeof SITE_COMPILED>;
  readonly global: Table<typeof GLOBAL_COMPILED>;
  readonly link: Table<typeof LINK_COMPILED>;
}
export interface HotBuffers {
  readonly g: Float64Array;
  /** xoshiro128** words (market only). */
  readonly rng: Uint32Array;
  readonly sys: Table<typeof SYS_HOT>;
  readonly rack: Table<typeof RACK_HOT>;
  readonly room: Table<typeof ROOM_HOT>;
  readonly site: Table<typeof SITE_HOT>;
  readonly link: Table<typeof LINK_HOT>;
  readonly rec: Table<typeof RECORD>;
  readonly parent: Table<typeof PARENT>;
  readonly rq: Table<typeof RQ>;
  readonly tally: Table<typeof TALLY>;
  readonly fam: Table<typeof FAMILY_HOT>;
  readonly ring: Table<typeof RING_HOT>;
  /** Watts billed per region this tick (REGION_IDS order), written by phys. */
  readonly bill: Float64Array;
  /** Round failure counts by [cause × FAIL_DETAILS.length + detail]; core/events adds, market zeroes at round start. */
  readonly detailRound: Float64Array;
  /** Smooth weighted round-robin counters of the global scheduler, per site (net). */
  readonly globalWrr: Float64Array;
  /** D26.5 deadline ring: per bucket the first parent row whose window ends at a tick ≡ bucket (-1 none). */
  readonly dlHead: Int32Array;
}

/** Router rows: global, sites, rooms, racks (RQ). */
export const routerRows = (size: { readonly sites: number; readonly rooms: number; readonly racks: number }): number => 1 + size.sites + size.rooms + size.racks;

export interface FleetSize { readonly systems: number; readonly racks: number; readonly rooms: number; readonly sites: number; readonly links: number }

export function allocCompiled(size: FleetSize): CompiledBuffers {
  return {
    sys: allocTable(SYS_COMPILED, size.systems, size.systems),
    rack: allocTable(RACK_COMPILED, size.racks, size.racks),
    room: allocTable(ROOM_COMPILED, size.rooms, size.rooms),
    site: allocTable(SITE_COMPILED, size.sites, size.sites),
    global: allocTable(GLOBAL_COMPILED, 1, 1),
    link: allocTable(LINK_COMPILED, size.links, size.links),
  };
}

export function allocHot(size: FleetSize, records = 8): HotBuffers {
  const g = new Float64Array(G_SIZE);
  g[G.nextTaskId] = 1;
  g[G.frontHead] = -1; g[G.frontTail] = -1; g[G.recFree] = -1; g[G.parentFree] = -1;
  g[G.rqSites] = size.sites; g[G.rqRooms] = size.rooms; g[G.researchProject] = -1;
  return {
    g, rng: new Uint32Array(4),
    sys: allocTable(SYS_HOT, size.systems, size.systems),
    rack: allocTable(RACK_HOT, size.racks, size.racks),
    room: allocTable(ROOM_HOT, size.rooms, size.rooms),
    site: allocTable(SITE_HOT, size.sites, size.sites),
    link: allocTable(LINK_HOT, size.links, size.links),
    rec: allocTable(RECORD, records), parent: allocTable(PARENT, 1), tally: allocTable(TALLY, 8),
    rq: allocTable(RQ, routerRows(size), routerRows(size)),
    fam: allocTable(FAMILY_HOT, MAX_FAMILIES, MAX_FAMILIES),
    ring: allocTable(RING_HOT, RATE_RING_TICKS, RATE_RING_TICKS),
    bill: new Float64Array(MAX_SITES),
    detailRound: new Float64Array(FAIL_CAUSES.length * FAIL_DETAILS.length),
    globalWrr: new Float64Array(MAX_SITES),
    dlHead: new Int32Array(DEADLINE_BUCKETS).fill(-1),
  };
}

export function cloneHot(hot: HotBuffers, copyDisplayHistory = true): HotBuffers {
  const copy: HotBuffers = {
    g: hot.g.slice(), rng: hot.rng.slice(),
    sys: cloneTable(hot.sys), rack: cloneTable(hot.rack), room: cloneTable(hot.room), site: cloneTable(hot.site),
    link: cloneTable(hot.link), rec: cloneTable(hot.rec), parent: cloneTable(hot.parent), rq: cloneTable(hot.rq), tally: cloneTable(hot.tally),
    fam: cloneTable(hot.fam), ring: cloneTable(hot.ring), bill: hot.bill.slice(),
    detailRound: hot.detailRound.slice(), globalWrr: hot.globalWrr.slice(), dlHead: hot.dlHead.slice(),
  };
  if (copyDisplayHistory) copyCompletionLog(hot, copy);
  return copy;
}

export function cloneCompiled(c: CompiledBuffers): CompiledBuffers {
  return {
    sys: cloneTable(c.sys), rack: cloneTable(c.rack), room: cloneTable(c.room), site: cloneTable(c.site),
    global: cloneTable(c.global), link: cloneTable(c.link),
  };
}
