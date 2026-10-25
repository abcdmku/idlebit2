import type { CompiledBuffers } from '../core/buffers';
import { accelGate, accelNeed } from '../core/accelerators';
import { MAX_ACCELS } from '../core/constants';
import { MODE } from '../core/timers';
import type { World } from '../core/world';
type FleetContext = Pick<World, 'compiled' | 'hot'>;
import { REGION_IDS, type FamilyDef } from '../types/catalog';
import { FAIL_DETAILS, NO_DETAIL, type FailDetail } from '../types/events';
import { FAMILIES, storageAt, usesResource, workingSetAt } from './families';

/**
 * Fleet capability for the market: the arrival `cantRun` check (spec §4.2, §6.3, §7.8 item 7),
 * the warm-up can-run condition (D5.1 item 4) and the duration estimate behind offered load
 * (tasks.md §3.2). Systems with identical gate and rate columns form one capability class, so a
 * check costs O(classes) plus a short scan for an eligible member.
 */

/**
 * Gate codes. 0 = can run. Order is the report's "first failing gate" order (tasks.md §6).
 * `detailIndex` maps a code to its FAIL_DETAILS index.
 */
export const DETAIL = ['ok', 'cache', 'RAM', 'GPU', 'gpuCores', 'VRAM', 'storage', 'ECC', 'members', 'gang', 'zones', 'region', 'link'] as const;
export type Detail = (typeof DETAIL)[number];
const D = Object.fromEntries(DETAIL.map((d, i) => [d, i])) as { readonly [K in Detail]: number };
export { D as DETAIL_CODE };
const WORD: readonly (FailDetail | null)[] = [null, 'cache', 'ram', 'gpu', 'gpuCores', 'vram', 'storage', 'ecc', 'members', 'gang', 'zones', 'region', 'link'];
export const detailIndex = (code: number): number => {
  const word = WORD[code];
  return word ? FAIL_DETAILS.indexOf(word) : NO_DETAIL;
};

/** The static capability set: modes that accept work within one boot time (spec §4.3). */
const ELIGIBLE = new Uint8Array(32);
ELIGIBLE[MODE.onMarket] = 1; ELIGIBLE[MODE.asleep] = 1; ELIGIBLE[MODE.boot] = 1; ELIGIBLE[MODE.cold] = 1;
export const isEligibleMode = (mode: number): boolean => ELIGIBLE[mode] === 1;

/** Placement bits (PLACEMENT_IDS order). */
const GANG_BIT = 1;
const ZONE_BIT = 4;

/**
 * Per-system gate check (spec §6.3) for one member at per-member size `size`. Returns 0 or the first
 * failing gate. Accelerator cores, memory and rate must belong to the same enabled domain.
 */
export function gateOn(c: CompiledBuffers, sys: number, f: FamilyDef, size: number): number {
  const s = c.sys;
  const hasRam = s.hasRam[sys] === 1;
  const mem = hasRam ? s.memCap[sys]! : Math.max(s.memCap[sys]!, s.cacheBits[sys]!);
  const needsRam = usesResource(f, 'ram');
  if (workingSetAt(f, size) > mem || (needsRam && !hasRam)) return hasRam || needsRam || f.workingSet.perSize > 0 ? D.RAM : D.cache;
  const accelerator = accelGate(c, sys, accelNeed(f, size));
  if (accelerator !== 0) return accelerator;
  const disk = storageAt(f, size);
  if ((usesResource(f, 'io') || disk > 0) && (!(s.ioRate[sys]! > 0) || disk > s.storageCap[sys]!)) return D.storage;
  if (f.ecc && s.ecc[sys] !== 1) return D.ECC;
  if (f.region.kind === 'in' && REGION_IDS[c.site.region[s.site[sys]!]!] !== f.region.region) return D.region;
  return 0;
}

/** Systems with the same gate and rate columns. `rep` is the first member. */
interface CapClass { readonly rep: number; readonly members: number[] }
const CLASS_COLS = ['memCap', 'cacheBits', 'hasRam', 'storageCap', 'ioRate', 'ecc', 'threadRate', 'threads', 'keff', 'ramBw', 'gpuLinked'] as const;
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

const hasEligible = (w: FleetContext, cls: CapClass): boolean => {
  const mode = w.hot.sys.mode;
  for (const m of cls.members) if (ELIGIBLE[mode[m]!] === 1) return true;
  return false;
};

/**
 * Per-unit counters for gangHost, stamped per call instead of cleared. Each success test is
 * monotone in the counts, so a call can stop at the first eligible system that makes one true.
 */
const hostScratch = { stamp: 0, rack: new Int32Array(0), room: new Int32Array(0), site: new Int32Array(0), siteRooms: new Int32Array(0), rackAt: new Int32Array(0), roomAt: new Int32Array(0), siteAt: new Int32Array(0) };
function hostCounters(c: CompiledBuffers): typeof hostScratch {
  const k = hostScratch;
  if (k.rack.length < c.rack.len) { k.rack = new Int32Array(c.rack.len * 2); k.rackAt = new Int32Array(c.rack.len * 2); }
  if (k.room.length < c.room.len) { k.room = new Int32Array(c.room.len * 2); k.roomAt = new Int32Array(c.room.len * 2); }
  if (k.site.length < c.site.len) {
    k.site = new Int32Array(c.site.len * 2); k.siteRooms = new Int32Array(c.site.len * 2); k.siteAt = new Int32Array(c.site.len * 2);
  }
  k.stamp = (k.stamp + 1) | 0;
  if (k.stamp === 0) { k.rackAt.fill(0); k.roomAt.fill(0); k.siteAt.fill(0); k.stamp = 1; }
  return k;
}

/** Gang hosting (spec §7.8 item 7) over eligible systems that pass the member gates. 0 or a detail. */
function gangHost(w: FleetContext, f: FamilyDef, capable: readonly CapClass[]): number {
  const c = w.compiled, mode = w.hot.sys.mode, m = f.members;
  const k = hostCounters(c), stamp = k.stamp;
  const globalGang = c.global.exists[0] === 1 ? c.global.lbPlacements[0]! : 0;
  const zonesNeeded = f.minZones, zoned = zonesNeeded > 1;
  const BOTH = GANG_BIT | ZONE_BIT;
  const globalHosts = zoned ? (globalGang & BOTH) === BOTH : (globalGang & GANG_BIT) !== 0;
  let total = 0, zones = 0;
  for (const cls of capable) {
    for (const sys of cls.members) {
      if (ELIGIBLE[mode[sys]!] !== 1) continue;
      total += 1;
      const rack = c.sys.rack[sys]!, room = c.sys.room[sys]!, site = c.sys.site[sys]!;
      if (k.siteAt[site] !== stamp) { k.siteAt[site] = stamp; k.site[site] = 0; k.siteRooms[site] = 0; }
      if (k.roomAt[room] !== stamp) { k.roomAt[room] = stamp; k.room[room] = 0; k.siteRooms[site] += 1; zones += 1; }
      if (k.rackAt[rack] !== stamp) { k.rackAt[rack] = stamp; k.rack[rack] = 0; }
      const nSite = (k.site[site] += 1), nRoom = (k.room[room] += 1), nRack = (k.rack[rack] += 1);
      if (zoned) {
        if (globalHosts && total >= m && zones >= zonesNeeded) return 0;
        if ((c.site.dpPlacements[site]! & BOTH) === BOTH && nSite >= m && k.siteRooms[site]! >= zonesNeeded) return 0;
      } else if (globalHosts && total >= m
        || (c.site.dpPlacements[site]! & GANG_BIT) !== 0 && nSite >= m
        || (c.room.lbPlacements[room]! & GANG_BIT) !== 0 && nRoom >= m
        || (c.rack.lbPlacements[rack]! & GANG_BIT) !== 0 && nRack >= m) return 0;
    }
  }
  if (total < m) return D.members;
  return zoned ? D.zones : D.gang;
}

/**
 * Can the fleet ever run one task of `f` at per-member size `size`? 0 = yes, else the detail of the
 * class that got furthest through the gate order. Counts only systems in the static capability set.
 */
export function canRunFleet(w: FleetContext, f: FamilyDef, size: number): number {
  const c = w.compiled;
  const capable: CapClass[] = [];
  let best = 0;
  let regionOk = false;
  for (const cls of classesOf(c)) {
    if (!hasEligible(w, cls)) continue;
    const gate = gateOn(c, cls.rep, f, size);
    if (gate === 0) { capable.push(cls); regionOk = true; continue; }
    if (gate === D.region) { capable.push(cls); continue; }
    if (gate > best) best = gate;
  }
  if (capable.length === 0) return best === 0 ? D.cache : best;
  const regional = f.region.kind === 'in';
  if (f.members === 1) return regional && !regionOk ? D.region : 0;
  const placement = gangHost(w, f, capable);
  if (placement !== 0 || !regional) return placement;
  const inRegion = capable.filter((cls) => gateOn(c, cls.rep, f, size) === 0);
  return inRegion.length > 0 && gangHost(w, f, inRegion) === 0 ? 0 : D.region;
}

/** Exec's per-system check for a record (spec §6.3): 0 = can run, else a DETAIL code. */
export const canRunOn = (w: FleetContext, sys: number, r: number): number => {
  const family = FAMILIES[w.hot.rec.family[r]!]!;
  if (family.members > 1 && w.compiled.rack.opened[w.compiled.sys.rack[sys]!] !== 1) return D.members;
  return gateOn(w.compiled, sys, family, w.hot.rec.scale[r]!);
};
