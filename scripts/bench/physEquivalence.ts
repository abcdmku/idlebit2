// Seeded long-run state hashes for the phys equivalence proof (diagnostic only).
// npx tsx scripts/bench/physEquivalence.ts [--out=file.json] [--compare=file.json] [--only=a,b] [--verify] [--frame=ms] [--exact-routing]
// --verify: the change-driven power pass also compares every non-candidate system, and the partial
// summary recount also recounts everything; either throws on a difference (R34).
// --exact-routing: site and global scope rank by the exact finish (D24 summaries off), for comparing with pre-D24 trees.
// Each fixture runs on the owned path in 50 ms frames and on the pure path in uneven partitions;
// both must hash the same at every checkpoint, and match the reference file when comparing.
import { readFileSync, writeFileSync } from 'node:fs';
import { advanceGame, advanceGameOwned, copyGameState, type GameState } from '../../src/game';
import { TICK_MS } from '../../src/game/core/constants';
import { primeMarket } from '../../src/game/market/prime';
import { buildState } from '../../src/game/testkit/builders';
import { FLEET_WARMUP_TICKS, FLEETS, MAX_FLEET } from '../../src/game/testkit/fleets';
import { provisionInfrastructure } from '../../src/game/testkit/infrastructure';
import { gpuLoadedState } from '../../src/game/testkit/gpuLoaded';
import { RESEARCH } from '../../src/game/build/research/tree';
import { hashState } from './stateHash';
import { powerDebug } from '../../src/game/phys/powerCache';
import { summaryDebug } from '../../src/game/exec/slots';
import { routeSummary } from '../../src/game/net/summary';

const arg = (key: string) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
/** Owned-path frame (ms); --frame=60000 runs the offline engine's chunks, so the change-driven power pass engages. */
const FRAME_MS = Number(arg('frame') ?? 50);

interface Fixture { ticks: number; every: number; make(): GameState }
const researching = (s: GameState, _mode?: string): GameState =>
  ({ ...s, research: { ...s.research, active: s.research.completed[0]! } });
const FIXTURES: Record<string, Fixture> = {
  boot: { ticks: 6_000, every: 1_000, make: FLEETS.boot },
  rackFull: { ticks: 6_000, every: 1_000, make: FLEETS.rackFull },
  roomFull: { ticks: 3_000, every: 500, make: FLEETS.roomFull },
  fleetMax: { ticks: 3_000, every: 500, make: FLEETS.fleetMax },
  fleetMaxHot: { ticks: 3_000, every: 500, make: FLEETS.fleetMaxHot },
  gpuPowered: { ticks: 1_200, every: 300, make: () => gpuLoadedState(true) },
  /** Research on: skipped racks tally research every tick (exec's tally cache). */
  rackFullResearch: { ticks: 3_000, every: 500, make: () => researching(FLEETS.rackFull(), 'shared') },
  roomFullResearch: { ticks: 3_000, every: 500, make: () => researching(FLEETS.roomFull(), 'background') },
  /** A project completes within the first ticks: compiled buffers are replaced inside an advance call. */
  bootResearch: { ticks: 3_000, every: 500, make: () => {
    const s = FLEETS.boot(), def = RESEARCH.find((r) => !s.research.completed.includes(r.id))!;
    return { ...s, research: { ...s.research, active: def.id, activeProgress: def.work * 0.99999, queue: [] } };
  } },
  /** fleetMax at the architecture's I = 34 (many takes, long QoS FIFOs, gangs); built fresh per run. */
  fleetMax34: { ticks: 1_000, every: 250, make: () => advanceGameOwned(primeMarket(provisionInfrastructure(buildState(MAX_FLEET)), 34), FLEET_WARMUP_TICKS * TICK_MS).state },
};

/** Supply and lump events seen, by kind (proves fleetMaxHot cycles supplies). */
function tallyEvents(state: GameState, since: number, out: Record<string, number>): number {
  for (const e of state.events.entries) if (e.seq >= since) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return state.events.nextSeq;
}

function run(name: string, f: Fixture, pure: boolean) {
  const start = f.make();
  let state = pure ? start : copyGameState(start);
  const hashes: string[] = [], events: Record<string, number> = {};
  let seq = state.events.nextSeq, i = 0, ms = 0;
  // Uneven pure partitions (ms): crossing tick boundaries at varying offsets.
  const parts = [37, 163, 250, 1_000, 50, 1, 99, 400];
  const span = f.every * 100, end = f.ticks * 100;
  const t0 = performance.now();
  while (ms < end) {
    const want = pure ? parts[i++ % parts.length]! : FRAME_MS;
    const step = Math.min(want, (Math.floor(ms / span) + 1) * span - ms);
    state = (pure ? advanceGame : advanceGameOwned)(state, step).state;
    ms += step;
    seq = tallyEvents(state, seq, events);
    if (ms % span === 0) hashes.push(hashState(state));
  }
  return { name, path: pure ? 'pure' : 'owned', hashes, events, seconds: +((performance.now() - t0) / 1000).toFixed(2),
    round: state.round.phase, tick: state.clock.tick };
}

if (process.argv.includes('--verify')) { powerDebug.verify = true; summaryDebug.verify = true; }
if (process.argv.includes('--exact-routing')) routeSummary.on = false;
const only = arg('only')?.split(',') ?? Object.keys(FIXTURES);
const results: Record<string, { hashes: string[]; events: Record<string, number> }> = {};
let ok = true;
for (const name of only) {
  const owned = run(name, FIXTURES[name]!, false), pure = run(name, FIXTURES[name]!, true);
  const same = owned.hashes.join() === pure.hashes.join();
  ok &&= same;
  console.log(JSON.stringify({ ...owned, pureSeconds: pure.seconds, pureMatchesOwned: same }));
  results[name] = { hashes: owned.hashes, events: owned.events };
}
const out = arg('out');
if (out) writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
const compare = arg('compare');
if (compare) {
  const ref = JSON.parse(readFileSync(compare, 'utf8')) as typeof results;
  for (const name of only) {
    const a = ref[name]?.hashes ?? [], b = results[name]!.hashes;
    const match = a.join() === b.join();
    ok &&= match;
    console.log(`${name}: ${match ? 'identical' : 'DIFFERENT'} over ${b.length} checkpoints${match ? '' : `\n  ref ${a.join(' ')}\n  now ${b.join(' ')}`}`);
  }
}
if (!ok) process.exitCode = 1;
