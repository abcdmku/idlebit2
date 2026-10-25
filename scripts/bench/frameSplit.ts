// Splits the bench frame into advance, snapshot and tray quote, per scope (diagnostic only).
// npx tsx scripts/bench/frameSplit.ts [rackFull|fleetMax|fleetMaxHot] [frames]
import { copyGameState, deriveRenderSnapshot, quote, type RenderSnapshot } from '../../src/game';
import { FLEETS, type FleetName } from '../../src/game/testkit/fleets';
import { benchAdvance, SCOPES } from './frames';

const name = (process.argv[2] ?? 'rackFull') as FleetName, frames = Number(process.argv[3] ?? 300);
const start = FLEETS[name]();
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
for (const [scopeName, scope] of Object.entries(SCOPES)) {
  let state = copyGameState(start), prev: RenderSnapshot | undefined;
  const adv: number[] = [], snap: number[] = [], q: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    const t0 = performance.now(); state = benchAdvance(state, 50).state;
    const t1 = performance.now(); prev = deriveRenderSnapshot(state, scope, prev);
    const t2 = performance.now(); quote(state, { kind: 'tray', at: scope.focus });
    const t3 = performance.now();
    if (i >= 20) { adv.push(t1 - t0); snap.push(t2 - t1); q.push(t3 - t2); }
  }
  const f = (xs: number[]) => `${mean(xs).toFixed(3)}/${p95(xs).toFixed(3)}`;
  console.log(`${name}:${scopeName.padEnd(10)} advance ${f(adv)}  snapshot ${f(snap)}  quote ${f(q)}  (mean/p95 ms)`);
}
