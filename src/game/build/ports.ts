import { MAX_RACK_PORTS, MAX_ROOM_PORTS, MAX_UPLINKS } from '../core/constants';
import type { BuildState, SwitchBuild } from '../types/build';
import type { PartRef, SwitchRef } from '../types/ids';
import type { LockReason } from '../types/quotes';
import type { GameState } from '../types/state';
import { ladderInstall, ladderSpeed, LADDERS, partName, portAddPrice, networkStepPrice, networkStepsBetween, type LadderDef } from './catalog';
import { ceilingLock, genLock } from './locks';
import { readPart, writePart } from './partAccess';
import { coldScopes, fail, locked, planned, type Plan } from './plan';
import { researchDef } from './research/tree';

/*
 * Switch ports on the 1-2-5 ladder (spec §7.3, §12.5). Each port and uplink steps alone; with the
 * same-speed toggle one action raises every port below the target, priced as the sum of its steps.
 */
const speedLabel = (k: number): string => {
  const hz = ladderSpeed(k);
  const [unit, div] = hz >= 1e9 ? ['GHz', 1e9] : hz >= 1e6 ? ['MHz', 1e6] : ['kHz', 1e3];
  return `${hz / div} ${unit}`;
};

interface SwitchAt { readonly sw: SwitchBuild; readonly row: LadderDef; readonly opened: boolean; readonly ceiling: 'rackPorts' | 'roomPorts'; readonly max: number }
export function switchAt(build: BuildState, ref: SwitchRef): SwitchAt | null {
  if (ref.kind === 'rack') {
    const r = build.racks[ref.id];
    return r ? { sw: r.switch, row: LADDERS.switch, opened: r.opened, ceiling: 'rackPorts', max: MAX_RACK_PORTS } : null;
  }
  const z = build.rooms[ref.id];
  return z ? { sw: z.switch, row: LADDERS.roomSwitch, opened: z.opened, ceiling: 'roomPorts', max: MAX_ROOM_PORTS } : null;
}

function withSwitch(build: BuildState, ref: SwitchRef, sw: SwitchBuild): BuildState {
  if (ref.kind === 'rack') return { ...build, racks: build.racks.map((r, i) => (i === ref.id && r ? { ...r, switch: sw } : r)) };
  return { ...build, rooms: build.rooms.map((z, i) => (i === ref.id && z ? { ...z, switch: sw } : z)) };
}

const closed = (): Plan => fail('locked', 'Opens with its level');

/** The same-speed target (spec §12.5): kmax, or kmax + 1 when every port is already at kmax. */
export const sameSpeedTarget = (ports: readonly number[]): number => {
  const kmax = Math.max(...ports);
  return ports.every((k) => k === kmax) ? kmax + 1 : kmax;
};

/**
 * D15.5: a link is upgraded where it plugs in, once that structure is open. Before Rack the lone
 * system's pipe is port 1 of the hidden starter switch and stays at its default speed; a rack's
 * uplink waits for the Room network rack, a room's uplink for Global.
 */
const structureLock = (level: 'rack' | 'room' | 'global', text: string): LockReason => {
  const node = researchDef(level === 'global' ? 'dataCenter' : level);
  return { code: 'research', node: node?.id ?? null, text };
};
export const PIPE_LOCK_TEXT = 'Upgrade at the Rack switch';

/** A port or uplink step to k on an open switch: the generation's top. */
const stepLock = (at: SwitchAt, k: number): LockReason | null =>
  k > at.row.topK[at.sw.gen]! ? { code: 'ceiling', node: null, text: 'Max' } : null;

/** Where an uplink becomes upgradeable: the upstream structure (D15.5), or null when it is open. */
function uplinkLock(build: BuildState, ref: SwitchRef): LockReason | null {
  if (ref.kind === 'rack') {
    const room = build.rooms[build.racks[ref.id]?.room ?? -1];
    return room?.opened ? null : structureLock('room', 'Upgrade at the Room network rack');
  }
  const site = build.sites[build.rooms[ref.id]?.site ?? -1];
  return site?.opened ? null : structureLock('global', 'Upgrade at Global');
}

export function planUpgradePort(state: GameState, ref: SwitchRef, port: number | 'all'): Plan {
  const at = switchAt(state.build, ref);
  if (!at) return fail('invalid', 'No such switch');
  if (!at.opened && (ref.kind !== 'rack' || port === 'all')) return closed();
  const { sw, row } = at;
  if (!at.opened && port !== 'all') {
    const k = sw.ports[port];
    if (k === undefined) return fail('invalid', 'No such port');
    return locked(structureLock('rack', PIPE_LOCK_TEXT), `Pipe · ${speedLabel(k)}`);
  }
  // D35: the whole switch steps together whenever asked, and always when its ports are matched (sameSpeed, default on).
  if (port === 'all' || sw.sameSpeed) {
    const target = sameSpeedTarget(sw.ports);
    const label = `All ports · ${speedLabel(target)}`;
    const price = sw.ports.reduce((sum, k) => sum + networkStepsBetween(row, k, target), 0n);
    const lock = stepLock(at, target);
    if (lock) return locked(lock, label, price);
    return planned({ build: withSwitch(state.build, ref, { ...sw, ports: sw.ports.map((k) => Math.max(k, target)) }), price }, label);
  }
  const k = sw.ports[port];
  if (k === undefined) return fail('invalid', 'No such port');
  const label = `Port ${port + 1} · ${speedLabel(k + 1)}`;
  const price = networkStepPrice(row, k);
  const lock = stepLock(at, k + 1);
  if (lock) return locked(lock, label, price);
  return planned({ build: withSwitch(state.build, ref, { ...sw, ports: sw.ports.map((x, i) => (i === port ? k + 1 : x)) }), price }, label);
}

export function planUpgradeUplink(state: GameState, ref: SwitchRef, uplink: number): Plan {
  const at = switchAt(state.build, ref);
  if (!at) return fail('invalid', 'No such switch');
  if (!at.opened) return closed();
  const { sw, row } = at;
  const k = sw.uplinks[uplink];
  if (k === undefined) return fail('invalid', 'No such uplink');
  const label = `Uplink ${uplink + 1} · ${speedLabel(k + 1)}`;
  const lock = uplinkLock(state.build, ref) ?? stepLock(at, k + 1);
  if (lock) return locked(lock, label, networkStepPrice(row, k, true));
  return planned({ build: withSwitch(state.build, ref, { ...sw, uplinks: sw.uplinks.map((x, i) => (i === uplink ? k + 1 : x)) }), price: networkStepPrice(row, k, true) }, label);
}

/** One more port, up to the rackPorts / roomPorts ceiling. It arrives at base speed, or at the common speed with its steps. */
export function planAddPort(state: GameState, ref: SwitchRef): Plan {
  const at = switchAt(state.build, ref);
  if (!at) return fail('invalid', 'No such switch');
  if (!at.opened) return closed();
  const { sw, row } = at;
  const n = sw.ports.length + 1;
  const base = row.baseK[sw.gen]!;
  const k = sw.sameSpeed ? Math.max(base, ...sw.ports) : base;
  const price = portAddPrice(row, sw.gen, n - row.minPorts) + networkStepsBetween(row, base, k);
  const label = `Add port ${n}`;
  const lock = n > at.max ? { code: 'cap' as const, node: null, text: 'Max' } : ceilingLock(state.research.unlocks, at.ceiling, n);
  if (lock) return locked(lock, label, price);
  return planned({ build: withSwitch(state.build, ref, { ...sw, ports: [...sw.ports, k] }), price }, label);
}

/** D13: an uplink plugs into the upstream device's default port (its current generation, gen 0 before it opens). */
function upstreamDefaultK(build: BuildState, ref: SwitchRef): number {
  if (ref.kind === 'rack') {
    const room = build.rooms[build.racks[ref.id]?.room ?? -1];
    return LADDERS.roomSwitch.baseK[room?.opened ? room.switch.gen : 0]!;
  }
  const site = build.sites[build.rooms[ref.id]?.site ?? -1];
  return LADDERS.dataPlane.baseK[site?.opened ? site.dataPlane.gen : 0]!;
}

export function planAddUplink(state: GameState, ref: SwitchRef): Plan {
  const at = switchAt(state.build, ref);
  if (!at) return fail('invalid', 'No such switch');
  if (!at.opened) return closed();
  const { sw, row } = at;
  const n = sw.uplinks.length + 1;
  const price = portAddPrice(row, sw.gen, n - 1);
  const label = `Add uplink ${n}`;
  const lock = n > MAX_UPLINKS ? { code: 'cap' as const, node: null, text: 'Max' } : ceilingLock(state.research.unlocks, 'uplinks', n);
  if (lock) return locked(lock, label, price);
  return planned({ build: withSwitch(state.build, ref, { ...sw, uplinks: [...sw.uplinks, upstreamDefaultK(state.build, ref)] }), price }, label);
}

export function planSameSpeed(state: GameState, ref: SwitchRef, on: boolean): Plan {
  const at = switchAt(state.build, ref);
  if (!at) return fail('invalid', 'No such switch');
  return planned({ build: withSwitch(state.build, ref, { ...at.sw, sameSpeed: on }), price: 0n }, on ? 'Same speed on' : 'Same speed off');
}

/**
 * Cold replace of a ladder part with generation g (spec §12.5): install, extra ports and uplinks at
 * the new generation; every port to clamp(k, baseK, topK). Data plane and backbone keep one k.
 */
export function planReplaceLadder(state: GameState, ref: PartRef, g: number): Plan {
  const part = readPart(state.build, ref);
  if (!part || !(part.id in LADDERS)) return fail('invalid', 'No such part');
  const row = LADDERS[part.id as keyof typeof LADDERS];
  const label = partName(part.id, g);
  // A replace only moves up (user, 25 Oct).
  if (g <= part.gen || g >= row.baseK.length) return fail('invalid', 'Only a newer generation', label);
  const clamp = (k: number) => Math.min(row.topK[g]!, Math.max(row.baseK[g]!, k));
  let price = ladderInstall(row, g);
  let build: BuildState;
  if (part.id === 'switch' || part.id === 'roomSwitch') {
    const unit = ref.unit;
    const sref: SwitchRef | null = unit.kind === 'rack' ? { kind: 'rack', id: unit.id } : unit.kind === 'room' ? { kind: 'room', id: unit.id } : null;
    if (!sref) return fail('invalid', 'No such switch');
    const sw = switchAt(state.build, sref)!.sw;
    for (let j = 1; j <= sw.ports.length - row.minPorts; j += 1) price += portAddPrice(row, g, j);
    for (let j = 1; j < sw.uplinks.length; j += 1) price += portAddPrice(row, g, j);
    build = withSwitch(state.build, sref, { ...sw, gen: g, ports: sw.ports.map(clamp), uplinks: sw.uplinks.map(clamp) });
  } else {
    build = writePart(state.build, ref, g, clamp(part.level))!;
  }
  const lock = genLock(state.research.unlocks, part.id, g);
  if (lock) return locked(lock, label, price);
  const scope = ref.slot.kind === 'backbone' || ref.unit.kind === 'global' ? null : ref.unit;
  return planned({ build, price, cold: coldScopes(state, scope) }, label);
}
