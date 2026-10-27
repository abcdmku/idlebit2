/**
 * Shared balance fixture: a bot stage's Rack-era server copied into N slots of its rack, with ports at
 * its speed, uplinks raised to carry the ports, the PDU and cooler sized for the real draw, and the
 * capability and health filters on. Optional Power control (D31). Used by powerctl.ts and fleet.ts.
 */
import { readFileSync } from 'node:fs';
import { applyAction, copyGameState, deserializeSave, researchId, type GameAction, type GameState } from '../../src/game';
import { deriveUnlocks } from '../../src/game/build/research/effects';
import { compileAll } from '../../src/game/core/topology';

/** A Rack-era server draws about 12% of its all-parts maximum over a round (measured: 2.6e7 of 2.16e8 W); PDU and cooler are sized to that with 20% headroom. */
const DRAW_SHARE = 0.12;
const RICH = '1' + '0'.repeat(40);
const NEEDED = ['s3Sleep', 'meteredPdu', 'powerCtl', 'packageC', ...Array.from({ length: 36 }, (_, i) => `cstate${i + 1}`), 'lbCapability', 'lbHealth'];

export function loadStage(path: string): GameState {
  const loaded = deserializeSave((JSON.parse(readFileSync(path, 'utf8')) as { save: string }).save);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.state;
}

export function tryAct(s: GameState, a: GameAction): GameState {
  const out = applyAction(s, a);
  return out.ok ? out.state : s;
}

/** One server's full-load watts (every part at full use, through its PSU). */
export function fullW(s: GameState, id = 0): number {
  const c = s.compiled.sys;
  let w = c.coreIdleW[id]! + c.coreLoadW[id]! + c.clockIdleW[id]!;
  for (let r = 0; r < 4; r += 1) w += c.idleW[id * 4 + r]! + c.loadW[id * 4 + r]!;
  for (let a = 0; a < 8; a += 1) w += c.accelLoadW[id * 8 + a]!;
  return w / Math.max(0.05, 1 - c.psuLoss[id]!);
}

export interface FleetOptions { readonly powerCtl?: { readonly startWith: number; readonly headWaitS: number } | null; readonly log?: boolean }

export function grownFleet(stage: GameState, n: number, opts: FleetOptions = {}): GameState {
  let s = copyGameState(stage);
  const completed = [...new Set([...s.research.completed, ...NEEDED.map(researchId)])];
  const research = { ...s.research, completed, unlocks: deriveUnlocks(completed) };
  s = { ...s, research, compiled: compileAll(s.build, research), wallet: { ...s.wallet, credits: RICH as never } };
  if (s.round.phase === 'running') s = tryAct(s, { type: 'endRound' });
  const rack = { kind: 'rack' as const, id: 0 as never };
  for (let i = 0; i < 16 && s.build.racks[0]!.switch.ports.length < n; i += 1) s = tryAct(s, { type: 'addPorts', sw: rack });
  const first = s.build.racks[0]!.servers.findIndex((x) => x !== null);
  for (let slot = 0; slot < 12 && s.build.racks[0]!.servers.filter((x) => x !== null).length < n; slot += 1) {
    if (s.build.racks[0]!.servers[slot] !== null) continue;
    s = tryAct(s, { type: 'addUnit', parent: rack, slot, source: { kind: 'copy', from: { kind: 'system', id: s.build.racks[0]!.servers[first]! } } });
  }
  // Sized for what a server really draws in a round (about a quarter of its all-parts maximum), with 20% headroom.
  const needW = 1.2 * n * DRAW_SHARE * fullW(s);
  // The PDU carries peaks (GPU tasks draw about 0.3 of the maximum each), cooling, switch and losses.
  for (let i = 0; i < 40 && s.compiled.rack.pduCapW[0]! < n * 0.6 * fullW(s); i += 1) s = tryAct(s, { type: "upgradePart", part: { unit: rack, slot: { kind: "pdu" } } });
  if (s.compiled.rack.pduCapW[0]! < n * 0.6 * fullW(s)) s = tryAct(s, { type: "replacePart", part: { unit: rack, slot: { kind: "pdu" } }, generation: 1, preserveCapacity: true });
  for (let i = 0; i < 40 && s.compiled.rack.pduCapW[0]! < needW; i += 1) s = tryAct(s, { type: 'upgradePart', part: { unit: rack, slot: { kind: 'pdu' } } });
  for (let i = 0; i < 40 && s.compiled.rack.coolerQc[0]! < needW; i += 1) s = tryAct(s, { type: 'upgradePart', part: { unit: rack, slot: { kind: 'rackCooler' } } });
  const k0 = s.build.racks[0]!.switch.ports[0]!;
  for (let p = 0; p < s.build.racks[0]!.switch.ports.length; p += 1) for (let i = 0; i < 20 && s.build.racks[0]!.switch.ports[p]! < k0; i += 1) s = tryAct(s, { type: 'upgradePort', sw: rack, port: p });
  // Uplinks as fast as the switch allows (D25: an uplink must carry its ports combined).
  for (let u = 0; u < s.build.racks[0]!.switch.uplinks.length; u += 1) for (let i = 0; i < 30; i += 1) s = tryAct(s, { type: 'upgradeUplink', sw: rack, uplink: u });
  for (const filter of ['capability', 'health'] as const) s = tryAct(s, { type: 'setFilter', unit: rack, filter, on: true });
  if (opts.powerCtl) {
    s = tryAct(s, { type: 'replacePart', part: { unit: rack, slot: { kind: 'powerCtl' } }, generation: 0, preserveCapacity: false });
    s = tryAct(s, { type: 'setStartConfig', unit: rack, startWith: opts.powerCtl.startWith, headWaitS: opts.powerCtl.headWaitS, busyPct: null, order: 'fastest' });
  }
  if (opts.log) {
    const b = s.build.racks[0]!;
    console.log(`fixture: ${b.servers.filter((x) => x !== null).length} servers, ports ${JSON.stringify(b.switch.ports)}, uplinks ${JSON.stringify(b.switch.uplinks)}, PDU ${s.compiled.rack.pduCapW[0]!.toExponential(2)} W`);
  }
  return s;
}
