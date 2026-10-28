import type { CeilingId, RegionDef } from '../types/catalog';

/* ---------- Time (spec §2, Appendix B). Every rule duration becomes whole ticks. ---------- */
export const TICK_MS = 100;
export const DT_S = TICK_MS / 1000;
export const TICKS_PER_SECOND = 1000 / TICK_MS;
export const secondsToTicks = (s: number) => Math.round(s * TICKS_PER_SECOND);

/** D10.3: the head must be taken by the end of tick headTick + HEAD_TICKS − 1 (10 s). A market deadline, not hardware time. */
export const HEAD_TICKS = 100;
export const headDeadlineTick = (headTick: number) => headTick + HEAD_TICKS - 1;
/** The head plus the next 50 incoming tasks, all frozen in the saved queue. */
export const QUEUE_VISIBLE = 51;
/** Keep the opening SLA grace based on the same five tasks as before. */
export const GRACE_WINDOW = 5;

/** Base boot latency; Boot loader levels lower it. */
export const BOOT_TICKS_BASE = secondsToTicks(10);
export const OVERLOAD_FAIL_TICKS = secondsToTicks(10);
export const CRASH_TICKS = secondsToTicks(10);
export const CRASH_TEMP_F = 100;
export const RECOVER_TEMP_F = 90;
export const FLOOR_TEMP_F = 50;
export const HOME_TEMP_F = 70;
/** A lump within this of its equilibrium snaps to it (spec §10.5), enabling the quiescent skip. */
export const SETTLE_EPS_F = 0.05;
/** The market's per-tick rate ring: 10 s (takes per second, spec §16.2). */
export const RATE_RING_TICKS = secondsToTicks(10);
export const AUTO_RETURN_DELAY_TICKS = secondsToTicks(120);
export const OFFLINE_CAP_HOURS_BASE = 8;

/* ---------- SLA (program D10.6, spec §4.2) ---------- */
export const SLA_THRESHOLD = 0.8;
/** D28: the 80% check starts once this many tasks have resolved (met + failed). */
export const SLA_MIN_RESOLVED = 10;
/** D28: the SLA counts the last this many resolved tasks of the round. */
export const SLA_WINDOW = 50;
/** D33: a running round also ends when no task has been met for this long (a named deadline). */
export const STALL_END_TICKS = 1200;
/** G = SLA_GRACE_TASKS × the largest of the five opening tasks' work. */
export const SLA_GRACE_TASKS = 10;

/* ---------- Fleet caps (architecture §1.9) ---------- */
export const SERVERS_PER_RACK = 12;
export const RACK_SLOTS_PER_ROW = 8;
export const MAX_ROWS = 3;
export const RACKS_PER_ROOM = RACK_SLOTS_PER_ROW * MAX_ROWS; // 24
export const MAX_ZONES_PER_SITE = 3;
export const MAX_SITES = 8;
export const MAX_RACK_PORTS = 12;
export const MAX_ROOM_PORTS = 24;
export const MAX_UPLINKS = 4;
export const MAX_SCHED_K = 32;
export const MAX_SCHED_Q = 8;
/* D7: CPUs, boards and configuration efficiency. */
export const MAX_CORES_PER_CPU = 32;
export const MAX_CPUS = 4;
export const GENERAL_MAX_RAM = 4;
export const GENERAL_MAX_GPUS = 2;
export const ACCEL_MAX_CPUS = 2;
export const ACCEL_RAM_SLOTS = 8;
export const ACCEL_GPU_SLOTS = 8;
export const MAX_ACCELS = 8;
export const POOL_DOMAIN = 8;
export const ACCEL_DOMAINS = 9;
export const ACCEL_CLOCKS = 18;
/** η_cfg = SOCKET_FACTOR[cpus − 1] × dimmFactor (spec §6.2, starting values). */
export const SOCKET_FACTOR: readonly number[] = [1, 0.92, 0.85, 0.78];
/** dimmFactor by RAM modules on a general board: 0–2 → 1, 3 → 0.95, 4 → 0.9; an accelerator board is 1 up to 8. */
export const DIMM_FACTOR: readonly number[] = [1, 1, 1, 0.95, 0.9];
/** D25.1: a task has at most this many shards; also the largest minimum split (members). */
export const MAX_SHARDS = 256;
/** Resource clocks per system (exec/shape): CPU, RAM, GPU, IO (the disk tier). Stride of every per-resource column. */
export const RES_CLOCKS = 4;
/** D26.5 deadline ring buckets (architecture §1.4); every window (at most 288 s × size jitter) is shorter. */
export const DEADLINE_BUCKETS = 4096;
/** D25.7: router queue levels run 1 … ROUTER_QUEUE_MAX, one slot per level. */
export const ROUTER_QUEUE_MAX = 8;
/** D25.9 Gather: a queued entry dispatches anyway after this many ticks (10 s). A deadline, not hardware time. */
export const GATHER_WAIT_TICKS = secondsToTicks(10);
/** D25 checkpointing: a lost shard's replacement must be picked up within this many ticks (10 s). */
export const CHECKPOINT_TICKS = secondsToTicks(10);
export const MAX_UPS = 2;
/** Catalog bound for per-family tallies. */
export const MAX_FAMILIES = 128;

/**
 * Ceilings at the start (spec §12.2) and at the architecture caps ("archCap"). D39: research never raises a part
 * count. Cores, ports, uplinks, rows, zones and sites are bought up to their caps from the start (each still needs
 * its level open); board sockets and slots come with `systemBoard`. One thread per core: no SMT.
 */
export const CEILINGS_START: Readonly<Record<CeilingId, number>> = {
  coreSites: 32, threadsPerCore: 1, cpuSockets: 1, ramSlots: 1, ramLevelBonus: 0,
  gpuSlots: 1, driveSlots: 1, rackPorts: MAX_RACK_PORTS, roomPorts: MAX_ROOM_PORTS, uplinks: MAX_UPLINKS, researchQueue: 1,
  roomRows: MAX_ROWS, siteZones: MAX_ZONES_PER_SITE, sites: MAX_SITES, regions: MAX_SITES,
};
export const CEILINGS_MAX: Readonly<Record<CeilingId, number>> = {
  coreSites: 32, threadsPerCore: 1, cpuSockets: 4, ramSlots: 4, ramLevelBonus: 4,
  gpuSlots: 2, driveSlots: 4, rackPorts: MAX_RACK_PORTS, roomPorts: MAX_ROOM_PORTS, uplinks: MAX_UPLINKS, researchQueue: 3,
  roomRows: MAX_ROWS, siteZones: MAX_ZONES_PER_SITE, sites: MAX_SITES, regions: MAX_SITES,
};
export const ROUND_REPORTS_KEPT = 20;
export const NET_WINDOW_TICKS = secondsToTicks(60);
/** Queued tasks a system snapshot samples. */
export const QUEUE_SAMPLE = 8;
export const RECENT_OUTCOMES = 16;
export const EVENT_RING_SIZE = 256;
export const SETPOINT_DEFAULT_F = 70;
export const CONFIG_NAME_MAX = 24;
export const SAVED_CONFIGS_PER_KIND = 32;

/** Regions (spec §3.3), REGION_IDS order. Site 0 is the gateway in us-east. */
export const REGIONS: readonly RegionDef[] = [
  { id: 'us-east', continent: 'americas', opensWith: 'start', outsideF: 70, energyPrice: 0.01, sun: 1.0, wind: 1.0 },
  { id: 'us-west', continent: 'americas', opensWith: 'regions', outsideF: 75, energyPrice: 0.012, sun: 1.3, wind: 0.9 },
  { id: 'eu-west', continent: 'europe', opensWith: 'regions', outsideF: 60, energyPrice: 0.014, sun: 0.8, wind: 1.2 },
  { id: 'eu-north', continent: 'europe', opensWith: 'regions', outsideF: 45, energyPrice: 0.009, sun: 0.5, wind: 1.5 },
  { id: 'sa-east', continent: 'americas', opensWith: 'regions', outsideF: 85, energyPrice: 0.008, sun: 1.3, wind: 0.8 },
  { id: 'af-south', continent: 'africa', opensWith: 'regions', outsideF: 90, energyPrice: 0.007, sun: 1.5, wind: 1.0 },
  { id: 'ap-southeast', continent: 'asiaPacific', opensWith: 'regions', outsideF: 88, energyPrice: 0.011, sun: 1.2, wind: 0.7 },
  { id: 'ap-northeast', continent: 'asiaPacific', opensWith: 'regions', outsideF: 65, energyPrice: 0.016, sun: 0.9, wind: 1.0 },
];
export const DEFAULT_SEED = 0x1d1eb17;
/**
 * D36: real watts per sim watt. The sim's power, energy and price-per-joule numbers keep their scale (so Credits,
 * heat and every rule are untouched); every view converts at the boundary, so a boot CPU reads microwatts and
 * a late fleet MW to GW. View W = sim W × POWER_SCALE; view J likewise; view Credits/J = sim Credits/J ÷ POWER_SCALE.
 */
export const POWER_SCALE = 1e-6;
export const viewW = (simW: number): number => simW * POWER_SCALE;
export const viewPricePerJ = (simPrice: number): number => simPrice / POWER_SCALE;

/** Player-facing level names. The id `chip` stays in code; the player sees "CPU" (D7.1). */
export const LEVEL_NAMES = { chip: 'CPU', system: 'System', rack: 'Rack', room: 'Room', global: 'World' } as const;
