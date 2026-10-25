// fleetMax at another opening intensity (architecture §7.2 intends I = 34; the fixture uses 40 while
// gang placement was a fleet scan). Frame p95 per scope as in the bench, and sim µs per tick.
// npx tsx scripts/bench/intensity.ts [--i=34] [--frames=1200] [--ticks=6000]
import { advanceGameOwned, copyGameState, deriveRenderSnapshot, quote, type GameState, type RenderSnapshot } from '../../src/game';
import { TICK_MS } from '../../src/game/core/constants';
import { primeMarket } from '../../src/game/market/prime';
import { buildState } from '../../src/game/testkit/builders';
import { FLEET_WARMUP_TICKS, MAX_FLEET } from '../../src/game/testkit/fleets';
import { provisionInfrastructure } from '../../src/game/testkit/infrastructure';
import { SCOPES } from './frames';
import { round3, sampleLoop } from './stats';

const arg = (key: string) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const I = Number(arg('i') ?? 34), frames = Number(arg('frames') ?? 1200), ticks = Number(arg('ticks') ?? 6000);

const t0 = performance.now();
const warm = advanceGameOwned(primeMarket(provisionInfrastructure(buildState(MAX_FLEET)), I), FLEET_WARMUP_TICKS * TICK_MS).state;
console.log(`fleetMax I=${I}: built and warmed in ${((performance.now() - t0) / 1000).toFixed(1)} s, round ${warm.round.phase}`);

let worst = 0;
for (const [name, scope] of Object.entries(SCOPES)) {
  let state: GameState = copyGameState(warm), prev: RenderSnapshot | undefined;
  const r = sampleLoop(frames, 60, () => {
    state = advanceGameOwned(state, 50).state;
    prev = deriveRenderSnapshot(state, scope, prev);
    quote(state, { kind: 'tray', at: scope.focus });
  });
  worst = Math.max(worst, r.p95);
  console.log(`  frame ${name.padEnd(10)} p50 ${round3(r.p50)} p95 ${round3(r.p95)} max ${round3(r.max)} ms`);
}
console.log(`  worst frame p95 ${round3(worst)} ms`);

let state = copyGameState(warm), active = 0, done = 0;
const s0 = performance.now();
while (done < ticks) { const { state: next, report } = advanceGameOwned(state, 60_000); state = next; done += report.ticks; active += report.activeTicks; }
const us = (performance.now() - s0) * 1000 / done;
console.log(`  sim ${done} ticks: ${us.toFixed(1)} µs/tick (main thread), active ${Math.round(100 * active / done)}%, round ${state.round.phase}`);
