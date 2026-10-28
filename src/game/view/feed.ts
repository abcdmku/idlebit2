import { G, LOC } from '../core/buffers';
import { headDeadlineTick, QUEUE_VISIBLE, RECENT_OUTCOMES } from '../core/constants';
import type { World } from '../core/world';
import { FAMILIES, familyKey, payoutAt, payloadAt } from '../market/families';
import { classesOf, detailIndex, gateOn, isEligibleMode } from '../market/fleet';
import { MODE } from '../core/timers';
import type { FamilyDef } from '../types/catalog';
import { FIRST, nextLink } from '../net/paths';
import { FAIL_CAUSES, FAIL_DETAILS, type EventRing, type FailCounts, type FailDetail } from '../types/events';
import { familyId } from '../types/ids';
import type { FeedSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { OutcomeView, QueueEntryView, ResearchQueueEntryView, TaskIcon, TransferView } from '../types/views';
import { researchDef, TREE_INDEX } from '../build/research/tree';
import { researchOpsPerSec } from './research';
import { feedRates } from './feedRates';
import { linkName, linkTransfer, pipeTransfer } from './flows';
import { taskRequirements } from './taskRequirements';
import { pickupWait } from './pickup';
import { fleetGates } from './capability';
import { taskCpuCounter } from './taskCpu';

/** Static per-family feed facts: label and icons. Built once per family. */
interface FamilyFace { readonly label: string; readonly icons: readonly TaskIcon[] }
const FACES = new Map<number, FamilyFace>();
export function familyFace(f: number): FamilyFace {
  let face = FACES.get(f);
  if (face) return face;
  const def = FAMILIES[f];
  const icons: TaskIcon[] = [];
  if (def) {
    for (const s of def.stages) if (!icons.includes(s.resource)) icons.push(s.resource);
    if (def.vramBits.fixed > 0 || def.vramBits.perSize > 0) icons.push('vram');
    if (def.windowS !== null) icons.push('window');
    if (def.ecc) icons.push('ecc');
    if (def.tensor) icons.push('tensor');
    if (def.minZones > 1) icons.push('zones');
    if (def.region.kind !== 'any') icons.push('region');
  }
  face = { label: def?.name ?? familyKey(familyId(f)), icons };
  FACES.set(f, face);
  return face;
}

/** Observation context for net/paths (reads compiled and hot only). */
const ctx = (state: GameState): World => state as unknown as World;

/** Speed of the first link a task would take now (spec §16.2), or 0 without one. */
export function firstLinkSpeed(state: GameState): number {
  const c = state.compiled;
  for (let s = 0; s < c.sys.len; s += 1) {
    if (c.sys.alive[s] !== 1 || c.sys.kind[s] !== 0) continue;
    if (c.rack.opened[c.sys.rack[s]!] !== 1) return c.sys.pipeSpeed[s] ?? 0;
    const l = nextLink(ctx(state), s, FIRST);
    return l >= 0 ? c.link.speed[l] ?? 0 : 0;
  }
  return 0;
}

type CapClass = ReturnType<typeof classesOf>[number];
/**
 * Online systems whose fixed hardware can run a task of `def` (QueueEntryView.capableSystems): the
 * fleet check's size-free gates (fixed working set, GPU and GPU cores, VRAM, ECC, region) on each
 * capability class, never load. Online: switched on, in a mode that takes work (or paused between
 * rounds). Each class's online count is counted once per window and shared by its entries.
 */
function capableCounter(state: GameState): (def: FamilyDef | undefined) => number {
  const c = state.compiled, mode = state.hot.sys.mode, intent = c.sys.intent, online = new Map<CapClass, number>();
  const onlineIn = (cls: CapClass): number => {
    let n = online.get(cls);
    if (n !== undefined) return n;
    n = 0;
    for (const m of cls.members) if (intent[m] === 1 && (isEligibleMode(mode[m]!) || mode[m] === MODE.paused)) n += 1;
    online.set(cls, n);
    return n;
  };
  return (def) => {
    if (!def) return 0;
    let n = 0;
    for (const cls of classesOf(c)) if (gateOn(c, cls.rep, def, 0) === 0) n += onlineIn(cls);
    return n;
  };
}

function entry(state: GameState, roundIndex: number, taskId: number, family: number, size: number, committed: boolean, speed: number,
  deadline: number | null, windowEndTick: number | null, capable: (def: FamilyDef | undefined) => number, head: boolean,
  gateFor: (def: FamilyDef, size: number) => number, coresFor: ReturnType<typeof taskCpuCounter>): QueueEntryView {
  const face = familyFace(family);
  const def = FAMILIES[family];
  const gate = state.round.phase === 'running' && def ? gateFor(def, size) : 0;
  const work = def ? payoutAt(def, size) : 0;
  return {
    ...taskRequirements(familyId(family), size, deadline),
    ...(def ? coresFor(def, size) : { cpuCoresWanted: 1, cpuCoresAvailable: 0 }),
    kind: 'task', task: { epoch: state.epoch, roundIndex, taskId }, key: taskId, icons: face.icons,
    committed, dismissible: !committed,
    blockedBy: gate !== 0 ? FAIL_DETAILS[detailIndex(gate)] ?? null : null,
    waitingFor: gate !== 0 ? null : state.round.phase !== 'running' ? 'round' : head && def ? pickupWait(state, def, size) : 'head',
    work, dataReward: work / (state.hot.fam.dataRatio[family] || def?.dataRatio || 1),
    transferS: speed > 0 && def ? payloadAt(def, size) / speed : null, windowEndTick, capableSystems: capable(def),
  };
}

/** The first QUEUE_VISIBLE queue entries, head first: the front (returned work), then the window tasks. */
export function queueWindow(state: GameState): QueueEntryView[] {
  const out: QueueEntryView[] = [];
  const hot = state.hot, m = state.market, speed = firstLinkSpeed(state), capable = capableCounter(state), gateFor = fleetGates(state), coresFor = taskCpuCounter(state);
  for (let r = hot.g[G.frontHead] ?? -1; r >= 0 && out.length < QUEUE_VISIBLE; r = hot.rec.next[r] ?? -1) {
    const deadline = hot.rec.deadline[r]! >= 0 ? hot.rec.deadline[r]! : null;
    out.push(entry(state, m.roundIndex, hot.rec.taskId[r]!, hot.rec.family[r]!, hot.rec.units[r]!, true, speed,
      deadline, deadline === null ? null : hot.rec.taken[r]! + deadline - 1, capable, out.length === 0, gateFor, coresFor));
  }
  for (const t of m.window) {
    if (out.length >= QUEUE_VISIBLE) break;
    out.push(entry(state, m.roundIndex, t.taskId, t.family, t.size, false, speed, t.deadline, null, capable, out.length === 0, gateFor, coresFor));
  }
  return out;
}

/** D27: the research task in line or running, or null. */
export function researchEntry(state: GameState): ResearchQueueEntryView | null {
  const r = state.research;
  if (r.active === null || r.stoppedInsolvent) return null;
  const def = researchDef(r.active), holders = state.hot.g[G.researchHolders] ?? 0;
  let threads = 0;
  if (holders > 0) for (let s = 0; s < state.hot.sys.len; s += 1) threads += state.hot.sys.researchThreads[s] ?? 0;
  const work = def?.work ?? 0;
  return {
    kind: 'research', key: -1 - (TREE_INDEX.get(r.active) ?? 0), project: r.active, name: def?.name ?? r.active, work,
    progress: work > 0 ? Math.min(1, r.activeProgress / work) : 0, running: holders > 0, holders, threads,
    opsPerSec: holders > 0 ? researchOpsPerSec(state) : 0,
  };
}

const TRANSFERS_SHOWN = 16;
/** Pipe transfers, then each link's sending transfer, at most TRANSFERS_SHOWN. */
export function transfers(state: GameState): TransferView[] {
  const out: TransferView[] = [];
  const c = state.compiled, hot = state.hot, rec = hot.rec;
  for (let s = 0; s < hot.sys.len && out.length < TRANSFERS_SHOWN; s += 1) {
    const t = pipeTransfer(state, s);
    if (t) out.push(t);
  }
  for (let l = 0; l < hot.link.len && out.length < TRANSFERS_SHOWN; l += 1) {
    const r = hot.link.head[l] ?? -1;
    if (r < 0 || rec.loc[r] !== LOC.link) continue;
    out.push(linkTransfer(state, r, l, linkName(c.link.kind[l]!)));
  }
  return out;
}

const detailOf = (d: FailDetail | null | undefined): FailDetail | null => d ?? null;

/** The last RECENT_OUTCOMES met and failed cohorts, newest last. */
export function recentOutcomes(events: EventRing): OutcomeView[] {
  const out: OutcomeView[] = [];
  const e = events.entries;
  for (let i = e.length - 1; i >= 0 && out.length < RECENT_OUTCOMES; i -= 1) {
    const ev = e[i]!;
    if (ev.kind === 'met') out.push({ family: ev.family, count: ev.count, outcome: 'met', detail: null, tick: ev.tick });
    else if (ev.kind === 'failed') out.push({ family: ev.family, count: ev.count, outcome: ev.cause, detail: detailOf(ev.detail), tick: ev.tick });
  }
  return out.reverse();
}

function liveFailures(state: GameState): FailCounts | null {
  if (!state.research.unlocks.rules.includes('telemetry')) return null;
  const g = state.hot.g;
  return Object.fromEntries(FAIL_CAUSES.map((c, i) => [c, g[G.fail + i] ?? 0])) as FailCounts;
}

/** The market feed. Reuses `prev`'s outcome list while the event ring is unchanged. Draws no RNG. */
export function feedSnapshot(state: GameState, prev: FeedSnapshot | null, sameEvents: boolean): FeedSnapshot {
  const g = state.hot.g;
  const running = state.round.phase === 'running';
  const rates = feedRates(state.hot, state.clock.tick);
  const window = queueWindow(state);
  const research = researchEntry(state);
  const researchHead = research !== null && !research.running;
  return {
    roundIndex: state.market.roundIndex,
    timing: running ? 'running' : 'onReturn',
    window,
    research,
    headDeadlineTick: running && !researchHead ? headDeadlineTick(state.market.headTick) : null,

    blockedBy: window[0]?.blockedBy ?? null,
    transfers: transfers(state),
    inTransfer: g[G.transitCount] ?? 0, queued: g[G.queued] ?? 0, running: g[G.running] ?? 0,
    taken: g[G.taken] ?? 0, dismissed: g[G.dismissed] ?? 0,
    intensity: state.market.intensity,
    takesPerSec: running ? rates.takes : 0,
    recentOutcomes: prev && sameEvents ? prev.recentOutcomes : recentOutcomes(state.events),
    liveFailures: liveFailures(state),
    rates: running ? { met: rates.met, fail: rates.fail } : { met: 0, fail: 0 },
    failBin: running ? rates.failBin : null,
  };
}
