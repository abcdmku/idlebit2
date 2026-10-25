/**
 * Real-sim A/B probe. Loads a stage file, applies one build variant through public actions, then
 * plays rounds with no purchases or research (returning to market at once) and prints income,
 * energy, Data, failures and spill per hour of game time. Every variant starts from the same save.
 *
 *   npx tsx scripts/balance/ab.ts --from=stage.json --hours=2 --variants=keep,nodrives,hdd,ram1+hdd
 *
 * Variants (joined with +): keep, nodrives, hdd, ssd, ram1 (one RAM module of the newest
 * generation at L1), noram, gpu0 (remove GPUs).
 */
import { readFileSync } from 'node:fs';
import { advanceGameOwned, applyAction, deserializeSave, TICK_MS, type GameAction, type GameState, type RoundReport } from '../../src/game';
import type { StageFile } from './run';

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const hours = Number(arg('hours', '2'));
const stage = JSON.parse(readFileSync(arg('from', ''), 'utf8')) as StageFile;

function act(s: GameState, a: GameAction): GameState {
  const out = applyAction(s, a);
  if (!out.ok) { console.error(`  ${a.type} failed: ${JSON.stringify(out)}`.slice(0, 200)); return s; }
  return out.state;
}
const sysIds = (s: GameState) => s.build.systems.flatMap((x, id) => (x ? [id] : []));
const newestGen = (s: GameState, kind: 'ram' | 'drive'): number => {
  const bits = kind === 'ram' ? s.research.unlocks.gens.ram : s.research.unlocks.gens.storage;
  let g = 0;
  for (let i = 0; i < 8; i += 1) if (bits & (1 << i)) g = i;
  return g;
};

function removeAll(s: GameState, kind: 'ram' | 'drive' | 'gpu'): GameState {
  for (const id of sysIds(s)) {
    const spec = s.build.systems[id]!.spec;
    const n = kind === 'ram' ? spec.ram.length : kind === 'drive' ? spec.drives.length : spec.accels.length;
    for (let i = n - 1; i >= 0; i -= 1) s = act(s, { type: 'removePart', part: { unit: { kind: 'system', id: id as never }, slot: { kind, index: i } } });
  }
  return s;
}
function addEach(s: GameState, kind: 'ram' | 'drive', gen: number): GameState {
  for (const id of sysIds(s)) s = act(s, { type: 'addPart', system: id as never, kind, generation: gen });
  return s;
}

/** Copies system 0 into empty slots of rack 0 until there are n systems, and steps new ports to port 0's speed. */
function fill(s: GameState, n: number): GameState {
  const portK = s.build.racks[0]!.switch.ports[0]!;
  for (let slot = 0; slot < s.build.racks[0]!.servers.length && sysIds(s).length < n; slot += 1) {
    if (s.build.racks[0]!.servers[slot] !== null) continue;
    s = act(s, { type: 'addUnit', parent: { kind: 'rack', id: 0 as never }, slot, source: { kind: 'copy', from: { kind: 'system', id: 0 as never } } });
  }
  for (let p = 0; p < s.build.racks[0]!.switch.ports.length; p += 1) {
    for (let guard = 0; guard < 40 && s.build.racks[0]!.switch.ports[p]! < portK; guard += 1) {
      const next = act(s, { type: 'upgradePort', sw: { kind: 'rack', id: 0 as never }, port: p });
      if (next === s) break;
      s = next;
    }
  }
  return s;
}
const rich = (s: GameState): GameState => ({ ...s, wallet: { ...s.wallet, credits: `1${'0'.repeat(30)}` as never } });

const TRANSFORMS: Record<string, (s: GameState) => GameState> = {
  rich,
  fill8: (s) => fill(s, 8),
  fill12: (s) => fill(s, 12),
  keep: (s) => s,
  nodrives: (s) => removeAll(s, 'drive'),
  hdd: (s) => addEach(removeAll(s, 'drive'), 'drive', 0),
  ssd: (s) => addEach(removeAll(s, 'drive'), 'drive', 1),
  noram: (s) => removeAll(s, 'ram'),
  ram1: (s) => addEach(removeAll(s, 'ram'), 'ram', newestGen(s, 'ram')),
  gpu0: (s) => removeAll(s, 'gpu'),
};

function play(start: GameState, ticks: number): RoundReport[] {
  let s = start;
  const end = s.clock.tick + ticks;
  const rounds: RoundReport[] = [];
  while (s.clock.tick < end) {
    if (s.round.phase !== 'running') {
      const r = applyAction(s, { type: 'returnToMarket' });
      if (r.ok) s = r.state;
    }
    const { state, report } = advanceGameOwned(s, Math.min(600, end - s.clock.tick) * TICK_MS);
    s = state;
    rounds.push(...report.roundsEnded);
  }
  return rounds;
}

const loaded = deserializeSave(stage.save);
if (!loaded.ok) throw new Error(loaded.error);
console.log(`from ${(loaded.state.clock.tick / 36000).toFixed(2)} h, ${sysIds(loaded.state).length} systems, ${hours} h each`);
console.log('| Variant | Rounds | Mean len | Peak I | Gross/h | Energy/h | Net/h | Data/h | Met | Failed | Top fails | Disk work |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|');
for (const v of arg('variants', 'keep').split(',')) {
  const fresh = deserializeSave(stage.save);
  if (!fresh.ok) throw new Error(fresh.error);
  let s = fresh.state;
  for (const t of v.split('+')) s = TRANSFORMS[t]!(s);
  const t0 = performance.now();
  const rounds = play(s, Math.round(hours * 36_000));
  const sum = (f: (r: RoundReport) => number) => rounds.reduce((a, r) => a + f(r), 0);
  const fails = new Map<string, number>();
  for (const r of rounds) for (const d of r.details) fails.set(`${d.cause}·${d.detail}`, (fails.get(`${d.cause}·${d.detail}`) ?? 0) + d.count);
  const top = [...fails].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ');
  const gross = sum((r) => Number(r.gross)) / hours, energy = sum((r) => Number(r.energy)) / hours;
  const delivered = sum((r) => r.deliveredWork);
  console.log(`| ${v} | ${rounds.length} | ${(sum((r) => r.durationTicks) / Math.max(1, rounds.length) / 600).toFixed(1)} min | ${Math.max(0, ...rounds.map((r) => r.peakIntensity)).toFixed(1)} | ${gross.toExponential(2)} | ${energy.toExponential(2)} | ${(gross - energy).toExponential(2)} | ${(sum((r) => Number(r.data)) / hours).toExponential(2)} | ${sum((r) => r.met)} | ${sum((r) => Object.values(r.failedByCause).reduce((a, b) => a + b, 0))} | ${top} | ${(100 * sum((r) => r.spill.diskWork) / Math.max(1, delivered)).toFixed(0)}% |`);
  console.error(`  ${v}: ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
}
