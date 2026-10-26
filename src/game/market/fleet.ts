import type { CompiledBuffers } from '../core/buffers';
import { accelGate, accelNeed } from '../core/accelerators';
import { MAX_ACCELS, MAX_SHARDS } from '../core/constants';
import { MODE } from '../core/timers';
import type { World } from '../core/world';
type FleetContext = Pick<World, 'compiled' | 'hot'>;
import { REGION_IDS, type FamilyDef } from '../types/catalog';
import { FAIL_DETAILS, NO_DETAIL, type FailDetail } from '../types/events';
import { FAMILIES, workingSetAt } from './families';
import { floorShards } from '../net/floor';

/**
 * Fleet capability for the market: the arrival `cantRun` check (spec §4.2, §6.3, §7.8 item 6, D25)
 * and per-system gates. Systems with identical gate and rate columns form one capability class, so
 * a check costs O(classes) plus a scan of at most 256 eligible systems.
 */

/**
 * Gate codes. 0 = can run. Order is the report's "first failing gate" order (tasks.md §6).
 * `detailIndex` maps a code to its FAIL_DETAILS index.
 */
export const DETAIL = ['ok', 'cache', 'RAM', 'GPU', 'gpuCores', 'VRAM', 'disk', 'ECC', 'members', 'zones', 'region', 'link',
  /** No system can take work at all: why the fleet is down (power supply, heat, or switched off). Never a capability. */
  'psu', 'pdu', 'ups', 'grid', 'rack', 'room', 'offline'] as const;
export type Detail = (typeof DETAIL)[number];
const D = Object.fromEntries(DETAIL.map((d, i) => [d, i])) as { readonly [K in Detail]: number };
export { D as DETAIL_CODE };
const WORD: readonly (FailDetail | null)[] = [null, 'cache', 'ram', 'gpu', 'gpuCores', 'vram', 'disk', 'ecc', 'members', 'zones', 'region', 'link',
  'psu', 'pdu', 'ups', 'grid', 'rack', 'room', 'offline'];
/** A down code (D.psu … D.offline): the fleet has no system in the static capability set. */
export const isDownGate = (code: number): boolean => code >= D.psu;
export const detailIndex = (code: number): number => {
  const word = WORD[code];
  return word ? FAIL_DETAILS.indexOf(word) : NO_DETAIL;
};

/** The static capability set: modes that accept work within one boot time (spec §4.3). */
const ELIGIBLE = new Uint8Array(32);
ELIGIBLE[MODE.onMarket] = 1; ELIGIBLE[MODE.asleep] = 1; ELIGIBLE[MODE.standby] = 1; ELIGIBLE[MODE.boot] = 1; ELIGIBLE[MODE.cold] = 1;
export const isEligibleMode = (mode: number): boolean => ELIGIBLE[mode] === 1;

/**
 * Per-system gate check (spec §6.3) for one shard of `size` units (size 0: the size-free gates). Returns 0 or the first
 * failing gate. Accelerator cores, memory and rate must belong to the same enabled domain.
 */
export function gateOn(c: CompiledBuffers, sys: number, f: FamilyDef, size: number): number {
  const s = c.sys;
  // D26.1: the only memory gate is the whole hierarchy; the detail names the deepest tier the system has.
  if (workingSetAt(f, size) > s.memCap[sys]!) return s.storageCap[sys]! > 0 || s.diskNode[sys]! >= 0 ? D.disk : s.hasRam[sys] === 1 ? D.RAM : D.cache;
  const accelerator = accelGate(c, sys, accelNeed(f, size));
  if (accelerator !== 0) return accelerator;
  if (f.ecc && s.ecc[sys] !== 1) return D.ECC;
  if (f.region.kind === 'in' && REGION_IDS[c.site.region[s.site[sys]!]!] !== f.region.region) return D.region;
  return 0;
}

/** Systems with the same gate and rate columns. `rep` is the first member. */
interface CapClass { readonly rep: number; readonly members: number[] }
const CLASS_COLS = ['memCap', 'cacheBits', 'ramCap', 'hasRam', 'storageCap', 'diskNode', 'unifiedBits', 'ioRate', 'ecc', 'threadRate', 'threads', 'keff', 'ramBw', 'gpuLinked'] as const;
const ACCEL_COLS = ['accelKind', 'accelCores', 'accelClockHz', 'accelVram', 'accelOps', 'accelTensorOps', 'accelIdleW', 'accelLoadW'] as const;
const classMemo = new WeakMap<CompiledBuffers, readonly CapClass[]>();

/** Capability classes of the task-running systems (storage nodes excluded). Memoized per compiled. */
export function classesOf(c: CompiledBuffers): readonly CapClass[] {
  const hit = classMemo.get(c);
  if (hit) return hit;
  const byKey = new Map<string, CapClass>();
  const s = c.sys;
  for (let i = 0; i < s.len; i += 1) {
    if (s.alive[i] !== 1 || s.kind[i] !== 0) continue;
    let key = String(c.site.region[s.site[i]!]);
    for (const col of CLASS_COLS) key += ',' + s[col][i];
    for (let slot = 0; slot < MAX_ACCELS; slot += 1) {
      const p = i * MAX_ACCELS + slot;
      for (const col of ACCEL_COLS) key += ',' + s[col][p];
    }
    const cls = byKey.get(key);
    if (cls) cls.members.push(i); else byKey.set(key, { rep: i, members: [i] });
  }
  const classes = [...byKey.values()];
  classMemo.set(c, classes);
  return classes;
}

/**
 * Capable classes of the static capability set in capacity order (the hierarchy, then VRAM,
 * largest first; spec §6.3): the k-th largest capable system belongs to the class where the
 * cumulative eligible count first reaches k. Memoized per compiled.
 */
const orderMemo = new WeakMap<CompiledBuffers, readonly CapClass[]>();
function byCapacity(c: CompiledBuffers): readonly CapClass[] {
  const hit = orderMemo.get(c);
  if (hit) return hit;
  const s = c.sys;
  const out = [...classesOf(c)].sort((x, y) => s.memCap[y.rep]! - s.memCap[x.rep]! || s.vram[y.rep]! - s.vram[x.rep]! || x.rep - y.rep);
  orderMemo.set(c, out);
  return out;
}

/**
 * Why no task-running system takes work: the first server held down by power (its PSU rebooting, its
 * rack's PDU, its zone's grid or UPS), else by heat (rack, then room), else switched off or swapping.
 */
function downGate(w: FleetContext): number {
  const c = w.compiled, s = c.sys, h = w.hot, mode = h.sys.mode;
  let heat = 0, other = 0;
  for (let i = 0; i < s.len; i += 1) {
    if (s.alive[i] !== 1 || s.kind[i] !== 0) continue;
    if (mode[i] === MODE.dark) {
      if (h.sys.psuRebootTicks[i]! > 0) return D.psu;
      if (h.rack.pduFailed[s.rack[i]!] === 1) return D.pdu;
      return h.site.gridFailed[s.site[i]!] === 1 ? D.grid : D.ups;
    }
    if (mode[i] === MODE.crashed && heat === 0) heat = h.rack.crashed[s.rack[i]!] === 1 ? D.rack : D.room;
    else if (other === 0) other = D.offline;
  }
  return heat || other || D.offline;
}

/** Rooms seen while counting zones, stamped per call. */
let roomAt = new Int32Array(0);
let roomStamp = 0;

/**
 * Can the fleet ever run one task of `f` at size `size` (spec §6.3, D25)? 0 = yes, else the
 * detail of the first failing check. With C the systems of the static capability set that pass the
 * size-free gates, some k in [members, min(|C|, 256, max(1, floor(size / grain)))] must give shards
 * of ceil(size / k) units that fit the k-th largest system of C, and those k systems must span
 * minZones zones. Region-locked tasks count only systems in the region.
 */
export function canRunFleet(w: FleetContext, f: FamilyDef, size: number): number {
  const c = w.compiled, mode = w.hot.sys.mode;
  let best = 0, capable = 0;
  for (const cls of classesOf(c)) {
    let eligible = false;
    for (const m of cls.members) if (ELIGIBLE[mode[m]!] === 1) { eligible = true; break; }
    if (!eligible) continue;
    const gate = gateOn(c, cls.rep, f, 0);
    if (gate === 0) capable += 1; else if (gate > best) best = gate;
  }
  // No eligible system at all: name why the fleet is down, never a capability gate (sandbox bug, 26 Oct:
  // a tripped power supply read "Needs 1 b cache" beside 18.9 Mb of cache).
  if (capable === 0) return best === 0 ? downGate(w) : best;
  const members = Math.max(1, f.members), grain = Math.max(1, f.grain);
  // The split floor (D25.11) caps the shards any router may cut, over the fastest system of the fleet.
  const kCap = Math.min(MAX_SHARDS, Math.max(1, Math.floor(size / grain)), Math.max(members, floorShards(c, 3, 0, f.id, size)));
  if (kCap < members) return D.members;
  if (roomAt.length < c.room.len) roomAt = new Int32Array(c.room.len * 2);
  roomStamp = (roomStamp + 1) | 0;
  if (roomStamp === 0) { roomAt.fill(0); roomStamp = 1; }
  let cum = 0, zones = 0, sizeFail = 0;
  for (const cls of byCapacity(c)) {
    if (cum >= kCap) break;
    if (gateOn(c, cls.rep, f, 0) !== 0) continue;
    for (const m of cls.members) {
      if (cum >= kCap) break;
      if (ELIGIBLE[mode[m]!] !== 1) continue;
      if (members > 1 && c.rack.opened[c.sys.rack[m]!] !== 1) continue;
      cum += 1;
      const room = c.sys.room[m]!;
      if (roomAt[room] !== roomStamp) { roomAt[room] = roomStamp; zones += 1; }
    }
    // The largest k this class can be the k-th largest system for: the smallest shard it must hold.
    const k = cum;
    if (k < members) continue;
    const gate = gateOn(c, cls.rep, f, Math.ceil(size / k));
    if (gate !== 0) { if (sizeFail === 0) sizeFail = gate; continue; }
    return zones >= f.minZones ? 0 : D.zones;
  }
  if (cum < members) return D.members;
  return sizeFail !== 0 ? sizeFail : D.zones;
}

/**
 * gateOn reads only class columns, so systems of one class share the answer. Routing and admission
 * ask the same (family, units) of many systems in a row: one remembered answer per class.
 */
interface GateMemo { readonly cls: Int32Array; readonly family: (FamilyDef | null)[]; readonly size: Float64Array; readonly gate: Int32Array }
const gateMemo = new WeakMap<CompiledBuffers, GateMemo>();
function memoFor(c: CompiledBuffers): GateMemo {
  let m = gateMemo.get(c);
  if (!m) {
    const classes = classesOf(c), cls = new Int32Array(c.sys.len).fill(-1);
    classes.forEach((k, i) => { for (const sys of k.members) cls[sys] = i; });
    m = { cls, family: classes.map(() => null), size: new Float64Array(classes.length), gate: new Int32Array(classes.length) };
    gateMemo.set(c, m);
  }
  return m;
}

/** gateOn, remembered per capability class. */
export function gateOnClass(c: CompiledBuffers, sys: number, f: FamilyDef, size: number): number {
  const m = memoFor(c), k = sys < m.cls.length ? m.cls[sys]! : -1;
  if (k < 0) return gateOn(c, sys, f, size);
  if (m.family[k] === f && m.size[k] === size) return m.gate[k]!;
  const gate = gateOn(c, sys, f, size);
  m.family[k] = f; m.size[k] = size; m.gate[k] = gate;
  return gate;
}

/** Exec's per-system check for a record (spec §6.3): 0 = can run, else a DETAIL code. */
export const canRunOn = (w: FleetContext, sys: number, r: number): number => {
  const family = FAMILIES[w.hot.rec.family[r]!]!;
  if (family.members > 1 && w.compiled.rack.opened[w.compiled.sys.rack[sys]!] !== 1) return D.members;
  return gateOnClass(w.compiled, sys, family, w.hot.rec.units[r]!);
};
