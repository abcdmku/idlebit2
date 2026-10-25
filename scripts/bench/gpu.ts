import { deriveRenderSnapshot } from '../../src/game';
import { benchAdvance } from './frames';
import { ACCEL_CLOCKS, DT_S, MAX_ACCELS } from '../../src/game/core/constants';
import { MODE } from '../../src/game/core/timers';
import { gpuLoadedState } from '../../src/game/testkit/gpuLoaded';
import { G } from '../../src/game/core/buffers';
import { slaPercent } from '../../src/game/core/sla';
import type { GameState } from '../../src/game/types/state';
import { BUDGETS, judge, type Gate } from './budgets';
import { summarize } from './stats';

/** These scans run outside the measured frame. Retain actual activity, not just fleet size. */
export function gpuActivity(state: GameState) {
  const h = state.hot.sys, c = state.compiled.sys;
  let poweredSystems = 0, runningSystems = 0, runningTasks = 0, gpuStageTasks = 0, busyCards = 0, taskDuty = 0;
  let maxPsuUsage = 0, maxRackPduUsage = 0, maxRackTempF = 0;
  let maxUpsUsage = 0, maxGridUsage = 0, maxRoomTempF = 0, queuedTasks = 0;
  for (let sys = 0; sys < c.len; sys++) {
    if (h.drawW[sys]! > 0) poweredSystems++;
    if (h.running[sys]! > 0) runningSystems++;
    runningTasks += h.running[sys]!;
    queuedTasks += h.queueLen[sys]!;
    maxPsuUsage = Math.max(maxPsuUsage, h.psuUsage[sys]!);
    for (let clock = 0; clock < ACCEL_CLOCKS; clock++) gpuStageTasks += h.accelActive[sys * ACCEL_CLOCKS + clock]!;
    for (let slot = 0; slot < MAX_ACCELS; slot++) {
      const seconds = h.accelTaskS[sys * MAX_ACCELS + slot]!;
      if (seconds > 0) busyCards++;
      taskDuty += seconds / DT_S;
    }
  }
  for (let r = 0; r < state.hot.rack.len; r++) {
    maxRackPduUsage = Math.max(maxRackPduUsage, state.hot.rack.pduUsage[r]!);
    maxRackTempF = Math.max(maxRackTempF, state.hot.rack.tempF[r]!);
  }
  for (const usage of state.hot.room.upsUsage) maxUpsUsage = Math.max(maxUpsUsage, usage);
  for (const usage of state.hot.site.gridUsage) maxGridUsage = Math.max(maxGridUsage, usage);
  for (const temp of state.hot.room.tempF) maxRoomTempF = Math.max(maxRoomTempF, temp);
  return { systems: c.len, poweredSystems, runningSystems, runningTasks, gpuStageTasks, busyCards, taskDuty,
    onMarketSystems: h.mode.subarray(0, c.len).filter((mode) => mode === MODE.onMarket).length,
    queuedTasks, met: state.hot.g[G.met]!, failed: state.hot.g[G.failed]!,
    slaPercent: slaPercent(state.hot.g[G.met]!, state.hot.g[G.failed]!),
    maxPsuUsage, maxRackPduUsage, maxUpsUsage, maxGridUsage, maxRackTempF, maxRoomTempF,
    round: state.round.phase, tick: state.clock.tick };
}

/** Opt-in only until the parent approves integration. No module-level fleet build or execution. */
export function benchPoweredGpu(gate: Gate, maxWallMs = 30_000) {
  if (!Number.isFinite(maxWallMs) || maxWallMs <= 0) throw new RangeError('max-wall-ms must be positive');
  const started = performance.now();
  let state = gpuLoadedState(true);
  const buildMs = performance.now() - started, beforeWarm = gpuActivity(state);
  const activity: ReturnType<typeof gpuActivity>[] = [];
  let failed = 0, activeTicks = 0, roundsEnded = 0, frames = 0;
  let snapshot: ReturnType<typeof deriveRenderSnapshot> | undefined;
  // Prime task allocation and physical draw before timing; include this report in validity.
  const warm = benchAdvance(state, 100); state = warm.state;
  failed += Object.values(warm.report.failedByCause).reduce((n, count) => n + count, 0);
  activeTicks += warm.report.activeTicks; roundsEnded += warm.report.roundsEnded.length;
  activity.push(gpuActivity(state));
  const samples: number[] = [];
  for (let iteration = 0; iteration < 1_260; iteration++) {
    if (performance.now() - started >= maxWallMs) break;
    const before = performance.now();
    const step = benchAdvance(state, 50); state = step.state;
    failed += Object.values(step.report.failedByCause).reduce((n, count) => n + count, 0);
    activeTicks += step.report.activeTicks; roundsEnded += step.report.roundsEnded.length;
    snapshot = deriveRenderSnapshot(state, { focus: { level: 'global', id: 0 }, partner: null }, snapshot);
    frames++;
    const elapsed = performance.now() - before;
    if (iteration >= 60) samples.push(elapsed);
    if (iteration === 59 || iteration % 120 === 119) activity.push(gpuActivity(state));
  }
  // A timed-out run remains invalid even if its partial samples look fast.
  const stats = samples.length ? summarize(samples) : null;
  activity.push(gpuActivity(state));
  const wallMs = performance.now() - started;
  const valid = frames === 1_260 && wallMs <= maxWallMs && failed === 0 && roundsEnded === 0 && activeTicks === 631 && activity.every((a) => a.round === 'running'
    && a.poweredSystems === a.systems && a.runningSystems === a.systems
    && a.gpuStageTasks === a.systems * MAX_ACCELS && a.busyCards === a.systems * MAX_ACCELS
    && Math.abs(a.taskDuty - a.busyCards) < 1e-6
    && a.maxPsuUsage < 1 && a.maxRackPduUsage < 1 && a.maxUpsUsage < 1 && a.maxGridUsage < 1
    && a.maxRackTempF < 100 && a.maxRoomTempF < 100);
  return judge({ ...BUDGETS.fleetMax, id: 'gpuPowered', label: 'Powered GPU fleet frame p95' }, gate,
    stats?.p95 ?? maxWallMs, valid, `synthetic actual-card load; ${frames}/1260 frames, ${failed} failures, ${roundsEnded} ended rounds`,
    { stats, frames, activeTicks, failed, roundsEnded, buildMs, wallMs, maxWallMs, beforeWarm, activity,
      evidence: 'Synthetic pre-admitted GPU work, not earned campaign progress; 63.1 simulated seconds, no two-hour claim' });
}
