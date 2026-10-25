import { allocCompiled } from '../core/buffers';
import { baseRouter, barebonesSpec, rackSwitch as starterRackSwitch, roomSwitch as starterRoomSwitch } from '../core/defaults';
import { SETPOINT_DEFAULT_F } from '../core/constants';
import type {
  BoardKind, BuildState, CoolerBuild, RackConfig, RoomConfig, RouterBuild, SiteConfig, SupplyBuild, SwitchBuild, SystemConfig, SystemSpec,
} from '../types/build';
import type { RuleId } from '../types/catalog';
import { rackId, systemId } from '../types/ids';
import type { LockReason } from '../types/quotes';
import type { Unlocks } from '../types/state';
import { capacity, LADDERS, PARTS } from './catalog';
import { compileSystem } from './compile';
import { ceilingLock, genLock, levelLock, optionLock, ruleLock } from './locks';
import { boardLimit } from './partPlans';
import { newestGen } from './research/unlocks';
import { evaluateGpu, gpuModel } from './catalog/gpuModels';

/* ---------- Extract: a unit's configuration shares the unit's immutable parts (R20) ---------- */

export const systemConfig = (build: BuildState, id: number): SystemConfig | null => {
  const s = build.systems[id];
  return s ? { online: s.online, spec: s.spec } : null;
};
export function rackConfig(build: BuildState, id: number): RackConfig | null {
  const r = build.racks[id];
  if (!r) return null;
  const { id: _id, room: _room, slot: _slot, opened: _opened, servers, ...rest } = r;
  return { ...rest, servers: servers.map((s) => (s === null ? null : systemConfig(build, s))) };
}
export function roomConfig(build: BuildState, id: number): RoomConfig | null {
  const z = build.rooms[id];
  if (!z) return null;
  const { id: _id, site: _site, zone: _zone, opened: _opened, racks, ...rest } = z;
  return { ...rest, racks: racks.map((r) => (r === null ? null : rackConfig(build, r))) };
}
export function siteConfig(build: BuildState, id: number): SiteConfig | null {
  const s = build.sites[id];
  if (!s) return null;
  const { id: _id, region: _region, opened: _opened, backbone: _bb, zones, ...rest } = s;
  return { ...rest, zones: zones.map((z) => (z === null ? null : roomConfig(build, z))) };
}

/* ---------- Barebones (spec §13.2) ---------- */

/** Full-load watts of a spec: every part's idle + load at full use (§9.1). */
export function fullLoadWatts(spec: SystemSpec, u: Unlocks): number {
  const c = allocCompiled({ systems: 1, racks: 0, rooms: 0, sites: 0, links: 0 });
  compileSystem(c, { id: systemId(0), rack: rackId(0), slot: 0, online: true, spec }, u);
  let watts = c.sys.coreIdleW[0]! + c.sys.coreLoadW[0]! + c.sys.clockIdleW[0]! + c.sys.clockLoadW[0]!;
  for (let r = 0; r < 4; r += 1) watts += c.sys.idleW[r]! + c.sys.loadW[r]!;
  return watts;
}

/** The newest researched PSU at the lowest level that covers full load (its top level if none does). */
export function sizedPsu(spec: SystemSpec, u: Unlocks): SupplyBuild {
  const g = Math.max(0, newestGen(u, 'psu', PARTS.psu.base.length));
  const need = fullLoadWatts(spec, u);
  const top = 11 + g;
  let level = 1;
  while (level < top && capacity(PARTS.psu, g, level) < need) level += 1;
  return { gen: g, level, capped: false };
}

const SIZED = new Map<string, SystemSpec>();
/** One shared spec per (tier, board, kind, PSU), so barebones systems share their parts (R20). */
export function barebonesSystemSpec(tier: number, u: Unlocks, board: BoardKind = 'general', storageNode = false): SystemSpec {
  const shape: SystemSpec = storageNode
    ? { ...barebonesSpec(0, 'general'), kind: 'storageNode', cpu: null, cpuCount: 0, drives: [{ gen: Math.max(0, newestGen(u, 'storage', PARTS.storage.base.length)), level: 1 }] }
    : barebonesSpec(tier, board);
  const psu = sizedPsu(shape, u);
  const key = `${storageNode ? 's' : tier}:${board}:${shape.drives[0]?.gen ?? ''}:${psu.gen}:${psu.level}`;
  let spec = SIZED.get(key);
  if (!spec) { spec = { ...shape, psu }; SIZED.set(key, spec); }
  return spec;
}

const cooler: CoolerBuild = { gen: 0, level: 1, setpointF: SETPOINT_DEFAULT_F };
const supply: SupplyBuild = { gen: 0, level: 1, capped: false };
const router: RouterBuild = baseRouter(0);
const rackSwitch: SwitchBuild = starterRackSwitch(0, 4);
const roomSwitch: SwitchBuild = starterRoomSwitch(0, 4);

export const barebonesRackConfig = (): RackConfig =>
  ({ online: true, cooler, pdu: supply, lb: router, switch: rackSwitch, powerCtl: null, servers: Array(12).fill(null) });
export const barebonesRoomConfig = (): RoomConfig =>
  ({ online: true, rows: 2, switch: roomSwitch, lb: router, cooler, ups: [supply], start: null, racks: Array(16).fill(null) });
export const barebonesSiteConfig = (): SiteConfig =>
  ({ online: true, dataPlane: { gen: 0, k: LADDERS.dataPlane.baseK[0]!, router }, grid: supply, generation: null, zones: [barebonesRoomConfig(), null, null] });

/* ---------- Locks (spec §13.3): the first missing item ---------- */

type Check = () => LockReason | null;
const first = (checks: readonly Check[]): LockReason | null => { for (const c of checks) { const l = c(); if (l) return l; } return null; };
const partOk = (u: Unlocks, id: Parameters<typeof genLock>[1], p: { gen: number; level: number }, ecc = false): Check[] =>
  [() => genLock(u, id, p.gen), () => levelLock(u, id, p.gen, p.level, ecc)];
const slots = (u: Unlocks, have: number, limit: number, key: Parameters<typeof ceilingLock>[1]): Check =>
  () => (have <= limit ? null : ceilingLock(u, key, have) ?? { code: 'cap', node: null, text: 'Too many parts' });

export function systemLock(u: Unlocks, spec: SystemSpec): LockReason | null {
  const checks: Check[] = [];
  if (spec.kind === 'storageNode') checks.push(() => ruleLock(u, 'sharedStorage'));
  if (spec.board === 'accelerator') checks.push(() => ruleLock(u, 'accelBoard' as RuleId));
  const cpu = spec.cpu;
  if (cpu) {
    checks.push(...partOk(u, 'cpu', cpu.cpu), ...partOk(u, 'clock', cpu.clock), ...partOk(u, 'l1', cpu.l1));
    for (const c of cpu.cores) checks.push(...partOk(u, 'core', c));
    if (cpu.l2) checks.push(...partOk(u, 'l2', cpu.l2));
    if (cpu.l3) checks.push(...partOk(u, 'l3', cpu.l3));
    checks.push(slots(u, cpu.cores.length, boardLimit(spec, u, 'core'), 'coreSites'), slots(u, spec.cpuCount, boardLimit(spec, u, 'socket'), 'cpuSockets'));
  }
  if (spec.scheduler) checks.push(...partOk(u, 'scheduler', spec.scheduler), () => (spec.scheduler!.strategy === 'fifo' ? null : optionLock(u, spec.scheduler!.strategy, 'queue')));
  for (const m of spec.ram) checks.push(...partOk(u, 'ram', m, m.ecc), () => (m.ecc ? ruleLock(u, 'ecc') : null));
  for (const a of spec.accels) {
    if (a.kind === 'npu') checks.push(...partOk(u, 'npu', a));
    else {
      checks.push(() => {
        const native = gpuModel(a.model);
        if (!native) return { code: 'fit', node: null, text: 'Unknown GPU model' };
        try { evaluateGpu(a.model, a.upgrades); }
        catch { return { code: 'fit', node: null, text: 'Invalid GPU upgrades' }; }
        return genLock(u, 'gpu', native.generation - 1);
      });
    }
  }
  for (const d of spec.drives) checks.push(...partOk(u, 'storage', d));
  checks.push(slots(u, spec.ram.length, boardLimit(spec, u, 'ram'), 'ramSlots'), slots(u, spec.accels.length, boardLimit(spec, u, 'gpu'), 'gpuSlots'), slots(u, spec.drives.length, boardLimit(spec, u, 'drive'), 'driveSlots'));
  checks.push(...partOk(u, 'psu', spec.psu), () => (spec.psu.capped ? ruleLock(u, 'powerCap') : null));
  checks.push(() => (spec.settings.dvfs ? ruleLock(u, 'dvfs') : null), () => (spec.settings.turbo ? ruleLock(u, 'turbo') : null), () => (spec.settings.cStateLimit > 0 ? ruleLock(u, 'coreIdle') : null));
  return first(checks);
}

function routerChecks(u: Unlocks, r: RouterBuild): Check[] {
  return [
    () => (r.strategy === 'firstFit' ? null : optionLock(u, r.strategy, 'route')),
    ...r.filters.map((f): Check => () => optionLock(u, f, 'filter')),
  ];
}
function switchChecks(u: Unlocks, sw: SwitchBuild, room: boolean): Check[] {
  const row = room ? LADDERS.roomSwitch : LADDERS.switch;
  return [
    () => genLock(u, row.id, sw.gen),
    () => ceilingLock(u, room ? 'roomPorts' : 'rackPorts', sw.ports.length),
    () => ceilingLock(u, 'uplinks', sw.uplinks.length),
    () => ([...sw.ports, ...sw.uplinks].some((k) => k > row.topK[sw.gen]!) ? { code: 'ceiling', node: null, text: 'Port too fast for this switch' } : null),
  ];
}

export function rackLock(u: Unlocks, cfg: RackConfig): LockReason | null {
  return first([
    ...partOk(u, 'rackCooler', cfg.cooler), () => (cfg.cooler.setpointF !== SETPOINT_DEFAULT_F ? ruleLock(u, 'rackSetpoint') : null),
    ...partOk(u, 'pdu', cfg.pdu), () => (cfg.pdu.capped ? ruleLock(u, 'powerCap') : null),
    () => genLock(u, 'lb', cfg.lb.gen), ...routerChecks(u, cfg.lb), ...switchChecks(u, cfg.switch, false),
    ...cfg.servers.map((s): Check => () => (s ? systemLock(u, s.spec) : null)),
  ]);
}
export function roomLock(u: Unlocks, cfg: RoomConfig): LockReason | null {
  return first([
    () => ceilingLock(u, 'roomRows', cfg.rows), ...partOk(u, 'roomCooler', cfg.cooler),
    () => (cfg.cooler.setpointF !== SETPOINT_DEFAULT_F ? ruleLock(u, 'roomSetpoint') : null),
    () => genLock(u, 'roomLb', cfg.lb.gen), ...routerChecks(u, cfg.lb), ...switchChecks(u, cfg.switch, true),
    ...cfg.ups.flatMap((p) => partOk(u, 'ups', p)), () => (cfg.ups.length > 1 ? ruleLock(u, 'dualFeed') : null),
    ...cfg.racks.map((r): Check => () => (r ? rackLock(u, r) : null)),
  ]);
}
export function siteLock(u: Unlocks, cfg: SiteConfig): LockReason | null {
  return first([
    () => genLock(u, 'dataPlane', cfg.dataPlane.gen), ...routerChecks(u, cfg.dataPlane.router), ...partOk(u, 'grid', cfg.grid),
    () => ceilingLock(u, 'siteZones', cfg.zones.filter((z) => z).length),
    ...cfg.zones.map((z): Check => () => (z ? roomLock(u, z) : null)),
  ]);
}

