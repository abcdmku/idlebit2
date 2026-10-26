import { viewW } from '../core/constants';
import { supplyLossW } from '../phys/supplies';
import type { BuildState, SystemSpec } from '../types/build';
import type { OverSupply } from '../types/quotes';
import type { GameState, Unlocks } from '../types/state';
import { capacity, lossFraction, PARTS } from './catalog';
import { fullLoadWatts } from './configModel';

/**
 * Supply warning on a quote (user, 26 Oct; sandbox: a pushed GHz chip tripped its power supply). After the
 * plan, at full load, would the changed system's power supply, its rack PDU or its room UPS be over capacity?
 * The first one over, innermost first, in view watts. A warning only: the buy is never blocked.
 *
 * Full load is the worst case the supply must carry: every system of the rack (or room) at full load, plus
 * the rack's (room's) own overhead (cooler, switch, LB) as measured now. Unchanged systems read compiled
 * watts; only changed or added systems are recompiled. O(systems in the room).
 */
const R = 4;
function compiledFull(state: GameState, s: number): number {
  const c = state.compiled.sys;
  let w = c.coreIdleW[s]! + c.coreLoadW[s]! + c.clockIdleW[s]! + c.clockLoadW[s]!;
  for (let r = 0; r < R; r += 1) w += c.idleW[s * R + r]! + c.loadW[s * R + r]!;
  return w;
}
/** Full-load watts per spec object, per unlock set: specs are shared (R20), so a fleet-wide step recompiles each once. */
const fullMemo = new WeakMap<Unlocks, WeakMap<SystemSpec, number>>();
function specFull(spec: SystemSpec, u: Unlocks): number {
  let m = fullMemo.get(u);
  if (!m) { m = new WeakMap(); fullMemo.set(u, m); }
  let w = m.get(spec);
  if (w === undefined) { w = fullLoadWatts(spec, u); m.set(spec, w); }
  return w;
}
const psuOf = (spec: SystemSpec) => ({ cap: capacity(PARTS.psu, spec.psu.gen, spec.psu.level), loss: lossFraction(PARTS.psu, spec.psu.gen, spec.psu.level) });

export function overSupply(state: GameState, after: BuildState): OverSupply | null {
  const before = state.build, u = state.research.unlocks, hot = state.hot;
  const changed: number[] = [];
  for (let i = 0; i < after.systems.length; i += 1) if (after.systems[i] && after.systems[i] !== before.systems[i]) changed.push(i);
  if (changed.length === 0) return null;
  const psuLive = u.levels.system;
  const full = new Map<number, number>();
  // Full-load delivered watts of a system in the after build, and its input through its power supply.
  const fullOf = (s: number): number => {
    let w = full.get(s);
    if (w === undefined) {
      const sys = after.systems[s]!;
      w = sys === before.systems[s] && s < state.compiled.sys.len ? compiledFull(state, s) : specFull(sys.spec, u);
      full.set(s, w);
    }
    return w;
  };
  const inputOf = (s: number): number => {
    const w = fullOf(s);
    if (!psuLive) return w;
    const p = psuOf(after.systems[s]!.spec);
    return w + supplyLossW(w, p.cap, p.loss);
  };
  // The input a system draws now (its measured delivered watts through its supply), for the overhead.
  const nowInput = (s: number): number => {
    if (s >= state.compiled.sys.len || !before.systems[s]) return 0;
    const d = hot.sys.drawW[s] ?? 0, cap = state.compiled.sys.psuCapW[s]!;
    return psuLive && cap > 0 ? d + supplyLossW(d, cap, state.compiled.sys.psuLoss[s]!) : d;
  };

  // 1. The system's own power supply (live from System on, D38).
  if (psuLive) {
    for (const s of changed) {
      const cap = psuOf(after.systems[s]!.spec).cap, w = fullOf(s);
      if (w > cap) return { part: 'psu', capW: viewW(cap), afterW: viewW(w) };
    }
  }
  // 2. The rack PDU, then 3. the room UPS: every system at full load plus today's overhead.
  const racks = new Set(changed.map((s) => after.systems[s]!.rack as number));
  const rackIn = new Map<number, number>();
  const rackAfter = (r: number): { delivered: number; input: number } => {
    const rack = after.racks[r]!;
    let sum = 0, now = 0;
    for (const s of rack.servers) if (s !== null && after.systems[s]) { sum += inputOf(s); now += nowInput(s); }
    const overhead = r < state.compiled.rack.len ? Math.max(0, (hot.rack.drawW[r] ?? 0) - now) : 0;
    const delivered = sum + overhead;
    const cap = capacity(PARTS.pdu, rack.pdu.gen, rack.pdu.level), opened = rack.opened;
    return { delivered, input: opened ? delivered + supplyLossW(delivered, cap, lossFraction(PARTS.pdu, rack.pdu.gen, rack.pdu.level)) : delivered };
  };
  for (const r of racks) {
    const rack = after.racks[r];
    if (!rack) continue;
    const a = rackAfter(r);
    rackIn.set(r, a.input);
    const cap = capacity(PARTS.pdu, rack.pdu.gen, rack.pdu.level);
    if (rack.opened && a.delivered > cap) return { part: 'pdu', capW: viewW(cap), afterW: viewW(a.delivered) };
  }
  const rooms = new Set([...racks].map((r) => after.racks[r]?.room as number | undefined).filter((m): m is number => m !== undefined));
  for (const m of rooms) {
    const room = after.rooms[m];
    if (!room || !room.opened || room.ups.length === 0) continue;
    let sum = 0, now = 0;
    for (const r of room.racks) {
      if (r === null || !after.racks[r]) continue;
      sum += rackIn.get(r) ?? rackAfter(r).input;
      if (r < state.compiled.rack.len) {
        const d = hot.rack.drawW[r] ?? 0, cap = state.compiled.rack.pduCapW[r]!;
        now += cap > 0 ? d + supplyLossW(d, cap, state.compiled.rack.pduLoss[r]!) : d;
      }
    }
    const overhead = m < state.compiled.room.len ? Math.max(0, (hot.room.drawW[m] ?? 0) - now) : 0;
    const delivered = sum + overhead;
    // Live UPSs share the load equally; the room is over when a share exceeds the smallest UPS.
    const cap = room.ups.length * Math.min(...room.ups.map((x) => capacity(PARTS.ups, x.gen, x.level)));
    if (delivered > cap) return { part: 'ups', capW: viewW(cap), afterW: viewW(delivered) };
  }
  return null;
}
