import type { CeilingId, RegionDef } from '../types/catalog';

/* ---------- Time (spec §2, Appendix B). Every rule duration becomes whole ticks. ---------- */
export const TICK_MS = 100;
export const DT_S = TICK_MS / 1000;
export const TICKS_PER_SECOND = 1000 / TICK_MS;
export const secondsToTicks = (s: number) => Math.round(s * TICKS_PER_SECOND);

/** D10.3: the head must be taken by the end of tick headTick + HEAD_TICKS − 1 (10 s). A market deadline, not hardware time. */
export const HEAD_TICKS = 100;
export const headDeadlineTick = (headTick: number) => headTick + HEAD_TICKS - 1;
/** The visible window of the endless queue, head first (spec §5.2). */
export const QUEUE_VISIBLE = 5;

/** One boot time (D1.8), at base. fastBoot lowers it to 5 s, then 2 s. */
export const BOOT_TICKS_BASE = secondsToTicks(10);
export const OVERLOAD_FAIL_TICKS = secondsToTicks(10);
export const CRASH_TICKS = secondsToTicks(10);
export const CRASH_TEMP_F = 100;
export const RECOVER_TEMP_F = 90;
export const FLOOR_TEMP_F = 50;
export const HOME_TEMP_F = 70;
/** A lump within this of its equilibrium snaps to it (spec §10.5), enabling the quiescent skip. */
export const SETTLE_EPS_F = 0.05;
export const HEALTH_WINDOW_TICKS = secondsToTicks(60);
/** The market's per-tick rate ring: 10 s (takes per second, spec §16.2). */
export const RATE_RING_TICKS = secondsToTicks(10);
export const AUTO_RETURN_DELAY_TICKS = secondsToTicks(120);
export const OFFLINE_CAP_HOURS_BASE = 8;

/* ---------- SLA (program D10.6, spec §4.2) ---------- */
export const SLA_THRESHOLD = 0.8;
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
export const MAX_SCHED_Q = 32;
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
export const MAX_GANG_MEMBERS = 256;
export const MAX_UPS = 2;
export const MAX_ACTIVE_FAMILIES = 12;
/** Catalog bound for per-family tallies. */
export const MAX_FAMILIES = 64;
export const MAX_SYSTEMS = MAX_SITES * MAX_ZONES_PER_SITE * RACKS_PER_ROOM * SERVERS_PER_RACK; // 6,912

/** Ceilings at the start (spec §12.2) and at the architecture caps ("archCap"). */
export const CEILINGS_START: Readonly<Record<CeilingId, number>> = {
  coreSites: 1, lanesPerCore: 1, threadsPerCore: 1, cpuSockets: 1, ramSlots: 1, ramLevelBonus: 0, l3LevelBonus: 0,
  gpuSlots: 1, driveSlots: 1, rackPorts: 4, roomPorts: 4, uplinks: 1, researchQueue: 1, roomRows: 2, siteZones: 2,
  sites: 1, regions: 1,
};
export const CEILINGS_MAX: Readonly<Record<CeilingId, number>> = {
  coreSites: 32, lanesPerCore: 32, threadsPerCore: 2, cpuSockets: 4, ramSlots: 4, ramLevelBonus: 4, l3LevelBonus: 2,
  gpuSlots: 2, driveSlots: 4, rackPorts: MAX_RACK_PORTS, roomPorts: MAX_ROOM_PORTS, uplinks: MAX_UPLINKS, researchQueue: 3,
  roomRows: MAX_ROWS, siteZones: MAX_ZONES_PER_SITE, sites: MAX_SITES, regions: MAX_SITES,
};

/* ---------- Economy ---------- */
export const CREDITS_PER_WORK_UNIT = 1;
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
  { id: 'us-east', continent: 'americas', opensWith: 'start', outsideF: 70, energyPrice: 0.01 },
  { id: 'us-west', continent: 'americas', opensWith: 'regions', outsideF: 75, energyPrice: 0.012 },
  { id: 'eu-west', continent: 'europe', opensWith: 'regions', outsideF: 60, energyPrice: 0.014 },
  { id: 'eu-north', continent: 'europe', opensWith: 'intercontinental', outsideF: 45, energyPrice: 0.009 },
  { id: 'sa-east', continent: 'americas', opensWith: 'intercontinental', outsideF: 85, energyPrice: 0.008 },
  { id: 'af-south', continent: 'africa', opensWith: 'intercontinental', outsideF: 90, energyPrice: 0.007 },
  { id: 'ap-southeast', continent: 'asiaPacific', opensWith: 'regions', outsideF: 88, energyPrice: 0.011 },
  { id: 'ap-northeast', continent: 'asiaPacific', opensWith: 'intercontinental', outsideF: 65, energyPrice: 0.016 },
];
export const DEFAULT_SEED = 0x1d1eb17;

/** Player-facing level names. The id `chip` stays in code; the player sees "CPU" (D7.1). */
export const LEVEL_NAMES = { chip: 'CPU', system: 'System', rack: 'Rack', room: 'Room', global: 'Global' } as const;
