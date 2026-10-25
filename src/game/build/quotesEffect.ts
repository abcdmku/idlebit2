import type { GameAction } from '../types/actions';
import type { BuildState } from '../types/build';
import type { PartRef, PartSlot, SwitchRef } from '../types/ids';
import type { CapacityUnit, EffectPreview } from '../types/quotes';
import type { GameState } from '../types/state';
import { amount } from '../amount';
import { ladderSpeed, LADDERS, portWatts, type LadderDef } from './catalog';
import { energyPrice, partEffect, preview } from './effect';
import { readPart } from './partAccess';
import { planPrice, type Plan } from './plan';
import { switchAt } from './ports';

/*
 * The "x → x" a tray or link quote shows (R42, R43). Part upgrades and replacements use the part
 * preview; adds show the count they change; link steps show the speed in Hz. A plan that cannot
 * run has no after, so no effect, except a link locked to its structure (D15.5), which still shows
 * the step it will offer there.
 */

const countEffect = (before: number, after: number, unit: CapacityUnit): EffectPreview =>
  ({ capacityBefore: before, capacityAfter: after, unit, wattsBefore: 0, wattsAfter: 0, energyPerMinuteDelta: amount(0), paybackS: null });

/** A board add: the system preview (watts, payback) with the count it changes as capacity. */
function addEffect(state: GameState, plan: Plan & { ok: true }, system: number, kind: 'core' | 'socket' | 'ram' | 'drive' | 'scheduler'): EffectPreview | null {
  const spec = state.build.systems[system]?.spec, next = plan.change.build.systems[system]?.spec;
  if (!spec || !next) return null;
  const slot: PartSlot = kind === 'core' ? { kind: 'core', socket: 0, index: 0 } : kind === 'socket' ? { kind: 'cpu', socket: 0 }
    : kind === 'scheduler' ? { kind: 'scheduler' } : { kind, index: 0 };
  const base = partEffect(state, { unit: { kind: 'system', id: system as never }, slot }, plan.change.build, plan.change.price);
  if (!base || kind === 'scheduler') return base;
  const count = (s: typeof spec) => kind === 'core' ? s.cpu?.cores.length ?? 0 : kind === 'socket' ? s.cpu ? s.cpuCount : 0
    : kind === 'ram' ? s.ram.length : s.drives.length;
  return { ...base, capacityBefore: count(spec), capacityAfter: count(next), unit: 'slots' };
}

const linkPreview = (state: GameState, ref: PartRef, before: number, after: number, wBefore: number, wAfter: number, cost: bigint): EffectPreview =>
  preview(before, after, 'Hz', wBefore, wAfter, energyPrice(state, ref), cost, null);
const idleW = (row: LadderDef, gen: number, ks: readonly number[]) => ks.reduce((sum, k) => sum + portWatts(row, gen, k).idle, 0);

/** A switch port or uplink step: the slowest changed port's speed, before and after. */
function switchEffect(state: GameState, sw: SwitchRef, which: 'ports' | 'uplinks', index: number | 'all', after: BuildState | null, cost: bigint): EffectPreview | null {
  const a = switchAt(state.build, sw);
  if (!a) return null;
  const ks = a.sw[which];
  const pick = (list: readonly number[]) => index === 'all' ? list : list[index] === undefined ? [] : [list[index]!];
  const before = pick(ks);
  if (before.length === 0) return null;
  const next = after ? switchAt(after, sw)?.sw[which] : null;
  const changed = next ? pick(next) : before.map((k) => k + 1);
  const ref: PartRef = { unit: sw, slot: { kind: sw.kind === 'rack' ? 'switch' : 'roomSwitch' } };
  return linkPreview(state, ref, ladderSpeed(Math.min(...before)), ladderSpeed(Math.min(...changed)),
    idleW(a.row, a.sw.gen, before), idleW(a.row, a.sw.gen, changed), cost);
}

/** A data-plane or backbone step (one k per site; the data plane has one port per zone). */
function ladderEffect(state: GameState, ref: PartRef, after: BuildState, cost: bigint): EffectPreview | null {
  const pa = readPart(state.build, ref), pb = readPart(after, ref);
  if (!pa || !pb || (pa.id !== 'dataPlane' && pa.id !== 'backbone')) return null;
  const row = LADDERS[pa.id];
  const site = ref.unit.kind === 'site' ? state.build.sites[ref.unit.id] : null;
  const ports = pa.id === 'dataPlane' ? Math.max(1, site?.zones.filter((z) => z !== null).length ?? 1) : 1;
  return linkPreview(state, ref, ladderSpeed(pa.level), ladderSpeed(pb.level),
    ports * idleW(row, pa.gen, [pa.level]), ports * idleW(row, pb.gen, [pb.level]), cost);
}

/** Units under an addUnit parent. */
function unitsUnder(s: BuildState, p: Extract<GameAction, { type: 'addUnit' }>['parent']): number {
  switch (p.kind) {
    case 'global': return s.sites.filter((x) => x).length;
    case 'site': return s.sites[p.id]?.zones.filter((z) => z !== null).length ?? 0;
    case 'room': return s.rooms[p.id]?.racks.filter((r) => r !== null).length ?? 0;
    case 'rack': return s.racks[p.id]?.servers.filter((x) => x !== null).length ?? 0;
    default: return 0;
  }
}

/** A count add still locked behind research: the count it will change, n → n + 1. */
function lockedAddEffect(b: BuildState, action: GameAction): EffectPreview | null {
  switch (action.type) {
    case 'addPart': {
      const s = b.systems[action.system]?.spec;
      if (!s) return null;
      const n = action.kind === 'core' ? s.cpu?.cores.length ?? 0 : action.kind === 'socket' ? s.cpu ? s.cpuCount : 0
        : action.kind === 'ram' ? s.ram.length : action.kind === 'drive' ? s.drives.length : null;
      return n === null ? null : countEffect(n, n + 1, 'slots');
    }
    case 'addRow': { const rows = b.rooms[action.room]?.rows; return rows === undefined ? null : countEffect(rows, rows + 1, 'slots'); }
    case 'addUnit': { const n = unitsUnder(b, action.parent); return countEffect(n, n + 1, 'slots'); }
    case 'addPorts': case 'addUplink': {
      const sw = switchAt(b, action.sw)?.sw;
      const n = sw ? (action.type === 'addPorts' ? sw.ports : sw.uplinks).length : null;
      return n === null ? null : countEffect(n, n + 1, 'ports');
    }
    default: return null;
  }
}

/** Effect of a tray or link quote's action, or null when it has no before and after. */
export function quoteEffect(state: GameState, action: GameAction, plan: Plan): EffectPreview | null {
  const structureLocked = !plan.ok && plan.lock?.code === 'research';
  switch (action.type) {
    case 'upgradePort':
      return plan.ok || structureLocked ? switchEffect(state, action.sw, 'ports', action.port, plan.ok ? plan.change.build : null, planPrice(plan) ?? 0n) : null;
    case 'upgradeUplink':
      return plan.ok || structureLocked ? switchEffect(state, action.sw, 'uplinks', action.uplink, plan.ok ? plan.change.build : null, planPrice(plan) ?? 0n) : null;
  }
  if (!plan.ok) return structureLocked ? lockedAddEffect(state.build, action) : null;
  const b = state.build, after = plan.change.build, cost = plan.change.price;
  switch (action.type) {
    case 'upgradePart': {
      const part = readPart(b, action.part);
      if (part?.id === 'dataPlane' || part?.id === 'backbone') return ladderEffect(state, action.part, after, cost);
      return partEffect(state, action.part, after, cost);
    }
    case 'replaceCpu': return partEffect(state, { unit: { kind: 'system', id: action.system }, slot: { kind: 'cpu', socket: 0 } }, after, cost);
    case 'addPart':
      return action.kind === 'core' || action.kind === 'socket' || action.kind === 'ram' || action.kind === 'drive' || action.kind === 'scheduler'
        ? addEffect(state, plan, action.system, action.kind) : null;
    case 'addRow': return countEffect(b.rooms[action.room]?.rows ?? 0, after.rooms[action.room]?.rows ?? 0, 'slots');
    case 'addPorts': case 'addUplink': {
      const before = switchAt(b, action.sw)?.sw, next = switchAt(after, action.sw)?.sw;
      const which = action.type === 'addPorts' ? 'ports' : 'uplinks';
      return before && next ? countEffect(before[which].length, next[which].length, 'ports') : null;
    }
    case 'addUnit': return countEffect(unitsUnder(b, action.parent), unitsUnder(after, action.parent), 'slots');
    default: return null;
  }
}
