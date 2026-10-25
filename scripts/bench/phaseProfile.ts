// Per-phase wall time on a fixture (diagnostic only).
// npx tsx scripts/bench/phaseProfile.ts [gpuPowered|fleetMax|fleetMaxHot] [ticks] [--worker]
// Mirrors advanceGameOwned in the offline engine's 60 s chunks (one owned World per chunk,
// committed between), including the quiescent skip, so `ticks` = 72000 profiles the 2 h offline
// round. --worker runs the loop in a worker_threads worker that receives the fixture by message,
// as the offline bench does: building the fixture in the same isolate skews JIT feedback and
// roughly doubles the measured tick cost.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { advanceGame, type GameState } from '../../src/game';
import { isQuiescent, nextWakeTick } from '../../src/game/core/advance';
import { PHASES } from '../../src/game/core/tick';
import { newTouchLog } from '../../src/game/core/touch';
import { commitWorld, openWorld } from '../../src/game/core/world';
import { FLEETS, type FleetName } from '../../src/game/testkit/fleets';
import { gpuLoadedState } from '../../src/game/testkit/gpuLoaded';

const CHUNK_TICKS = 600;

function profile(start: GameState, ticks: number): Record<string, unknown> {
  const open = (st: GameState) => { const world = openWorld(st, true); world.touch = newTouchLog(); return world; };
  let state = start, w = open(state);
  const total = new Map<string, number>();
  const target = w.tick + ticks, warm = w.tick + 20;
  let ran = 0, skipped = 0;
  const t0 = performance.now();
  while (w.tick < target) {
    if (w.tick > start.clock.tick && (w.tick - start.clock.tick) % CHUNK_TICKS === 0 && ran > 0) {
      state = commitWorld(state, w, 0); w = open(state);
    }
    if (isQuiescent(w)) {
      const wake = nextWakeTick(w);
      if (wake > w.tick) { const to = Math.min(target, wake); skipped += to - w.tick; w.tick = to; continue; }
    }
    const measured = w.tick >= warm;
    if (w.round.phase === 'running') w.report.activeTicks += 1;
    for (const [phase, run] of PHASES) {
      const p0 = performance.now(); run(w);
      if (measured) total.set(phase, (total.get(phase) ?? 0) + performance.now() - p0);
    }
    if (measured) ran += 1;
    w.tick += 1;
  }
  return {
    msPerTick: Object.fromEntries([...total].map(([k, v]) => [k, +(v / ran).toFixed(3)])),
    sum: +([...total.values()].reduce((a, b) => a + b, 0) / ran).toFixed(3), ran, skipped, round: w.round.phase,
    wallS: +((performance.now() - t0) / 1000).toFixed(2),
  };
}

if (isMainThread) {
  const name = process.argv[2] ?? 'gpuPowered', ticks = Number(process.argv[3] ?? 200);
  const start = name === 'gpuPowered' ? advanceGame(gpuLoadedState(true), 100).state : FLEETS[name as FleetName]();
  if (process.argv.includes('--worker')) {
    // --cpu-prof flags given to node reach the worker, so it can be profiled where it runs.
    const prof = process.execArgv.filter((a) => a.startsWith('--cpu-prof'));
    const worker = new Worker(new URL(import.meta.url), { execArgv: ['--import', 'tsx', ...prof], workerData: { start, ticks } });
    worker.on('message', (result) => { console.log(name, 'worker', result); void worker.terminate(); });
  } else console.log(name, 'main', profile(start, ticks));
} else {
  const { start, ticks } = workerData as { start: GameState; ticks: number };
  parentPort!.postMessage(profile(start, ticks));
}
