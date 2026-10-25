import { LINK_KIND } from '../core/buffers';
import { DT_S, HEAD_TICKS, SERVERS_PER_RACK } from '../core/constants';
import type { World } from '../core/world';
import { dropProbe, headGate, probeHead, takeHead } from '../market/queue';
import { hasRule } from '../exec/rules';
import { shapeOf } from '../exec/shape';
import { canAdmit, noteTake, refreshSummaries, reserve } from '../exec/slots';
import { addTransit } from './fifo';
import { applyFilters } from './filters';
import { placeGang } from './gang';
import { forward } from './links';
import { beginDecision, memo, withExactSummaries } from './routeMemo';
import { FIRST, linkOf, nextLink } from './paths';
import { routeStrategy } from './routers';
import { ROUTE_STRATEGY_IDS } from '../types/catalog';
import { childAdmits, childAt, FANOUT, noteRoute, RACK, resetRouted, ROOM, routerOf, topRouter } from './scope';

/**
 * Route phase (tick step 4, spec §7.6, §7.7). From Rack on, the top router takes the head while
 * some system can take it: the walk goes top-down, at each router the candidates are the children
 * that can admit now, the router's filters narrow them and its strategy picks one; a child whose
 * subtree turns out to have no taker is dropped and the router picks again. Each take reserves a
 * slot and queues the transfer on the first link of its path (served from the next tick). Order is
 * strict: when the head can't be taken, nothing behind it is tried. Routers have no budget (D12.5).
 */

/** With queued take (reserveOnRoute) the first-link room bound is 10 s of capacity instead of one tick. */
const QUEUED_TAKE_TICKS = HEAD_TICKS;

const top = { kind: 0, id: 0 };
const cols = { strategy: 0, filters: 0, placements: 0 };
export const cand = new Int32Array(32);
export const slots = new Int32Array(32);
/** Per-depth candidate lists for the backtracking walk. */
const walkCand = [0, 1, 2, 3].map(() => new Int32Array(32));
const walkSlot = [0, 1, 2, 3].map(() => new Int32Array(32));
const hopKind = new Int32Array(4), hopId = new Int32Array(4), hopSlot = new Int32Array(4);
let hops = 0;

/** First-link room (spec §7.4): the backlog of s's first link is under one tick of its capacity. */
export function firstLinkRoom(w: World, s: number): boolean {
  const l = nextLink(w, s, FIRST);
  return l < 0 || linkRoom(w, l, w.compiled.sys.rack[s]!);
}

/** firstLinkRoom's test for first link l of a system in `rack`. */
export function linkRoom(w: World, l: number, rack: number): boolean {
  const c = w.compiled.link;
  const ticks = w.compiled.rack.reserveOnRoute[rack] === 1 ? QUEUED_TAKE_TICKS : 1;
  return w.hot.link.backlog[l]! < Math.max(1, c.channels[l]!) * c.speed[l]! * DT_S * ticks;
}

/** A system that can take a task now (spec §6.4): room, a take left this tick, first-link room. */
export const canTake = (w: World, s: number): boolean => canAdmit(w, s) && firstLinkRoom(w, s);

/** Candidates of router (kind, id) into cand/slots (gang placement); returns n. */
export function candidates(w: World, kind: number, id: number): number {
  let n = 0;
  for (let k = 0; k < FANOUT[kind]!; k += 1) {
    const u = childAt(w, kind, id, k);
    if (u >= 0 && childAdmits(w, kind, u)) { cand[n] = u; slots[n] = k; n += 1; }
  }
  return n;
}

/*
 * A room's racks without a taker. After one filter pass every filter is passed by all survivors or
 * by none, so re-filtering a subset changes nothing, and the loop below just tries the survivors in
 * the strategy's order until one has a system that can take. For a strategy whose pick depends only
 * on the candidates (no cursor or counter), that is its pick among the survivors that have a taker;
 * a rack without one fails before its own strategy runs, so skipping it skips no side effect.
 */
const STATELESS = Uint8Array.from(ROUTE_STRATEGY_IDS, (s) => (s === 'roundRobin' || s === 'weighted' ? 0 : 1));

/** Keeps the racks in C that hold a system that can take now, in order; returns the kept count. */
function keepTakers(w: World, C: Int32Array, S: Int32Array, n: number): number {
  let kept = 0;
  for (let i = 0; i < n; i += 1) {
    const rack = C[i]!;
    let taker = rackTaker(w, rack);
    for (let k = 0; k < FANOUT[RACK]! && taker < 0; k += 1) {
      const u = childAt(w, RACK, rack, k);
      if (u >= 0 && canTake(w, u)) taker = 1;
    }
    if (taker < 0) taker = 0;
    if (taker === 1) { C[kept] = rack; S[kept] = S[i]!; kept += 1; }
  }
  return kept;
}

/**
 * Whether rack `rack` has a system that can take now, when the rack answers for all its systems:
 * 0 with no free slot (exact summaries count every system that can admit), else, when its first
 * link sits above the server port (the same link for every member), that link's room. -1 when its
 * systems must be checked one by one.
 */
function rackTaker(w: World, rack: number): number {
  const c = w.compiled;
  if (!memo.exact || c.rack.alive[rack] !== 1) return -1;
  if (w.hot.rack.freeSlots[rack] === 0) return 0;
  for (let k = 0; k < SERVERS_PER_RACK; k += 1) {
    const s = c.rack.servers[rack * SERVERS_PER_RACK + k]!;
    if (s < 0 || c.sys.alive[s] !== 1) continue;
    let l = -1;
    for (let kind = LINK_KIND.backbone; kind > LINK_KIND.server && l < 0; kind -= 1) l = linkOf(w, s, kind);
    return l < 0 ? -1 : linkRoom(w, l, rack) ? 1 : 0;
  }
  return -1;
}

/** Walks from router (kind, id) to one system that can take record r (§7.7), or -1. */
function placeOne(w: World, r: number, kind: number, id: number, depth: number): number {
  const C = walkCand[depth]!, S = walkSlot[depth]!;
  let n = 0;
  for (let k = 0; k < FANOUT[kind]!; k += 1) {
    const u = childAt(w, kind, id, k);
    if (u >= 0 && (kind === RACK ? canTake(w, u) : childAdmits(w, kind, u))) { C[n] = u; S[n] = k; n += 1; }
  }
  let first = true;
  while (n > 0) {
    routerOf(w, kind, id, cols);
    n = applyFilters(w, cols.filters, kind, r, C, S, n);
    if (first && kind === ROOM && STATELESS[cols.strategy] === 1) n = keepTakers(w, C, S, n);
    first = false;
    if (n === 0) break;
    const pick = routeStrategy(cols.strategy).choose(w, kind, id, r, C, S, n);
    hopKind[depth] = kind; hopId[depth] = id; hopSlot[depth] = S[pick]!;
    if (kind === RACK) { hops = depth + 1; return C[pick]!; }
    const s = placeOne(w, r, kind - 1, C[pick]!, depth + 1);
    if (s >= 0) return s;
    for (let i = pick + 1; i < n; i += 1) { C[i - 1] = C[i]!; S[i - 1] = S[i]!; }
    n -= 1;
  }
  return -1;
}

/** Sends taken record r toward system `target`: reserves its slot and queues it on the first link. */
export function dispatch(w: World, r: number, target: number): void {
  const rec = w.hot.rec;
  reserve(w, target, rec.count[r]!, r);
  noteTake(w, target);
  rec.target[r] = target;
  addTransit(w.hot, rec.count[r]!);
  forward(w, r, FIRST, hasRule(w, 'qos'));
}

export function routePhase(w: World): void {
  if (w.round.phase !== 'running' || !topRouter(w, top)) return;
  // Mode changes and take-limit resets move the summaries unseen; their racks are recounted.
  refreshSummaries(w);
  resetRouted(w);
  // Summaries are exact from the recount through every take of this phase.
  withExactSummaries(w, () => takeWhileRoom(w));
}

/** Takes heads while some system can take them; stops at the first head that can't be taken. */
function takeWhileRoom(w: World): void {
  const rec = w.hot.rec;
  // Each take uses one of a finite number of per-tick take slots, so this loop ends.
  for (;;) {
    if (headGate(w) !== 0) return;
    const r = probeHead(w);
    if (r < 0) return;
    beginDecision();
    if (shapeOf(rec.family[r]!).members > 1) {
      if (!placeGang(w, r, top.kind, top.id)) { dropProbe(w, r); return; }
      continue;
    }
    hops = 0;
    const s = placeOne(w, r, top.kind, top.id, 0);
    if (s < 0) { dropProbe(w, r); return; }
    for (let i = 0; i < hops; i += 1) noteRoute(w, hopKind[i]!, hopId[i]!, hopSlot[i]!);
    dispatch(w, takeHead(w, r), s);
  }
}
