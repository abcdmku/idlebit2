import type { CompiledBuffers, HotBuffers } from '../core/buffers';
import { drainTouches, type TouchLog } from '../core/touch';
import type { World } from '../core/world';
import { MAX_ACCELS } from '../core/constants';
import { TURBO_MAX_F } from './constants';
import type { PhysSettings } from './settings';

const RAM = 1, IO = 3, R = 4;

/**
 * Event-driven power (architecture §1.5). A system's power step is a pure function of its draw
 * inputs, its rack's supply and lump context, a few fleet-wide values and its own phys state.
 * When none of those changed since a step that reached a fixed point (it changed no phys state),
 * repeating the step would write exactly what is already there until a running C-state or S3
 * timer reaches its threshold (the due tick), so the phase skips it and reuses its cached
 * contribution, writing only the tick stamps the step would write. Rack sums are re-added only
 * for racks with a recomputed member, in the original ascending system order, so every float is
 * bit-identical to a full pass.
 *
 * The cache is not state: it is keyed by the hot buffers it describes and rebuilt on any miss.
 * Hot inputs are compared value by value, so a writer that skips a dirty flag (an action, a
 * test, a kill) can never leave it stale. Compiled buffers are compared by identity: they are a
 * cold layer that a change replaces (build/commit, research), never edits in place.
 *
 * Change-driven candidates (contract R34). Inside one advance call, on the tick after the last
 * power phase, only candidates are compared: members of racks the run phase visited, dirty or
 * forced racks, systems the touch log raised (core/touch.ts), last tick's unstable systems and
 * systems whose timer is due. No other system can have a moved input (powerDebug.verify proves it
 * by comparing everyone), so the others only get their tick stamps. Any other tick compares every
 * system, as before. A compared system that turns out unchanged is still skipped, so the set of
 * steps, their order and every float are those of the full comparison.
 */
export interface PowerCache {
  compiled: CompiledBuffers | null;
  settings: PhysSettings | null;
  researchOn: boolean;
  roundPhase: string;
  startTick: number;
  /** Per system: 1 when its last step was a fixed point, so it may be skipped before `due`. */
  readonly stable: Uint8Array;
  /** Per system: the tick a running C-state or S3 timer next changes the step (Infinity: none). */
  readonly due: Float64Array;
  /** Per system, from its last step: stamp idleSinceTick / emptySinceTick on skipped ticks. */
  readonly stampIdle: Uint8Array;
  readonly stampEmpty: Uint8Array;
  /** Per system draw inputs, as of the end of its last step. */
  readonly mode: Uint8Array;
  readonly busy: Float64Array;
  readonly ram: Uint16Array;
  readonly io: Uint16Array;
  readonly queueLen: Uint16Array;
  readonly reserved: Uint16Array;
  readonly running: Uint16Array;
  readonly wake: Int32Array;
  readonly cap: Float64Array;
  readonly cstate: Uint8Array;
  readonly dvfs: Uint8Array;
  readonly turbo: Uint8Array;
  /** Pipe bits sent last step (D10.4: 0.1 W per bit/s). */
  readonly pipeBits: Float64Array;
  /** Per card (system × MAX_ACCELS): task + research duty seconds. Watts follow these alone. */
  readonly duty: Float64Array;
  /** Per system rack contributions: PSU delivered and loss watts, capped core load × cap factor. */
  readonly delivered: Float64Array;
  readonly loss: Float64Array;
  readonly capLoad: Float64Array;
  /** Per rack: supply/lump context bits and PDU cap factor last seen; members to re-add. */
  readonly rackCtx: Int32Array;
  readonly rackCap: Float64Array;
  readonly rackForce: Uint8Array;
  readonly rackResum: Uint8Array;
  /** Per rack sums of member contributions (the old per-tick scratch accumulators). */
  readonly rackIn: Float64Array;
  readonly rackCompute: Float64Array;
  readonly rackPlain: Float64Array;
  readonly rackCapLoad: Float64Array;
  readonly rackAny: Uint8Array;
  /** Alive systems by rack, ascending (CSR): members of rack r are memberIds[memberAt[r]..memberAt[r+1]). */
  readonly memberAt: Int32Array;
  readonly memberIds: Int32Array;
  /** Scratch: systems whose step runs this tick. */
  readonly steps: Int32Array;
  /** The touch log and tick of the last power phase; a candidate tick needs the same log at tick + 1. */
  log: TouchLog | null;
  lastTick: number;
  /** Systems whose last step was not a fixed point (stable 0), listed by systemStep for the next tick. */
  unstable: Int32Array;
  unstableN: number;
  nextUnstable: Int32Array;
  nextUnstableN: number;
  /** Systems by due tick (entries may be stale; a stale one is only an extra comparison). */
  readonly dueAt: Map<number, number[]>;
  /** Candidate marks (stamp per tick) and list. */
  readonly candAt: Int32Array;
  candStamp: number;
  readonly cand: Int32Array;
  /**
   * Deferred tick stamps. On candidate ticks a non-candidate's stamps would be the tick itself, so
   * they are written only when read: before the system's next comparison, when the candidate run
   * ends (any full comparison) and before the advance call commits (flushPowerStamps). Nothing
   * else reads idleSinceTick or emptySinceTick. In epoch `lazyEpoch` (0: none, begun at tick
   * `lazyStart`) a system's stamps are written up to explicitAt (or lazyStart − 1 when its epoch
   * entry is older); the deferred value is `lazyLast`, the last candidate tick.
   */
  lazyEpoch: number;
  lazyStart: number;
  lazyLast: number;
  readonly explicitEpoch: Int32Array;
  readonly explicitAt: Int32Array;
}

let lazyEpochs = 0;

/** Test and bench hook: on candidate ticks also compare every other system and throw on a moved input. */
export const powerDebug = { verify: false };

const caches = new WeakMap<HotBuffers, PowerCache>();

function allocCache(c: CompiledBuffers): PowerCache {
  const n = c.sys.len, nr = c.rack.len;
  const memberAt = new Int32Array(nr + 1), memberIds = new Int32Array(n);
  const member = (s: number) => c.sys.alive[s] === 1 && c.sys.rack[s]! >= 0 && c.sys.rack[s]! < nr;
  for (let s = 0; s < n; s += 1) if (member(s)) memberAt[c.sys.rack[s]! + 1] += 1;
  for (let r = 0; r < nr; r += 1) memberAt[r + 1] += memberAt[r]!;
  const fill = memberAt.slice(0, nr);
  for (let s = 0; s < n; s += 1) if (member(s)) { const r = c.sys.rack[s]!; memberIds[fill[r]!] = s; fill[r] += 1; }
  return {
    compiled: null, settings: null, researchOn: false, roundPhase: '', startTick: -1,
    stable: new Uint8Array(n), due: new Float64Array(n), stampIdle: new Uint8Array(n), stampEmpty: new Uint8Array(n),
    mode: new Uint8Array(n), busy: new Float64Array(n), ram: new Uint16Array(n), io: new Uint16Array(n),
    queueLen: new Uint16Array(n), reserved: new Uint16Array(n), running: new Uint16Array(n), wake: new Int32Array(n),
    cap: new Float64Array(n), cstate: new Uint8Array(n), dvfs: new Uint8Array(n), turbo: new Uint8Array(n), pipeBits: new Float64Array(n), duty: new Float64Array(n * MAX_ACCELS),
    delivered: new Float64Array(n), loss: new Float64Array(n), capLoad: new Float64Array(n),
    rackCtx: new Int32Array(nr).fill(-1), rackCap: new Float64Array(nr), rackForce: new Uint8Array(nr), rackResum: new Uint8Array(nr),
    rackIn: new Float64Array(nr), rackCompute: new Float64Array(nr), rackPlain: new Float64Array(nr), rackCapLoad: new Float64Array(nr),
    rackAny: new Uint8Array(nr), memberAt, memberIds, steps: new Int32Array(n),
    log: null, lastTick: -2, unstable: new Int32Array(n), unstableN: 0, nextUnstable: new Int32Array(n), nextUnstableN: 0,
    dueAt: new Map(), candAt: new Int32Array(n), candStamp: 0, cand: new Int32Array(n),
    lazyEpoch: 0, lazyStart: 0, lazyLast: 0, explicitEpoch: new Int32Array(n), explicitAt: new Int32Array(n),
  };
}

/**
 * The world's power cache. Every system is unstable (recomputed) when the cache is new or any
 * fleet-wide input changed: compiled buffers, settings (build and unlocks), research on or its
 * mode, the round phase or its start tick.
 */
export function powerCache(w: World, settings: PhysSettings, researchOn: boolean): PowerCache {
  const c = w.compiled;
  let k = caches.get(w.hot);
  if (!k || k.compiled !== c) {
    if (k) flushStamps(w, k);
    k = allocCache(c);
    caches.set(w.hot, k);
  }
  if (k.compiled !== c || k.settings !== settings || k.researchOn !== researchOn
    || k.roundPhase !== w.round.phase || k.startTick !== w.round.startTick) {
    flushStamps(w, k);
    k.stable.fill(0);
    k.rackForce.fill(1);
    k.log = null;
    k.compiled = c; k.settings = settings; k.researchOn = researchOn;
    k.roundPhase = w.round.phase; k.startTick = w.round.startTick;
  }
  return k;
}

/**
 * Bits of everything a system step reads from its rack, room and their supplies; a change, or a
 * moved PDU cap factor, re-runs every member of the rack this tick (rackForce).
 */
export function refreshRackContexts(w: World, k: PowerCache, zoneDark: Float64Array): void {
  const c = w.compiled.rack, h = w.hot.rack;
  const roomOf = c.room, openedOf = c.opened, pduFailed = h.pduFailed, crashed = h.crashed, roomCrashed = w.hot.room.crashed;
  const throttled = h.throttled, tempF = h.tempF, capFactor = h.capFactor;
  for (let r = 0; r < c.len; r += 1) {
    const room = roomOf[r]!;
    const opened = openedOf[r] === 1;
    const ctx = (pduFailed[r] === 1 ? 1 : 0) | (zoneDark[room] === 1 ? 2 : 0) | (crashed[r] === 1 ? 4 : 0)
      | (roomCrashed[room] === 1 ? 8 : 0) | (throttled[r] === 1 ? 16 : 0)
      | (!opened || tempF[r]! < TURBO_MAX_F ? 32 : 0) | (opened ? 64 : 0);
    const cap = capFactor[r]!;
    if (ctx !== k.rackCtx[r] || cap !== k.rackCap[r]) { k.rackForce[r] = 1; k.rackCtx[r] = ctx; k.rackCap[r] = cap; }
  }
}

/**
 * Whether system s's step would repeat its last one exactly (see the comment above): a fixed
 * point, no timer due, its rack context unchanged and every draw input equal to the recorded one.
 */
function unchanged(w: World, k: PowerCache, s: number): boolean {
  const h = w.hot.sys, o = s * R;
  if (!(k.stable[s] === 1 && w.tick < k.due[s]! && k.rackForce[w.compiled.sys.rack[s]!] === 0
    && h.mode[s] === k.mode[s] && h.busy[s] === k.busy[s] && h.active[o + RAM] === k.ram[s] && h.active[o + IO] === k.io[s]
    && h.queueLen[s] === k.queueLen[s] && h.reserved[s] === k.reserved[s] && h.running[s] === k.running[s]
    && h.wakeTicks[s] === k.wake[s] && h.psuRebootTicks[s] === 0 && h.psuOverTicks[s] === 0
    && h.capFactor[s] === k.cap[s] && h.cstate[s] === k.cstate[s] && h.dvfsOn[s] === k.dvfs[s] && h.turboOn[s] === k.turbo[s]
    && h.pipeBits[s] === k.pipeBits[s])) return false;
  // Equal duty gives equal accelerator watts. A bad duty (NaN, out of range) never equals the
  // recorded one, so the step re-runs and its full draw validates it exactly as before.
  const taskS = h.accelTaskS, researchS = h.accelResearchS, duty = k.duty;
  for (let p = s * MAX_ACCELS, end = p + MAX_ACCELS; p < end; p += 1) if (taskS[p]! + researchS[p]! !== duty[p]) return false;
  return true;
}

/** Writes system s's deferred stamps up to tick `upTo` (see PowerCache.lazyEpoch). */
function materialize(w: World, k: PowerCache, s: number, upTo: number): void {
  const last = k.explicitEpoch[s] === k.lazyEpoch ? k.explicitAt[s]! : k.lazyStart - 1;
  if (upTo > last) {
    if (k.stampIdle[s] === 1) w.hot.sys.idleSinceTick[s] = upTo;
    if (k.stampEmpty[s] === 1) w.hot.sys.emptySinceTick[s] = upTo;
  }
  k.explicitEpoch[s] = k.lazyEpoch; k.explicitAt[s] = upTo;
}

/** Writes every deferred stamp and ends the epoch. */
function flushStamps(w: World, k: PowerCache): void {
  if (k.lazyEpoch === 0) return;
  const n = Math.min(k.stampIdle.length, w.hot.sys.len);
  for (let s = 0; s < n; s += 1) materialize(w, k, s, k.lazyLast);
  k.lazyEpoch = 0;
}

/** Before an advance call commits: the world's deferred stamps are written (core/advance.ts). */
export function flushPowerStamps(w: World): void {
  const k = caches.get(w.hot);
  if (k) flushStamps(w, k);
}

/** A step left system s due at `tick` (a running C-state or S3 timer); listed for that tick. */
export function noteDue(k: PowerCache, s: number, tick: number): void {
  const list = k.dueAt.get(tick);
  if (list) list.push(s); else k.dueAt.set(tick, [s]);
}

/** A step left system s unstable: it is compared again next tick. */
export function noteUnstable(k: PowerCache, s: number): void {
  k.nextUnstable[k.nextUnstableN] = s;
  k.nextUnstableN += 1;
}

/** Drops due entries at or before `tick` (every other tick's power phase compares every system). */
function dropDue(k: PowerCache, tick: number): void {
  for (const at of k.dueAt.keys()) if (at <= tick) k.dueAt.delete(at);
}

/** Lists system s as a candidate once (candAt stamps it), if it is alive. Returns the new count. */
function addCandidate(k: PowerCache, alive: Uint8Array, s: number, stamp: number, m: number): number {
  if (s < 0 || s >= alive.length || k.candAt[s] === stamp || alive[s] !== 1) return m;
  k.candAt[s] = stamp; k.cand[m] = s;
  return m + 1;
}

/**
 * Pass 1 of the system loop: stamps every skippable system and lists, ascending, the systems
 * whose step must run (unstable, a timer due, rack context changed, or an input moved). A skipped
 * step's only writes are its own tick stamps, which no other system's step reads, so running the
 * listed steps afterwards in the same ascending order is the full pass.
 */
export function collectSteps(w: World, k: PowerCache, out: Int32Array): number {
  const log = w.touch ?? null;
  const consecutive = log !== null && k.log === log && k.lastTick === w.tick - 1;
  k.log = log; k.lastTick = w.tick;
  // This tick's steps list the next tick's unstable systems.
  const u = k.unstable; k.unstable = k.nextUnstable; k.nextUnstable = u;
  k.unstableN = k.nextUnstableN; k.nextUnstableN = 0;
  let n: number;
  if (consecutive) n = collectCandidates(w, k, log, out);
  else { flushStamps(w, k); dropDue(k, w.tick); n = collectAll(w, k, out); }
  if (log) drainTouches(log);
  return n;
}

/**
 * Every system compared: the first tick of an advance call, after a skip, or without a log.
 * Columns are hoisted once: tables are dictionary-mode objects (built by computed keys), so a
 * per-row lookup is a hash probe.
 */
function collectAll(w: World, k: PowerCache, out: Int32Array): number {
  const c = w.compiled.sys, h = w.hot.sys, tick = w.tick;
  const alive = c.alive, rackOf = c.rack, duty = k.duty;
  const mode = h.mode, busy = h.busy, active = h.active, queueLen = h.queueLen, reserved = h.reserved, running = h.running;
  const wake = h.wakeTicks, reboot = h.psuRebootTicks, over = h.psuOverTicks, cap = h.capFactor, cstate = h.cstate;
  const dvfs = h.dvfsOn, turbo = h.turboOn, taskS = h.accelTaskS, researchS = h.accelResearchS, pipeBits = h.pipeBits, kPipe = k.pipeBits;
  const idleSince = h.idleSinceTick, emptySince = h.emptySinceTick;
  const stable = k.stable, due = k.due, force = k.rackForce, stampIdle = k.stampIdle, stampEmpty = k.stampEmpty;
  const kMode = k.mode, kBusy = k.busy, kRam = k.ram, kIo = k.io, kQueue = k.queueLen, kReserved = k.reserved;
  const kRunning = k.running, kWake = k.wake, kCap = k.cap, kCstate = k.cstate, kDvfs = k.dvfs, kTurbo = k.turbo;
  const len = c.len;
  let n = 0;
  for (let s = 0; s < len; s += 1) {
    if (alive[s] !== 1) continue;
    const o = s * R;
    let same = stable[s] === 1 && tick < due[s]! && force[rackOf[s]!] === 0
      && mode[s] === kMode[s] && busy[s] === kBusy[s] && active[o + RAM] === kRam[s] && active[o + IO] === kIo[s]
      && queueLen[s] === kQueue[s] && reserved[s] === kReserved[s] && running[s] === kRunning[s]
      && wake[s] === kWake[s] && reboot[s] === 0 && over[s] === 0
      && cap[s] === kCap[s] && cstate[s] === kCstate[s] && dvfs[s] === kDvfs[s] && turbo[s] === kTurbo[s]
      && pipeBits[s] === kPipe[s];
    for (let p = s * MAX_ACCELS, end = p + MAX_ACCELS; same && p < end; p += 1) same = taskS[p]! + researchS[p]! === duty[p];
    if (!same) { out[n] = s; n += 1; continue; }
    if (stampIdle[s] === 1) idleSince[s] = tick;
    if (stampEmpty[s] === 1) emptySince[s] = tick;
  }
  return n;
}

/** Candidates only (R34, see the comment above); every other system just gets its stamps. */
function collectCandidates(w: World, k: PowerCache, log: TouchLog, out: Int32Array): number {
  const c = w.compiled, tick = w.tick, alive = c.sys.alive, len = c.sys.len;
  const candAt = k.candAt, cand = k.cand;
  k.candStamp = (k.candStamp + 1) | 0;
  if (k.candStamp === 0) { candAt.fill(0); k.candStamp = 1; }
  const stamp = k.candStamp;
  let m = 0;
  const dirty = w.hot.rack.dirty, force = k.rackForce, visited = log.rackMark, memberAt = k.memberAt, memberIds = k.memberIds;
  for (let r = 0; r < c.rack.len; r += 1) {
    if (force[r] === 0 && dirty[r] === 0 && (r >= visited.length || visited[r] === 0)) continue;
    for (let i = memberAt[r]!; i < memberAt[r + 1]!; i += 1) m = addCandidate(k, alive, memberIds[i]!, stamp, m);
  }
  for (let i = 0; i < log.sysN; i += 1) m = addCandidate(k, alive, log.sysList[i]!, stamp, m);
  for (let i = 0; i < k.unstableN; i += 1) m = addCandidate(k, alive, k.unstable[i]!, stamp, m);
  const dueNow = k.dueAt.get(tick);
  if (dueNow) {
    k.dueAt.delete(tick);
    for (const s of dueNow) m = addCandidate(k, alive, s, stamp, m);
  }
  cand.subarray(0, m).sort();
  if (k.lazyEpoch === 0) { lazyEpochs = (lazyEpochs % 0x7ffffffe) + 1; k.lazyEpoch = lazyEpochs; k.lazyStart = tick; }
  for (let i = 0; i < m; i += 1) materialize(w, k, cand[i]!, tick - 1);
  k.lazyLast = tick;
  const h = w.hot.sys, idleSince = h.idleSinceTick, emptySince = h.emptySinceTick, stampIdle = k.stampIdle, stampEmpty = k.stampEmpty;
  // collectAll's comparison over the candidates, columns hoisted (dictionary-mode tables).
  const rackOf = c.sys.rack, duty = k.duty;
  const mode = h.mode, busy = h.busy, active = h.active, queueLen = h.queueLen, reserved = h.reserved, running = h.running;
  const wake = h.wakeTicks, reboot = h.psuRebootTicks, over = h.psuOverTicks, cap = h.capFactor, cstate = h.cstate;
  const dvfs = h.dvfsOn, turbo = h.turboOn, taskS = h.accelTaskS, researchS = h.accelResearchS, pipeBits = h.pipeBits, kPipe = k.pipeBits;
  const stable = k.stable, due = k.due;
  const kMode = k.mode, kBusy = k.busy, kRam = k.ram, kIo = k.io, kQueue = k.queueLen, kReserved = k.reserved;
  const kRunning = k.running, kWake = k.wake, kCap = k.cap, kCstate = k.cstate, kDvfs = k.dvfs, kTurbo = k.turbo;
  let n = 0;
  for (let i = 0; i < m; i += 1) {
    const s = cand[i]!;
    const o = s * R;
    let same = stable[s] === 1 && tick < due[s]! && force[rackOf[s]!] === 0
      && mode[s] === kMode[s] && busy[s] === kBusy[s] && active[o + RAM] === kRam[s] && active[o + IO] === kIo[s]
      && queueLen[s] === kQueue[s] && reserved[s] === kReserved[s] && running[s] === kRunning[s]
      && wake[s] === kWake[s] && reboot[s] === 0 && over[s] === 0
      && cap[s] === kCap[s] && cstate[s] === kCstate[s] && dvfs[s] === kDvfs[s] && turbo[s] === kTurbo[s]
      && pipeBits[s] === kPipe[s];
    for (let p = s * MAX_ACCELS, end = p + MAX_ACCELS; same && p < end; p += 1) same = taskS[p]! + researchS[p]! === duty[p];
    if (!same) { out[n] = s; n += 1; continue; }
    if (stampIdle[s] === 1) idleSince[s] = tick;
    if (stampEmpty[s] === 1) emptySince[s] = tick;
  }
  if (powerDebug.verify) {
    for (let s = 0; s < len; s += 1) {
      if (candAt[s] !== stamp && alive[s] === 1 && !unchanged(w, k, s)) throw new Error(`powerCache: system ${s} changed unseen at tick ${tick}`);
    }
  }
  // Every other system's stamps are deferred (materialize).
  return n;
}

/** Records the inputs a step just ran against (end-of-step values) for the next comparison. */
export function recordInputs(w: World, s: number, k: PowerCache): void {
  const h = w.hot.sys;
  const o = s * R;
  k.mode[s] = h.mode[s]!; k.busy[s] = h.busy[s]!; k.ram[s] = h.active[o + RAM]!; k.io[s] = h.active[o + IO]!;
  k.queueLen[s] = h.queueLen[s]!; k.reserved[s] = h.reserved[s]!; k.running[s] = h.running[s]!; k.wake[s] = h.wakeTicks[s]!;
  k.cap[s] = h.capFactor[s]!; k.cstate[s] = h.cstate[s]!; k.dvfs[s] = h.dvfsOn[s]!; k.turbo[s] = h.turboOn[s]!;
  k.pipeBits[s] = h.pipeBits[s]!;
  const taskS = h.accelTaskS, researchS = h.accelResearchS;
  for (let p = s * MAX_ACCELS, end = p + MAX_ACCELS; p < end; p += 1) k.duty[p] = taskS[p]! + researchS[p]!;
}

/** Re-adds rack r from its members' contributions, in the full pass's ascending system order. */
export function resumRack(w: World, r: number, k: PowerCache): void {
  const kind = w.compiled.sys.kind;
  let input = 0, compute = 0, plain = 0, capLoad = 0, any = 0;
  for (let i = k.memberAt[r]!; i < k.memberAt[r + 1]!; i += 1) {
    const s = k.memberIds[i]!;
    const delivered = k.delivered[s]!, loss = k.loss[s]!;
    input = input + delivered + loss;
    if (kind[s] === 0) compute = compute + delivered;
    else plain = plain + delivered;
    plain = plain + loss;
    capLoad = capLoad + k.capLoad[s]!;
    if (delivered > 0) any = 1;
  }
  k.rackIn[r] = input; k.rackCompute[r] = compute; k.rackPlain[r] = plain; k.rackCapLoad[r] = capLoad; k.rackAny[r] = any;
}
