import { G, LOC } from '../core/buffers';
import { headDeadlineTick, QUEUE_VISIBLE, RECENT_OUTCOMES } from '../core/constants';
import type { World } from '../core/world';
import { FAMILIES, familyKey, payoutAt } from '../market/families';
import { canRunFleet, detailIndex } from '../market/fleet';
import { FIRST, nextLink } from '../net/paths';
import { FAIL_CAUSES, FAIL_DETAILS, type EventRing, type FailCounts, type FailDetail } from '../types/events';
import { familyId } from '../types/ids';
import type { FeedSnapshot } from '../types/snapshot';
import type { GameState } from '../types/state';
import type { OutcomeView, QueueEntryView, TaskIcon, TransferView } from '../types/views';
import { feedRates } from './feedRates';
import { linkName, linkTransfer, pipeTransfer } from './flows';
import { taskRequirements } from './taskRequirements';

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

function entry(state: GameState, roundIndex: number, taskId: number, family: number, size: number, committed: boolean, speed: number,
  deadline: number | null, windowEndTick: number | null): QueueEntryView {
  const face = familyFace(family);
  const def = FAMILIES[family];
  const gate = state.round.phase === 'running' && def ? canRunFleet(state, def, size) : 0;
  const work = def ? payoutAt(def, size) : 0;
  return {
    ...taskRequirements(familyId(family), size, deadline),
    task: { epoch: state.epoch, roundIndex, taskId }, key: taskId, icons: face.icons,
    committed, dismissible: !committed,
    blockedBy: gate !== 0 ? FAIL_DETAILS[detailIndex(gate)] ?? null : null,
    work, transferS: speed > 0 ? work / speed : null, windowEndTick,
  };
}

/** The first QUEUE_VISIBLE queue entries, head first: the front (returned work), then the window tasks. */
export function queueWindow(state: GameState): QueueEntryView[] {
  const out: QueueEntryView[] = [];
  const hot = state.hot, m = state.market, speed = firstLinkSpeed(state);
  for (let r = hot.g[G.frontHead] ?? -1; r >= 0 && out.length < QUEUE_VISIBLE; r = hot.rec.next[r] ?? -1) {
    const deadline = hot.rec.deadline[r]! >= 0 ? hot.rec.deadline[r]! : null;
    out.push(entry(state, m.roundIndex, hot.rec.taskId[r]!, hot.rec.family[r]!, hot.rec.units[r]!, true, speed,
      deadline, deadline === null ? null : hot.rec.taken[r]! + deadline - 1));
  }
  for (const t of m.window) {
    if (out.length >= QUEUE_VISIBLE) break;
    out.push(entry(state, m.roundIndex, t.taskId, t.family, t.size, false, speed, t.deadline, null));
  }
  return out;
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
  return {
    roundIndex: state.market.roundIndex,
    timing: running ? 'running' : 'onReturn',
    window,
    headDeadlineTick: running ? headDeadlineTick(state.market.headTick) : null,
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
