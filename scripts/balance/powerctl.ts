/**
 * D31 round-start check: a Rack-era stage grown to N copies of its server, with and without Power
 * control (battery plus smart start). From Return, per 10 s over 2 min: Credits earned, energy billed,
 * net, battery charge, awake servers, I, and the round's timeouts and SLA.
 *
 *   npx tsx scripts/balance/powerctl.ts --from=stage.json [--servers=4,12] [--start-with=1] [--head-wait=2]
 */
import { readFileSync } from 'node:fs';
import { advanceGameOwned, applyAction, copyGameState, deserializeSave, researchId, type GameAction, type GameState } from '../../src/game';
import { deriveUnlocks } from '../../src/game/build/research/effects';
import { compileAll } from '../../src/game/core/topology';
import { MODE } from '../../src/game/core/timers';

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const loaded = deserializeSave((JSON.parse(readFileSync(arg('from', ''), 'utf8')) as { save: string }).save);
if (!loaded.ok) throw new Error(loaded.error);
const stageState = loaded.state;
const RICH = '1' + '0'.repeat(40);
const NEEDED = ['s3Sleep', 'meteredPdu', 'powerCtl', 'packageC', ...Array.from({ length: 36 }, (_, i) => `cstate${i + 1}`), 'lbCapability', 'lbHealth'];

function tryAct(s: GameState, a: GameAction): GameState {
  const out = applyAction(s, a);
  return out.ok ? out.state : s;
}

/** One server's full-load watts (parts at full use). */
function fullW(s: GameState): number {
  const c = s.compiled.sys;
  let w = c.coreIdleW[0]! + c.coreLoadW[0]! + c.clockIdleW[0]!;
  for (let r = 0; r < 4; r += 1) w += c.idleW[r]! + c.loadW[r]!;
  for (let a = 0; a < 8; a += 1) w += c.accelLoadW[a]!;
  return w / Math.max(0.05, 1 - c.psuLoss[0]!);
}

function grown(n: number, withCtl: boolean): GameState {
  let s = copyGameState(stageState);
  const completed = [...new Set([...s.research.completed, ...NEEDED.map(researchId)])];
  const research = { ...s.research, completed, unlocks: deriveUnlocks(completed) };
  s = { ...s, research, compiled: compileAll(s.build, research), wallet: { ...s.wallet, credits: RICH as never } };
  if (s.round.phase === 'running') s = tryAct(s, { type: 'endRound' });
  const rack = { kind: 'rack' as const, id: 0 as never };
  for (let i = 0; i < 16 && (s.build.racks[0]!.switch.ports.length < n); i += 1) s = tryAct(s, { type: 'addPorts', sw: rack });
  const first = s.build.racks[0]!.servers.findIndex((x) => x !== null);
  for (let slot = 0; slot < 12 && s.build.racks[0]!.servers.filter((x) => x !== null).length < n; slot += 1) {
    if (s.build.racks[0]!.servers[slot] !== null) continue;
    s = tryAct(s, { type: 'addUnit', parent: rack, slot, source: { kind: 'copy', from: { kind: 'system', id: s.build.racks[0]!.servers[first]! } } });
  }
  // PDU sized for the rack at full load (with 20% headroom); cooling raised a level per 10 kW-equivalent step as needed.
  const full = () => s.compiled.rack.pduCapW[0]!;
  // Sized for what a server really draws in a round (about a quarter of its all-parts maximum), not the maximum.
  const needW = 1.2 * n * 0.25 * fullW(s);
  for (let i = 0; i < 40 && full() < needW; i += 1) s = tryAct(s, { type: 'upgradePart', part: { unit: rack, slot: { kind: 'pdu' } } });
  for (let i = 0; i < 40 && s.compiled.rack.coolerQc[0]! < needW; i += 1) s = tryAct(s, { type: 'upgradePart', part: { unit: rack, slot: { kind: 'rackCooler' } } });
  console.log(`fixture: ${n} servers, server full load ${fullW(s).toExponential(2)} W, PDU ${full().toExponential(2)} W`);
  const k0 = s.build.racks[0]!.switch.ports[0]!;
  for (let p = 0; p < s.build.racks[0]!.switch.ports.length; p += 1) for (let i = 0; i < 20 && s.build.racks[0]!.switch.ports[p]! < k0; i += 1) s = tryAct(s, { type: 'upgradePort', sw: rack, port: p });
  for (const filter of ['capability', 'health'] as const) s = tryAct(s, { type: 'setFilter', unit: rack, filter, on: true });
  if (withCtl) {
    s = tryAct(s, { type: 'replacePart', part: { unit: rack, slot: { kind: 'powerCtl' } }, generation: 0, preserveCapacity: false });
    s = tryAct(s, { type: 'setStartConfig', unit: rack, startWith: Number(arg('start-with', '1')), headWaitS: Number(arg('head-wait', '2')), busyPct: null, order: 'fastest' });
  }
  return s;
}

function measure(n: number, withCtl: boolean): void {
  let s = grown(n, withCtl);
  const servers = s.build.racks[0]!.servers.filter((x) => x !== null).length;
  s = tryAct(s, { type: 'returnToMarket' });
  console.log(`\n${servers} servers, ${withCtl ? `Power control levelOne (start with ${arg('start-with', '1')}, head wait ${arg('head-wait', '2')} s)` : 'no Power control'}`);
  console.log('| Window | Gross | Energy billed | Net | Battery | Awake | I |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  let gross = Number(s.ledger.gross), energy = Number(s.ledger.energy) + s.wallet.energyMeter;
  const startRound = s.round.index;
  for (let k = 1; k <= 12; k += 1) {
    s = advanceGameOwned(s, 10_000).state;
    const g = Number(s.ledger.gross) - gross, e = Number(s.ledger.energy) + s.wallet.energyMeter - energy;
    gross += g; energy += e;
    let awake = 0;
    for (let i = 0; i < s.hot.sys.len; i += 1) if (s.hot.sys.mode[i] === MODE.onMarket) awake += 1;
    const bat = s.build.racks[0]!.powerCtl ? `${(s.hot.rack.batteryJ[0]! / 1e9).toFixed(2)} GJ` : '-';
    console.log(`| ${(k - 1) * 10}–${k * 10} s | ${g.toExponential(2)} | ${e.toExponential(2)} | ${(g - e).toExponential(2)} | ${bat} | ${awake} | ${s.market.intensity.toFixed(1)} |`);
    if (s.round.index !== startRound || s.round.phase !== 'running') { console.log('round ended'); break; }
  }
  const out = applyAction(s, { type: 'endRound' });
  const r = out.ok ? out.state.round.reports.at(-1)! : null;
  if (r) console.log(`2 min: met ${r.met}, timeouts ${r.failedByCause.timeout}, other fails ${Object.values(r.failedByCause).reduce((a, b) => a + b, 0) - r.failedByCause.timeout}, from battery ${r.energyBreakdown.fromBattery}, refill ${r.energyBreakdown.batteryRefill}`);
}

for (const n of arg('servers', '4,12').split(',').map(Number)) { measure(n, false); measure(n, true); }
