import type { BuildState } from '../types/build';
import type { RuleId } from '../types/catalog';
import type { Unlocks } from '../types/state';
import type { World } from '../core/world';

/** Per-system switch bits, after the matching research rule. */
export const SYS_DVFS = 1;
export const SYS_TURBO = 2;

/**
 * Player settings and research rules phys reads every tick, flattened into typed arrays.
 * Derived only from `build` and `unlocks`, which change only through actions, so one cached
 * copy serves every tick until either object is replaced.
 */
export interface PhysSettings {
  readonly sys: Uint8Array;
  /** Deepest C-state allowed: index into CSTATES + 1 (0 = none). */
  readonly cmax: Uint8Array;
  readonly rackSetpointF: Float64Array;
  readonly roomSetpointF: Float64Array;
  readonly upsCount: Uint8Array;
  readonly packageIdle: boolean;
  readonly s3Sleep: boolean;
  readonly throttle: boolean;
  readonly rackSetpoint: boolean;
  readonly roomSetpoint: boolean;
  readonly economizer: boolean;
  /** Actual component draw begins at System. */
  readonly realDraw: boolean;
}

/**
 * One idle sleep mode uses the factor of the highest purchased C-state level.
 */
const deepestResearched = (rules: readonly RuleId[], params: Unlocks['ruleParams']): number => {
  if (!rules.includes('coreIdle')) return 0;
  return (params.coreIdle?.level ?? 0) > 0 ? 1 : 0;
};
const limitIndex = (limit: number): number => {
  return limit > 0 ? 1 : 0;
};

export function deriveSettings(build: BuildState, unlocks: Unlocks, nSys: number, nRack: number, nRoom: number): PhysSettings {
  const rules = unlocks.rules;
  const has = (id: RuleId) => rules.includes(id);
  const dvfs = has('dvfs'), turbo = has('turbo');
  const cResearched = deepestResearched(rules, unlocks.ruleParams);
  const sys = new Uint8Array(nSys), cmax = new Uint8Array(nSys);
  build.systems.forEach((s) => {
    if (!s || s.id >= nSys) return;
    const { settings } = s.spec;
    sys[s.id] = (dvfs && settings.dvfs ? SYS_DVFS : 0) | (turbo && settings.turbo ? SYS_TURBO : 0);
    cmax[s.id] = Math.min(cResearched, limitIndex(settings.cStateLimit));
  });
  const rackSetpointF = new Float64Array(nRack);
  build.racks.forEach((r) => {
    if (!r || r.id >= nRack) return;
    rackSetpointF[r.id] = r.cooler.setpointF;
  });
  const roomSetpointF = new Float64Array(nRoom), upsCount = new Uint8Array(nRoom);
  build.rooms.forEach((m) => {
    if (!m || m.id >= nRoom) return;
    roomSetpointF[m.id] = m.cooler.setpointF;
    upsCount[m.id] = m.ups.length;
  });
  return {
    sys, cmax, rackSetpointF, roomSetpointF, upsCount,
    packageIdle: has('packageIdle'), s3Sleep: has('s3Sleep'), throttle: has('thermalThrottle'),
    rackSetpoint: has('rackSetpoint'), roomSetpoint: has('roomSetpoint'), economizer: has('economizer'),
    realDraw: unlocks.levels.system,
  };
}

/**
 * One entry per build, so a preview world (a quote's one-system build) cannot evict the live
 * world's settings: the power and thermal caches key on this object's identity.
 */
const memo = new WeakMap<BuildState, { unlocks: Unlocks; settings: PhysSettings }>();

/** Cached settings for the world's build and unlocks (a pure function of both). */
export function physSettings(w: World): PhysSettings {
  const { build } = w;
  const unlocks = w.research.unlocks;
  const c = w.compiled;
  const hit = memo.get(build);
  if (hit && hit.unlocks === unlocks && hit.settings.sys.length === c.sys.len
    && hit.settings.rackSetpointF.length === c.rack.len && hit.settings.upsCount.length === c.room.len) return hit.settings;
  const settings = deriveSettings(build, unlocks, c.sys.len, c.rack.len, c.room.len);
  memo.set(build, { unlocks, settings });
  return settings;
}
