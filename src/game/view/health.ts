import { G } from '../core/buffers';
import { FAIL_CAUSES, FAIL_DETAILS, type FailDetail } from '../types/events';
import type { FleetHealthView, HealthIssue, HealthProblem, HealthSeverity } from '../types/health';
import { rackId, roomId, siteId, systemId, type LevelId, type NodeRef, type UnitRef } from '../types/ids';
import type { GameState } from '../types/state';
import { unitLabel } from './labels';

/** Rows the Health popup lists; the rest are counted. */
export const HEALTH_LIMIT = 12;

const SITE = 0, ROOM = 1, RACK = 2, SYS = 3;
const SEVERITY: readonly HealthSeverity[] = ['risk', 'idle'];
const RISK = 0, IDLE = 1;
const ISSUE_RANK: Readonly<Record<HealthIssue, number>> = { hot: 0, offMarket: 1 };

/** One problem as the scan finds it: numbers only, so the scan allocates nothing per healthy unit. */
interface Found {
  readonly scope: number; readonly id: number; readonly issue: HealthIssue; readonly severity: number;
  readonly text: string; readonly factor: number | null; readonly tempF: number | null;
  /** The same unit's lesser issues: one row per unit. */
  also: readonly string[];
}
const NO_ALSO: readonly string[] = [];

/**
 * Most severe first, then the issue, the wider scope and the lower id. Live readings never order the list,
 * so a row keeps its place while its numbers change.
 */
const before = (a: Found, b: Found): boolean =>
  a.severity !== b.severity ? a.severity < b.severity
    : a.issue !== b.issue ? ISSUE_RANK[a.issue] < ISSUE_RANK[b.issue]
      : a.scope !== b.scope ? a.scope < b.scope
        : a.id < b.id;

function unitOf(f: Found): UnitRef {
  return f.scope === SITE ? { kind: 'site', id: siteId(f.id) } : f.scope === ROOM ? { kind: 'room', id: roomId(f.id) }
    : f.scope === RACK ? { kind: 'rack', id: rackId(f.id) } : { kind: 'system', id: systemId(f.id) };
}

/** Names from the outermost opened container down to the unit. */
function pathOf(state: GameState, unit: UnitRef): string[] {
  const b = state.build;
  const sys = unit.kind === 'system' ? b.systems[unit.id] : null;
  const rack = unit.kind === 'rack' ? b.racks[unit.id] : sys ? b.racks[sys.rack] : null;
  const room = unit.kind === 'room' ? b.rooms[unit.id] : rack ? b.rooms[rack.room] : null;
  const site = unit.kind === 'site' ? b.sites[unit.id] : room ? b.sites[room.site] : null;
  const path: string[] = [];
  if (site?.opened) path.push(unitLabel(state, { kind: 'site', id: site.id }));
  if (room?.opened) path.push(unitLabel(state, { kind: 'room', id: room.id }));
  if (rack?.opened) path.push(unitLabel(state, { kind: 'rack', id: rack.id }));
  if (sys) path.push(unitLabel(state, { kind: 'system', id: sys.id }));
  return path;
}

function targetOf(state: GameState, f: Found): NodeRef {
  if (f.scope === SITE) return { level: 'global', id: 0 };
  if (f.scope === ROOM) return { level: 'room', id: roomId(f.id) };
  if (f.scope === RACK) return { level: 'rack', id: rackId(f.id) };
  return { level: state.research.unlocks.levels.system ? 'system' : 'chip', id: systemId(f.id) };
}

function roundFailures(state: GameState): FleetHealthView['round'] {
  const g = state.hot.g, met = g[G.met] ?? 0, failed = g[G.failed] ?? 0;
  if (!state.research.unlocks.rules.includes('telemetry')) return { met, failed, byCause: null };
  const byCause: { cause: (typeof FAIL_CAUSES)[number]; count: number; detail: FailDetail | null }[] = [];
  FAIL_CAUSES.forEach((cause, c) => {
    const count = g[G.fail + c] ?? 0;
    if (count <= 0) return;
    let detail: FailDetail | null = null, best = 0;
    for (let d = 0; d < FAIL_DETAILS.length; d += 1) {
      const n = state.hot.detailRound[c * FAIL_DETAILS.length + d] ?? 0;
      if (n > best) { best = n; detail = FAIL_DETAILS[d]!; }
    }
    byCause.push({ cause, count, detail });
  });
  byCause.sort((a, b) => b.count - a.count);
  return { met, failed, byCause };
}

/**
 * Fleet health: every unit with a problem now, most severe first, cut to `limit` rows, and this round's
 * failures. Read-only over compiled and hot columns, one pass per unit table (O(units), no per-unit
 * allocation), so it is cheap at the largest fleet. An off-market switch is reported once, at the unit
 * that owns it; the units below it are not listed again. A unit with several issues is one row, its most
 * severe issue first; two or more servers switched off in one opened rack are that rack's row.
 */
export function selectFleetHealth(state: GameState, limit: number = HEALTH_LIMIT): FleetHealthView {
  const c = state.compiled, h = state.hot, b = state.build;
  const max = Math.max(0, Math.floor(limit));
  const top: Found[] = [];
  const counts = { risk: 0, idle: 0 };
  // Only a rack can be faulty (hot); the other levels list switched-off units, which are not faults.
  const levels: Record<LevelId, 'risk' | null> = { chip: null, system: null, rack: null, room: null, global: null };
  // A unit's issues wait here until its scan ends; flush() makes them one row.
  const unitIssues: Found[] = [];
  const add = (scope: number, id: number, issue: HealthIssue, severity: number, text: string, factor: number | null = null, tempF: number | null = null) => {
    unitIssues.push({ scope, id, issue, severity, text, factor, tempF, also: NO_ALSO });
  };
  const off = (scope: number, id: number, text = 'Off market') => add(scope, id, 'offMarket', IDLE, text);
  const flush = () => {
    if (unitIssues.length === 0) return;
    let f = unitIssues[0]!;
    for (const other of unitIssues) if (before(other, f)) f = other;
    if (unitIssues.length > 1) {
      const first = f;
      f.also = unitIssues.filter(other => other !== first).sort((x, y) => (before(x, y) ? -1 : 1)).map(other => other.text);
    }
    unitIssues.length = 0;
    counts[SEVERITY[f.severity]!] += 1;
    if (f.severity === RISK) levels.rack = 'risk';
    let at = top.length;
    while (at > 0 && before(f, top[at - 1]!)) at -= 1;
    if (at >= max) return;
    top.splice(at, 0, f);
    if (top.length > max) top.pop();
  };

  // Units under a switched-off ancestor: reported once, above. A unit whose ancestors are all on and whose
  // compiled intent is off has its own switch off (core/topology).
  const siteDown = new Uint8Array(c.site.len), roomDown = new Uint8Array(c.room.len), rackDown = new Uint8Array(c.rack.len);

  for (let s = 0; s < c.site.len; s += 1) {
    if (c.site.alive[s] !== 1 || c.site.opened[s] !== 1) continue;
    if (c.site.intent[s] !== 1) { siteDown[s] = 1; off(SITE, s); flush(); }
  }

  for (let m = 0; m < c.room.len; m += 1) {
    if (c.room.alive[m] !== 1) continue;
    if (siteDown[c.room.site[m] ?? -1] === 1) { roomDown[m] = 1; continue; }
    if (c.room.opened[m] === 1 && c.room.intent[m] !== 1) { roomDown[m] = 1; off(ROOM, m); flush(); }
  }

  // Servers whose own switch is off, per rack: two or more in an opened rack are reported on the rack's row.
  const offCount = new Uint16Array(c.rack.len), offStorage = new Uint8Array(c.rack.len);
  for (let s = 0; s < c.sys.len; s += 1) {
    const r = c.sys.rack[s] ?? -1;
    if (c.sys.alive[s] !== 1 || r < 0 || c.rack.opened[r] !== 1 || c.sys.intent[s] === 1) continue;
    offCount[r] = (offCount[r] ?? 0) + 1;
    if (b.systems[s]?.spec.kind === 'storageNode') offStorage[r] = 1;
  }

  for (let r = 0; r < c.rack.len; r += 1) {
    if (c.rack.alive[r] !== 1) continue;
    if (roomDown[c.rack.room[r] ?? -1] === 1) { rackDown[r] = 1; continue; }
    if (c.rack.opened[r] !== 1) continue;
    if (c.rack.intent[r] !== 1) { rackDown[r] = 1; off(RACK, r); flush(); continue; }
    const eff = h.rack.eff[r] ?? 1, throttled = h.rack.throttled[r] === 1;
    if (eff < 1 || throttled) add(RACK, r, 'hot', RISK, throttled ? 'Thermal throttle' : 'Running hot', eff, h.rack.tempF[r] ?? 70);
    const n = offCount[r] ?? 0;
    if (n > 1) off(RACK, r, `${n} ${offStorage[r] === 1 ? 'systems' : 'servers'} off market`);
    flush();
  }

  for (let s = 0; s < c.sys.len; s += 1) {
    if (c.sys.alive[s] !== 1 || rackDown[c.sys.rack[s] ?? -1] === 1) continue;
    if (c.sys.intent[s] !== 1 && (offCount[c.sys.rack[s] ?? -1] ?? 0) < 2) { off(SYS, s); flush(); }
  }

  const problems: HealthProblem[] = top.map((f) => {
    const unit = unitOf(f);
    return {
      unit, target: targetOf(state, f), path: pathOf(state, unit), issue: f.issue, severity: SEVERITY[f.severity]!, text: f.text,
      also: f.also, factor: f.factor, tempF: f.tempF,
    };
  });
  return { problems, counts, fault: counts.risk > 0 ? 'risk' : null, levels, round: roundFailures(state) };
}
