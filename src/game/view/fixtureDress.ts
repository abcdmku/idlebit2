import { amount } from '../amount';
import { cloneCompiled, cloneHot, G, LOC, type CompiledBuffers, type HotBuffers } from '../core/buffers';
import { MAX_UPS, RATE_RING_TICKS, TICK_MS } from '../core/constants';
import { allocRecord, frontList, pushBack, queueList } from '../core/pool';
import { MODE } from '../core/timers';
import { FAMILIES } from '../market/families';
import { FAIL_CAUSES, FAIL_DETAILS, type FailCause, type GameEvent, type GameEventBody } from '../types/events';
import { RES_CLOCKS } from '../core/constants';
import { familyId, rackId, roomId, siteId, systemId } from '../types/ids';
import type { RoundReport } from '../types/report';
import type { GameState, RoundPhase } from '../types/state';

/**
 * Fixture dressing: writes plausible, deterministic live state into cloned buffers of a testkit
 * fleet, so renderer and UI agents see busy cores, queues, temperatures, failures and a feed before
 * the domains run them. Test and dev only; never on a production path.
 */

const R = RES_CLOCKS;
/** Deterministic 0..1 noise. */
const hash = (n: number): number => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const famCount = (): number => Math.max(1, Math.min(12, FAMILIES.length));

export interface DressOptions {
  readonly round: RoundPhase;
  /** Tick the fixture stands at. */
  readonly tick: number;
  /** Returned tasks to place at the queue front (committed, ahead of the window). */
  readonly front: number;
  /** Takes per tick written into the rate ring. */
  readonly takesPerTick: number;
  /** Slots 2, 5, 8 and 11 of every third rack show boot, dark, crashed and cold (then goingOffline, asleep). */
  readonly specials: boolean;
}

/** Fills compiled columns S5's compile leaves at zero, so loads and clocks have a denominator. */
function dressCompiled(state: GameState): CompiledBuffers {
  const c = cloneCompiled(state.compiled);
  for (let s = 0; s < c.sys.len; s += 1) {
    const b = state.build.systems[s]?.spec;
    if (!b) continue;
    const cores = (b.cpu?.cores.length ?? 0) * Math.max(1, b.cpuCount);
    if (!c.sys.threads[s]) c.sys.threads[s] = Math.max(1, cores);
    if (!c.sys.cores[s]) c.sys.cores[s] = Math.max(1, cores);
    if (!c.sys.K[s]) c.sys.K[s] = b.scheduler ? Math.min(32, cores) : 1;
    if (!c.sys.Q[s]) c.sys.Q[s] = b.scheduler ? 16 : 0;
    if (!c.sys.clockHz[s]) c.sys.clockHz[s] = 2 ** (b.cpu?.clock.level ?? 1);
    if (!c.sys.cacheBits[s]) c.sys.cacheBits[s] = 8 * 2 ** (b.cpu?.l1.level ?? 1);
    if (!c.sys.psuCapW[s]) c.sys.psuCapW[s] = 4;
  }
  for (let r = 0; r < c.rack.len; r += 1) {
    if (!c.rack.coolerQc[r]) c.rack.coolerQc[r] = 64;
    if (!c.rack.pduCapW[r]) c.rack.pduCapW[r] = 64;

  }
  for (let m = 0; m < c.room.len; m += 1) {
    if (!c.room.coolerQc[m]) c.room.coolerQc[m] = 1024;
    if (!c.room.upsCapW[m * MAX_UPS]) c.room.upsCapW[m * MAX_UPS] = 1024;
  }
  for (let s = 0; s < c.site.len; s += 1) if (!c.site.gridCapW[s]) c.site.gridCapW[s] = 262_144;
  return c;
}

function addRecord(hot: HotBuffers, family: number, count: number, taken: number, loc: number): number {
  const r = allocRecord(hot);
  hot.rec.family[r] = family; hot.rec.count[r] = count; hot.rec.taken[r] = taken;
  hot.rec.loc[r] = loc; hot.rec.threads[r] = 1;
  hot.rec.taskId[r] = hot.g[G.nextTaskId]!; hot.g[G.nextTaskId] = hot.g[G.nextTaskId]! + 1;
  return r;
}

const RECORD_SYSTEMS = 16;
const SPECIALS = [MODE.boot, MODE.dark, MODE.crashed, MODE.cold, MODE.goingOffline, MODE.asleep];

function dressSystems(c: CompiledBuffers, hot: HotBuffers, o: DressOptions): void {
  const running = o.round === 'running';
  for (let s = 0; s < c.sys.len; s += 1) {
    if (c.sys.alive[s] !== 1) continue;
    const slot = c.sys.slot[s] ?? 0, rack = c.sys.rack[s] ?? 0;
    const special = o.specials && slot % 3 === 2 && rack % 3 === 0 ? SPECIALS[(Math.floor(slot / 3) + rack) % SPECIALS.length]! : -1;
    hot.sys.mode[s] = !running ? MODE.paused : special >= 0 ? special : MODE.onMarket;
    if (special === MODE.boot || special === MODE.cold || special === MODE.goingOffline) hot.sys.timer[s] = 30 + ((s * 17) % 60);
    if (special === MODE.dark) hot.sys.psuRebootTicks[s] = 40;
    if (!running || special >= 0) continue;
    const threads = c.sys.threads[s]!;
    const busy = Math.max(1, Math.round(threads * (0.4 + 0.6 * hash(s))));
    hot.sys.busyThreads[s] = busy; hot.sys.busy[s] = busy; hot.sys.running[s] = busy;
    hot.sys.psuUsage[s] = 0.3 + 0.5 * hash(s + 1); hot.sys.drawW[s] = hot.sys.psuUsage[s]! * c.sys.psuCapW[s]!;
    hot.sys.usedCache[s] = c.sys.cacheBits[s]! * 0.5;
    // Running records on the CPU run list, with stage progress spread over 0..1 (rate 1 on a 0-anchored clock).
    const effClock = 1_000;
    hot.rack.effClock[rack] = effClock;
    hot.sys.rate[s * R] = 1; hot.sys.wAnchor[s * R] = 0; hot.sys.eAnchor[s * R] = 0;
    hot.sys.active[s * R] = busy;
    // Task records only on the first systems: the levels that show them (chip, system, rack) look there.
    let prev = -1;
    for (let k = 0; s < RECORD_SYSTEMS && k < busy && k < 64; k += 1) {
      const r = addRecord(hot, (s + k) % famCount(), 1, o.tick - 20, LOC.running);
      const p = hash(s * 31 + k), work = 100;
      hot.rec.start[r] = effClock - p * work; hot.rec.finish[r] = hot.rec.start[r]! + work; hot.rec.owner[r] = s;
      if (prev < 0) hot.sys.head[s * R] = r; else { hot.rec.next[prev] = r; hot.rec.prev[r] = prev; }
      prev = r;
    }
    const q = s < RECORD_SYSTEMS ? Math.min(c.sys.Q[s]!, Math.floor(hash(s + 7) * 6)) : 0;
    for (let k = 0; k < q; k += 1) pushBack(hot, queueList(hot, s), addRecord(hot, (s + k + 3) % famCount(), 1, o.tick - 10, LOC.queue));
    hot.sys.reserved[s] = c.sys.Q[s]! > q ? 1 : 0;
  }
}

function dressContainers(c: CompiledBuffers, hot: HotBuffers, o: DressOptions): void {
  const running = o.round === 'running';
  for (let r = 0; r < c.rack.len; r += 1) {
    if (c.rack.alive[r] !== 1) continue;
    const load = running ? 0.3 + 0.6 * hash(r + 100) : 0;
    hot.rack.tempF[r] = 68 + load * 22; hot.rack.heatW[r] = load * c.rack.coolerQc[r]!;
    hot.rack.coolerDuty[r] = running ? 1 : 0; hot.rack.coolerW[r] = running ? 2 + load * 6 : 0;
    hot.rack.pduUsage[r] = load; hot.rack.eff[r] = 1;
    if (running) { hot.rack.lbRouted[r] = 1 + (r % 3); hot.rack.lbLast[r] = r % 12; }
    if (o.specials && running && r % 7 === 5) { hot.rack.crashed[r] = 1; hot.rack.tempF[r] = 101; hot.rack.crashTicks[r] = 60; }
    if (o.specials && running && r % 7 === 6) { hot.rack.pduOverTicks[r] = 45; hot.rack.pduUsage[r] = 1.12; }
  }
  for (let m = 0; m < c.room.len; m += 1) {
    if (c.room.alive[m] !== 1) continue;
    hot.room.tempF[m] = running ? 71 + 3 * hash(m) : 70; hot.room.coolerDuty[m] = running ? 0.8 : 0;
    hot.room.upsUsage[m * MAX_UPS] = running ? 0.4 + 0.3 * hash(m + 9) : 0;
  }
  for (let s = 0; s < c.site.len; s += 1) if (c.site.alive[s] === 1) hot.site.gridUsage[s] = running ? 0.2 + 0.2 * hash(s) : 0;
}

/** Returned work at the queue front and the market's rate ring for the last 10 s. */
function dressMarket(hot: HotBuffers, o: DressOptions): void {
  if (o.round !== 'running') return;
  for (let i = 0; i < o.front; i += 1) pushBack(hot, frontList(hot), addRecord(hot, i % famCount(), 1, o.tick - 40, LOC.front));
  const causes = FAIL_CAUSES.length;
  for (let k = 1; k <= RATE_RING_TICKS; k += 1) {
    const t = o.tick - k, row = t % RATE_RING_TICKS;
    hot.ring.at[row] = t; hot.ring.taken[row] = Math.round(o.takesPerTick * (0.8 + 0.4 * hash(t)));
    hot.ring.met[row] = Math.round(o.takesPerTick * 0.9);
    const failed = k % 4 === 0 ? 1 : 0;
    hot.ring.failed[row] = failed; hot.ring.failBy[row * causes + (k % 8 === 0 ? 1 : 0)] = failed;
  }
  hot.g[G.met] = 412; hot.g[G.failed] = 23; hot.g[G.taken] = 437; hot.g[G.dismissed] = 4;
  hot.g[G.deliveredWork] = 41_200; hot.g[G.failedWork] = 2_300;
  hot.g[G.fail] = 9; hot.g[G.fail + 1] = 8; hot.g[G.fail + 2] = 3; hot.g[G.fail + 3] = 2; hot.g[G.fail + 5] = 1;
  hot.g[G.transitCount] = 2;
  hot.g[G.researchOps] = 3;
}

function fixtureEvents(o: DressOptions): GameEvent[] {
  const out: GameEvent[] = [];
  let seq = 0;
  const push = (body: GameEventBody, tick: number) => out.push({ ...body, seq: seq++, tick });
  for (let i = 0; i < 12; i += 1) {
    const tick = o.tick - 24 + i * 2;
    if (i % 4 === 3) {
      const cause: FailCause = FAIL_CAUSES[i % FAIL_CAUSES.length]!;
      push({ kind: 'failed', family: familyId(i % famCount()), count: 1, cause, detail: FAIL_DETAILS[i % FAIL_DETAILS.length]! }, tick);
    } else {
      push({ kind: 'met', family: familyId(i % famCount()), count: 1 + (i % 2), system: systemId(i % 2), rack: rackId(0), room: roomId(0), site: siteId(0) }, tick);
    }
  }
  return out;
}

/** A frozen report for ended and between fixtures. */
export function fixtureReport(index: number, durationTicks: number): RoundReport {
  return {
    byType: [{ type: 'compute', metWork: 128_400, failedWork: 27_500, dismissed: 4 }],
    index, startTick: 0, endedBy: 'sla', durationTicks, durationMs: durationTicks * TICK_MS, met: 1_284,
    failedByCause: { timeout: 190, cantRun: 61, misroute: 12, power: 9, heat: 0, swap: 3, late: 0 },
    failDetail: { timeout: 'link', cantRun: 'ram', misroute: 'cache', power: 'psu', heat: null, swap: 'cold', late: null },
    details: [{ cause: 'timeout', detail: 'link', count: 150 }, { cause: 'cantRun', detail: 'ram', count: 61 }],
    peakIntensity: 6.4, dismissed: 4, deliveredWork: 128_400, failedWork: 27_500, spill: { ramWork: 0, diskWork: 0 }, gross: amount(18_420), data: amount(212), energy: amount(1_310), net: amount(17_110), researchOps: 48_000,
    energyBreakdown: { billed: amount(1_310), fromBattery: amount(0), batteryRefill: amount(0), fromGeneration: amount(0), fuel: amount(0) },
  };
}

/** The dressed fixture state. */
export function dressState(base: GameState, o: DressOptions): GameState {
  const compiled = dressCompiled(base);
  const hot = cloneHot(base.hot);
  dressSystems(compiled, hot, o);
  dressContainers(compiled, hot, o);
  dressMarket(hot, o);
  const ended = o.round !== 'running';
  const endTick = ended ? o.tick - (o.round === 'between' ? 300 : 5) : null;
  return {
    ...base, compiled, hot,
    clock: { tick: o.tick, carryMs: 40 },
    wallet: { ...base.wallet, credits: amount(48_210), data: amount(1_240) },
    round: {
      ...base.round, phase: o.round, index: ended ? 3 : 4, startTick: 0, endTick,
      autoReturnTick: o.round === 'between' ? o.tick + 900 : null,
      peakIntensity: 6.4, grace: 640, reports: ended ? [fixtureReport(3, endTick!)] : [fixtureReport(3, 4_200)],
    },
    market: { ...base.market, intensity: 6.4 },
    events: { nextSeq: 12, entries: ended ? [] : fixtureEvents(o) },
  };
}
