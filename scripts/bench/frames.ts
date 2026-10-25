import {
  advanceGame, advanceGameOwned, copyGameState, deriveRenderSnapshot, quote, rackId, roomId, systemId,
  type GameState, type RenderSnapshot, type SnapshotScope,
} from '../../src/game';
import { FLEETS, type FleetName } from '../../src/game/testkit/fleets';
import { BUDGETS, judge, type Budget, type Gate } from './budgets';
import type { CaseResult } from './report';
import { round3, sampleLoop, type SampleStats } from './stats';

const chip: SnapshotScope = { focus: { level: 'chip', id: systemId(0) }, partner: null };
export const SCOPES: Readonly<Record<string, SnapshotScope>> = {
  chip,
  system: { focus: { level: 'system', id: systemId(0) }, partner: null },
  rack: { focus: { level: 'rack', id: rackId(0) }, partner: null },
  room: { focus: { level: 'room', id: roomId(0) }, partner: null },
  global: { focus: { level: 'global', id: 0 }, partner: null },
  'room>rack': { focus: { level: 'rack', id: rackId(0) }, partner: { level: 'room', id: roomId(0) } },
};

/** The platform's path (decisions D9): owned advances; `--pure` measures the pure reference instead. */
export const benchAdvance = process.argv.includes('--pure') ? advanceGame : advanceGameOwned;

/** One chained frame: advance 50 ms, rebuild the snapshot from the previous one. Owns a copy of `start`. */
function frameLoop(start: GameState, scope: SnapshotScope, withQuote: boolean) {
  let state = copyGameState(start), previous: RenderSnapshot | undefined, affordable = 0;
  return () => {
    state = benchAdvance(state, 50).state;
    previous = deriveRenderSnapshot(state, scope, previous);
    if (withQuote) for (const q of quote(state, { kind: 'tray', at: scope.focus }).quotes) if (q.affordable) affordable++;
  };
}

const stats = (s: SampleStats) => ({ count: s.count, p50: round3(s.p50), p95: round3(s.p95), max: round3(s.max), mean: round3(s.mean) });

/** Architecture §7.3 boot frame: 200 warm-up then 2,000 chained iterations on `boot`. */
export function benchBoot(gate: Gate): CaseResult {
  const result = sampleLoop(2_000, 200, frameLoop(FLEETS.boot(), chip, false));
  return judge(BUDGETS.boot, gate, result.p95, true, `p50 ${round3(result.p50)}, max ${round3(result.max)}`, stats(result));
}

/** Each scope, 1,200 chained iterations (60 s of sim) of advance + snapshot + tray quote. */
export function benchFleet(gate: Gate, fleets: readonly FleetName[], budget: Budget, scopes = Object.keys(SCOPES)): CaseResult {
  const detail: Record<string, unknown> = {}, buildMs: Record<string, number> = {};
  let worst = 0, worstAt = '', errors: string[] = [];
  for (const fleet of fleets) {
    const t0 = performance.now();
    const state = FLEETS[fleet]();
    buildMs[fleet] = round3(performance.now() - t0);
    for (const name of scopes) {
      try {
        const result = sampleLoop(1_200, 60, frameLoop(state, SCOPES[name], true));
        detail[`${fleet}:${name}`] = stats(result);
        if (result.p95 > worst) { worst = result.p95; worstAt = `${fleet}:${name}`; }
      } catch (error) {
        errors.push(`${fleet}:${name} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const note = [`worst ${worstAt || '-'}`, ...errors.map(e => `error ${e}`)].join('; ');
  return judge(budget, gate, worst, errors.length === 0, note, { ...detail, buildMs, errors });
}
