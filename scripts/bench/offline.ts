import { Worker } from 'node:worker_threads';
import { FLEETS, type FleetName } from '../../src/game/testkit/fleets';
import { chunkSpan } from '../../src/platform/cadence';
import { gameOfflineEngine } from '../../src/platform/offline';
import { createOfflineRunner, type OfflineWorkerPort } from '../../src/platform/offlineRunner';
import { mergeReports } from '../../src/platform/reports';
import type { AdvanceReport } from '../../src/game';
import { BUDGETS, judge, type Budget, type Gate } from './budgets';
import type { CaseResult } from './report';
import { round3 } from './stats';

const TWO_HOURS_MS = 7_200_000, CHUNK_MS = 60_000, MIN_ACTIVE_TICKS = 70_000, CHECKPOINT_WALL_MS = 5_000;

function nodeWorker(): OfflineWorkerPort {
  const worker = new Worker(new URL('./offlineWorker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
  return {
    postMessage: message => worker.postMessage(message),
    listen(onMessage, onError) { worker.on('message', onMessage); worker.on('error', onError); },
    terminate: () => { void worker.terminate(); },
  };
}

/**
 * Architecture §7.3: post `fleetMax` to a worker_threads worker running the real offline
 * handler, 2 h in 60 s chunks exactly as the runtime requests them, timed from first post to
 * final result including structured clone both ways. Valid only with activeTicks ≥ 70,000.
 */
export async function benchOffline(gate: Gate, fleet: FleetName = 'fleetMax', spanMs = TWO_HOURS_MS, budget: Budget = BUDGETS.offline): Promise<CaseResult> {
  const source = FLEETS[fleet]();
  const runner = createOfflineRunner({ engine: gameOfflineEngine, createWorker: nodeWorker });
  let report: AdvanceReport | null = null, maxChunkMs = 0, checkpoints = 0, finalTick = 0;
  // Spawning the worker and loading tsx is not part of the budget; warm with a zero span.
  await runner.run({ state: FLEETS.boot(), elapsedMs: 0, returnState: false });
  const start = performance.now();
  try {
    // The runtime's protocol: state in once, chunks continue the worker session, the state comes
    // back at wall checkpoints and at the end.
    const chunks = chunkSpan(spanMs, CHUNK_MS);
    let lastCheckpoint = performance.now();
    for (let i = 0; i < chunks.length; i++) {
      const t = performance.now();
      const returnState = i === chunks.length - 1 || t - lastCheckpoint >= CHECKPOINT_WALL_MS;
      const result = await runner.run({ state: i === 0 ? source : undefined, elapsedMs: chunks[i], returnState });
      maxChunkMs = Math.max(maxChunkMs, performance.now() - t);
      report = mergeReports(report, result.report);
      if (result.state) { checkpoints++; finalTick = result.state.clock.tick; lastCheckpoint = performance.now(); }
    }
  } finally { runner.dispose(); }
  const seconds = (performance.now() - start) / 1000;
  const active = report?.activeTicks ?? 0, valid = runner.mode === 'worker' && active >= MIN_ACTIVE_TICKS;
  const note = `${fleet}, ${report?.ticks ?? 0} ticks, ${active} active${valid ? '' : runner.mode !== 'worker'
    ? ', INVALID: worker fell back to main thread' : `, INVALID: activeTicks < ${MIN_ACTIVE_TICKS}`}`;
  return judge(budget, gate, round3(seconds), valid, note, {
    fleet, spanMs, chunkMs: CHUNK_MS, ticks: report?.ticks ?? 0, activeTicks: active, mode: runner.mode,
    maxChunkMs: round3(maxChunkMs), checkpoints, finalTick, roundsEnded: report?.roundsEnded.length ?? 0, met: report?.met ?? 0,
  });
}

/** D24's approved ship gate keeps the 10 s target and tests the room/fleet fallback explicitly. */
export async function benchOfflineGate(gate: Gate): Promise<CaseResult> {
  const target = await benchOffline(gate);
  if (target.status === 'pass') return target;
  const room = await benchOffline(gate, 'roomFull');
  const valid = target.detail?.mode === 'worker' && Number(target.detail?.activeTicks) >= MIN_ACTIVE_TICKS
    && room.detail?.mode === 'worker' && Number(room.detail?.activeTicks) >= MIN_ACTIVE_TICKS
    && room.value !== null && room.value <= 10;
  return judge({ ...BUDGETS.offline, label: 'D24 offline fallback: room ≤10 s, fleet ≤60 s', limit: 60 }, gate,
    target.value ?? Infinity, valid, `10 s fleet target: ${target.value ?? '-'} s; room: ${room.value ?? '-'} s; ${target.note}; ${room.note}`,
    { target, room, fallback: 'D24' });
}
