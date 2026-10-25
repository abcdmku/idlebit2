// npm run bench [-- --gate=G1|G2|G3|G4] [--only=boot,rackFull,fleetMax,fleetMaxLinks,offline,campaign,gpuPowered]
// Architecture §7: one Node process plus one worker_threads worker for the offline case.
// Writes artifacts/qa/perf/<stamp>/report.{json,md}. Exits 1 if a budget binding at
// --gate (default G4: all of them) fails. Later-gate budgets are reported as advisory.
import path from 'node:path';
import { BUDGETS, parseGate, type Gate } from './budgets';
import { benchCampaign } from './campaign';
import { describeEnvironment } from './environment';
import { benchBoot, benchFleet } from './frames';
import { benchOffline } from './offline';
import { benchPoweredGpu } from './gpu';
import { isPassing, toMarkdown, writeReport, type BenchReport, type CaseResult } from './report';

const root = path.resolve(import.meta.dirname, '../..');
const arg = (key: string) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const gate: Gate = parseGate(arg('gate'));
const only = arg('only')?.split(',') ?? null;

const CASES: readonly { id: string; run(): CaseResult | Promise<CaseResult> }[] = [
  { id: 'boot', run: () => benchBoot(gate) },
  { id: 'rackFull', run: () => benchFleet(gate, ['rackFull'], BUDGETS.rackFull, ['chip', 'system', 'rack']) },
  { id: 'fleetMax', run: () => benchFleet(gate, ['fleetMax', 'fleetMaxHot'], BUDGETS.fleetMax) },
  // Informational, never gating: fleetMax with top-tier links at I 42 (testkit/fleets MAX_LINK_FLEET), global scope.
  { id: 'fleetMaxLinks', run: () => informational(benchFleet(gate, ['fleetMaxLinks'], BUDGETS.fleetMax, ['global'])) },
  { id: 'offline', run: () => benchOffline(gate) },
  { id: 'campaign', run: () => benchCampaign(gate, root) },
  // Explicit --only=gpuPowered opts into the populated GPU workload after integration approval.
  { id: 'gpuPowered', run: () => benchPoweredGpu(gate, arg('max-wall-ms') === undefined ? 30_000 : Number(arg('max-wall-ms'))) },
];

/** Reports a case against a budget it does not gate. */
const informational = (result: CaseResult): CaseResult =>
  ({ ...result, id: 'fleetMaxLinks', budget: 'Top-link fleet frame p95 (informational)', status: 'advisory', note: [result.note, 'informational'].filter(Boolean).join('; ') });

function crashed(id: string, error: unknown): CaseResult {
  const message = error instanceof Error ? error.message : String(error);
  return { id, budget: id, status: 'fail', value: null, limit: null, unit: 'ms', note: `crashed: ${message}`,
    detail: { stack: error instanceof Error ? error.stack : null } };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const cases: CaseResult[] = [];
  for (const bench of CASES) {
    if (bench.id === 'gpuPowered' && !only?.includes(bench.id)) continue;
    if (only && !only.includes(bench.id)) continue;
    process.stdout.write(`bench ${bench.id} ... `);
    let result: CaseResult;
    try { result = await bench.run(); } catch (error) { result = crashed(bench.id, error); }
    cases.push(result);
    console.log(`${result.status} ${result.value ?? '-'} ${result.unit}`);
  }
  const report: BenchReport = { startedAt, environment: { ...describeEnvironment(root), gate, advance: process.argv.includes('--pure') ? 'pure' : 'owned' }, cases, passed: isPassing(cases) };
  const dir = writeReport(root, report);
  console.log(toMarkdown(report));
  console.log(`Report: ${path.relative(root, dir)}`);
  if (!report.passed) process.exitCode = 1;
}

await main();
