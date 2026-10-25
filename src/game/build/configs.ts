import { CONFIG_NAME_MAX, SAVED_CONFIGS_PER_KIND } from '../core/constants';
import { accept, reject } from '../core/actions';
import type { ActionOutcome } from '../types/actions';
import type { BuildState, PartLevel, RackConfig, SavedConfigs, SystemConfig, SystemSpec } from '../types/build';
import type { UnitKind, UnitRef } from '../types/ids';
import type { GameState } from '../types/state';
import { ECC_PRICE_FACTOR, LADDERS, PARTS, networkStepsBetween, scalePrice, upgradesBetween, type CatalogRow } from './catalog';
import { rackConfig, rackLock, roomConfig, siteConfig, systemConfig, systemLock } from './configModel';
import { withSpec } from './partAccess';
import { coldScopes, fail, locked, planned, type Plan } from './plan';
import { cpuLanes, cpuPrice, partFromNothing } from './pricing';
import { ruleLock, genLock } from './locks';
import { findSaved } from './units';
import { mergeAccels } from './configAccels';
import { lbQueueStepsTo } from './catalog/network';

/* ---------- Save and delete (spec §13.5) ---------- */

export const cleanName = (name: string): string | null => {
  const t = name.trim();
  return t.length >= 1 && t.length <= CONFIG_NAME_MAX ? t : null;
};

const extract = (build: BuildState, unit: UnitRef) =>
  unit.kind === 'system' ? systemConfig(build, unit.id) : unit.kind === 'rack' ? rackConfig(build, unit.id)
    : unit.kind === 'room' ? roomConfig(build, unit.id) : siteConfig(build, unit.id);

export function saveConfig(state: GameState, unit: UnitRef, name: string): ActionOutcome {
  const lock = ruleLock(state.research.unlocks, 'configSave');
  if (lock) return reject(state, 'locked', lock.text);
  const clean = cleanName(name);
  if (!clean) return reject(state, 'invalid', `Names are 1–${CONFIG_NAME_MAX} characters`);
  const config = extract(state.build, unit);
  if (!config) return reject(state, 'invalid', 'No such unit');
  const list = state.configs[unit.kind] as readonly { name: string; config: unknown }[];
  const at = list.findIndex((c) => c.name.toLowerCase() === clean.toLowerCase());
  if (at < 0 && list.length >= SAVED_CONFIGS_PER_KIND) return reject(state, 'cap', 'Saved configurations are full');
  const entry = { name: clean, config };
  const next = at < 0 ? [...list, entry] : list.map((c, i) => (i === at ? entry : c));
  return accept({ ...state, configs: { ...state.configs, [unit.kind]: next } as SavedConfigs });
}

export function deleteConfig(state: GameState, kind: UnitKind, name: string): ActionOutcome {
  const list = state.configs[kind] as readonly { name: string }[];
  const next = list.filter((c) => c.name.toLowerCase() !== name.trim().toLowerCase());
  if (next.length === list.length) return reject(state, 'invalid', 'No such saved configuration');
  return accept({ ...state, configs: { ...state.configs, [kind]: next } as SavedConfigs });
}

/* ---------- Apply onto an existing unit (spec §13.4) ---------- */

interface Merge { price: bigint; cold: boolean }
/**
 * One part: same generation → upgrade to the configured level, paying the missing levels (hot), or
 * keep a higher level; another generation or missing → install (cold); present but unconfigured → remove (cold).
 */
function mergePart<T extends PartLevel>(row: CatalogRow, have: T | null | undefined, want: T | null | undefined, m: Merge, factor = 1, lanes = 1): T | null {
  if (!want) { if (have) m.cold = true; return null; }
  if (have && have.gen === want.gen) {
    if (have.level >= want.level) return have.level === want.level ? want : have;
    m.price += scalePrice(upgradesBetween(row, have.gen, have.level, want.level, lanes), factor);
    return want;
  }
  m.cold = true;
  m.price += scalePrice(partFromNothing(row, want, 0, 1, lanes), factor);
  return want;
}
const mergeList = <T extends PartLevel>(row: (t: T) => CatalogRow, have: readonly T[], want: readonly T[], m: Merge, factor: (t: T) => number = () => 1): T[] => {
  const out: T[] = [];
  for (let i = 0; i < Math.max(have.length, want.length); i += 1) {
    const w = want[i];
    const r = mergePart(row((w ?? have[i])!), have[i], w, m, w ? factor(w) : 1);
    if (r) out.push(r);
  }
  return out;
};

/** Merges a configured spec onto a system's spec. Returns the config's own object when nothing is kept (R20 sharing). */
export function mergeSpec(have: SystemSpec, want: SystemSpec): { spec: SystemSpec; price: bigint; cold: boolean; accelCold: boolean } {
  const m: Merge = { price: 0n, cold: have.kind !== want.kind || have.board !== want.board };
  let cpu = want.cpu;
  if (want.cpu) {
    const n = BigInt(Math.max(1, want.cpuCount));
    const c = have.cpu;
    const per: Merge = { price: 0n, cold: false };
    if (c && have.cpuCount > 0) {
      cpu = {
        cpu: mergePart(PARTS.cpu, c.cpu, want.cpu.cpu, per)!, cores: mergeList(() => PARTS.core, c.cores, want.cpu.cores, per),
        clock: mergePart(PARTS.clock, c.clock, want.cpu.clock, per, 1, cpuLanes(want.cpu))!, l1: mergePart(PARTS.l1, c.l1, want.cpu.l1, per)!,
        l2: mergePart(PARTS.l2, c.l2, want.cpu.l2, per), l3: mergePart(PARTS.l3, c.l3, want.cpu.l3, per),
      };
      m.price += per.price * BigInt(Math.min(have.cpuCount, want.cpuCount));
      if (want.cpuCount > have.cpuCount) m.price += cpuPrice(cpu) * BigInt(want.cpuCount - have.cpuCount);
      m.cold ||= per.cold || want.cpuCount !== have.cpuCount;
    } else {
      m.price += cpuPrice(want.cpu) * n;
      m.cold = true;
    }
  } else if (have.cpu) m.cold = true;
  const scheduler = mergePart(PARTS.scheduler, have.scheduler, want.scheduler, m);
  const ram = mergeList(() => PARTS.ram, have.ram, want.ram, m, (r) => (r.ecc ? ECC_PRICE_FACTOR : 1));
  const accelerators = mergeAccels(have.accels, want.accels);
  const accels = accelerators.accels;
  m.price += accelerators.price;
  m.cold ||= accelerators.cold;
  const drives = mergeList(() => PARTS.storage, have.drives, want.drives, m);
  const psu = mergePart(PARTS.psu, have.psu, want.psu, m)!;
  const merged: SystemSpec = { ...want, cpu, scheduler: scheduler && want.scheduler ? { ...scheduler, strategy: want.scheduler.strategy } : null, ram, accels, drives, psu: { ...psu, capped: want.psu.capped } };
  const same = JSON.stringify(merged) === JSON.stringify(want);
  return { spec: same ? want : merged, price: m.price, cold: m.cold, accelCold: accelerators.cold };
}

export function planApplyConfig(state: GameState, unit: UnitRef, name: string): Plan {
  const lock = ruleLock(state.research.unlocks, 'configSave');
  if (lock) return locked(lock, name);
  const saved = findSaved(state, unit.kind, name);
  if (!saved) return fail('invalid', 'No such saved configuration', name);
  const u = state.research.unlocks;
  if (unit.kind === 'system') {
    const sys = state.build.systems[unit.id];
    if (!sys) return fail('invalid', 'No such system');
    const want = (saved.config as SystemConfig).spec;
    const r = mergeSpec(sys.spec, want);
    const l = systemLock(u, want);
    if (l) return locked(l, saved.name, r.price);
    return planned({ build: withSpec(state.build, unit.id, r.spec), price: r.price, cold: r.cold ? coldScopes(state, unit) : [],
      kill: r.accelCold ? [unit] : [], inventoryChangedSystems: r.accelCold ? [unit.id] : [] }, saved.name);
  }
  if (unit.kind === 'rack') {
    const rack = state.build.racks[unit.id];
    if (!rack?.opened) return fail('invalid', 'No such rack');
    const want = saved.config as RackConfig;
    const l = rackLock(u, want);
    const m: Merge = { price: 0n, cold: false };
    const cooler = { ...mergePart(PARTS.rackCooler, rack.cooler, want.cooler, m)!, setpointF: want.cooler.setpointF };
    const pdu = { ...mergePart(PARTS.pdu, rack.pdu, want.pdu, m)!, capped: want.pdu.capped };
    const lbPart = mergePart(PARTS.lb, rack.lb, want.lb, m)!;
    // Queue slots only grow, like part levels: the steps from the rack's level to the saved one.
    const queueLevel = Math.max(rack.lb.queueLevel, want.lb.queueLevel);
    m.price += lbQueueStepsTo('rack', queueLevel) - lbQueueStepsTo('rack', rack.lb.queueLevel);
    const sw = rack.switch.gen === want.switch.gen ? rack.switch : null;
    if (!sw) return fail('invalid', 'Replace the switch first');
    const row = LADDERS.switch;
    const ports = sw.ports.map((k, i) => Math.max(k, want.switch.ports[i] ?? k));
    for (let i = 0; i < ports.length; i += 1) m.price += networkStepsBetween(row, sw.ports[i]!, ports[i]!);
    // D31: Power control copies hot (a battery and controller change nothing running), with its Start settings.
    const hotMerge: Merge = { price: 0n, cold: false };
    const powerCtl = want.powerCtl ? { ...want.powerCtl, ...mergePart(PARTS.powerCtl, rack.powerCtl, want.powerCtl, hotMerge)! } : rack.powerCtl;
    m.price += hotMerge.price;
    const ctlLock = want.powerCtl ? genLock(u, 'powerCtl', want.powerCtl.gen) : null;
    if (ctlLock) return locked(ctlLock, saved.name, m.price);
    let build: BuildState = { ...state.build, racks: state.build.racks.map((r, i) => (i === unit.id && r ? { ...r, cooler, pdu, lb: { ...want.lb, gen: lbPart.gen, level: lbPart.level, queueLevel }, switch: { ...sw, ports, sameSpeed: want.switch.sameSpeed }, powerCtl } : r)) };
    const cold = new Set<number>();
    const kill: UnitRef[] = [];
    const inventoryChangedSystems: number[] = [];
    rack.servers.forEach((s, slot) => {
      const w = want.servers[slot];
      if (s === null || !w) return;
      const r = mergeSpec(build.systems[s]!.spec, w.spec);
      m.price += r.price;
      if (r.cold) cold.add(s);
      if (r.accelCold) { kill.push({ kind: 'system', id: s }); inventoryChangedSystems.push(s); }
      build = withSpec(build, s, r.spec);
    });
    if (l) return locked(l, saved.name, m.price);
    const scopes = m.cold ? coldScopes(state, unit) : [...cold].flatMap((s) => coldScopes(state, { kind: 'system', id: s as never }));
    return planned({ build, price: m.price, cold: scopes, kill, inventoryChangedSystems }, saved.name);
  }
  return fail('invalid', 'Apply a zone or site configuration by building a new one');
}
