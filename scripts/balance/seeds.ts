/**
 * D21 parallel seeds: plays the campaign for several seeds at once in worker_threads and prints
 * each seed's milestones, wall time and speedup, then min / median / max.
 *
 *   npx tsx scripts/balance/seeds.ts [--seeds=6] [--hours=24] [--policy=active] [--workers=N]
 */
import { availableParallelism } from 'node:os';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { runCampaign, type Milestones } from '../../src/game/probes/campaign';
import type { PolicyId } from '../../src/game/probes/policies';

interface Job { readonly seed: number; readonly hours: number; readonly policy: PolicyId }
interface Done { readonly seed: number; readonly milestones: Milestones; readonly wallS: number; readonly simS: number; readonly firstRound: { lengthS: number; top: string } | null }

if (!isMainThread) {
  const job = workerData as Job;
  const t0 = performance.now();
  const r = runCampaign({ seed: job.seed, ticks: Math.round(job.hours * 36_000), policy: job.policy });
  const r1 = r.rounds[0];
  const done: Done = { seed: job.seed, milestones: r.milestones, wallS: (performance.now() - t0) / 1000, simS: r.ticks / 10,
    firstRound: r1 ? { lengthS: r1.lengthS, top: `${r1.topCause ?? '-'}${r1.topDetail ? ` · ${r1.topDetail}` : ''}` } : null };
  parentPort!.postMessage(done);
} else {
  const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
  const n = Number(arg('seeds', '6')), hours = Number(arg('hours', '24')), policy = arg('policy', 'active') as PolicyId;
  const workers = Math.max(1, Math.min(n, Number(arg('workers', String(Math.max(1, availableParallelism() - 1))))));
  const jobs: Job[] = Array.from({ length: n }, (_, i) => ({ seed: 42 + 1000 * i, hours, policy }));
  const hms = (s: number | null | undefined) => (s == null ? '-' : `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
  const results: Done[] = [];
  const t0 = performance.now();
  const runOne = (job: Job) => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url), { workerData: job, execArgv: ['--import', 'tsx'] });
    w.once('message', (d: Done) => { results.push(d); resolve(); });
    w.once('error', reject);
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: workers }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await runOne(j); }));
  results.sort((a, b) => a.seed - b.seed);
  console.log(`| Seed | Round 1 | Round 1 top cause | First purchase | System | Rack | Room | Wall | Speedup |`);
  console.log('|---:|---|---|---|---|---|---|---:|---:|');
  for (const d of results) {
    const m = d.milestones;
    console.log(`| ${d.seed} | ${hms(d.firstRound?.lengthS)} | ${d.firstRound?.top ?? '-'} | ${hms(m.firstPurchaseS)} | ${hms(m.systemS)} | ${hms(m.rackS)} | ${hms(m.roomS)} | ${d.wallS.toFixed(1)} s | ${Math.round(d.simS / d.wallS)}× |`);
  }
  const spread = (key: keyof Milestones) => {
    const v = results.map((d) => d.milestones[key]).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return v.length ? `${hms(v[0])} / ${hms(v[Math.floor(v.length / 2)])} / ${hms(v.at(-1))}` : 'not reached';
  };
  console.log(`\nmin / median / max: System ${spread('systemS')}; Rack ${spread('rackS')}; Room ${spread('roomS')}`);
  console.log(`${results.length} seeds on ${workers} workers in ${((performance.now() - t0) / 1000).toFixed(1)} s wall.`);
}
