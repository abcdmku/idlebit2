/**
 * D21 stage chain: proves long horizons with the real sim in pieces. Each stage is its own process
 * (run.ts --from --out), stays under the wall budget, and continues the previous stage's exact save.
 * Stage length adapts to the measured speed so each stage lands near the budget.
 *
 *   npx tsx scripts/balance/chain.ts [--until=roomS] [--max-days=7] [--seed=42] [--budget-s=150]
 *
 * Writes artifacts/qa/balance/chain-<stamp>/{stage-N.json,chain.md}.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Milestones } from '../../src/game/probes/campaign';
import type { StageFile } from './run';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const until = arg('until', 'roomS') as keyof Milestones;
const maxTicks = Number(arg('max-days', '7')) * 864_000;
const budgetS = Number(arg('budget-s', '150'));
const seed = arg('seed', '42');

const dir = path.join('artifacts', 'qa', 'balance', `chain-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(dir, { recursive: true });
const hms = (s: number | null) => (s === null ? '-' : `${Math.floor(s / 86400)}d ${Math.floor(s / 3600) % 24}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`);

const rows: string[] = ['| Stage | Game span | Wall | Speedup | Reached in stage |', '|---:|---|---:|---:|---|'];
let prev: string | null = null, hours = 24, last: StageFile | null = null, n = 0;
const choices: number[] = [], rounds: { startS: number; lengthS: number }[] = [];
for (;;) {
  n += 1;
  const out = path.join(dir, `stage-${n}.json`);
  const args = ['--import', 'tsx', 'scripts/balance/run.ts', `--hours=${hours.toFixed(2)}`, `--out=${out}`, '--no-fail', '--quiet', `--seed=${seed}`];
  if (prev) args.push(`--from=${prev}`);
  execFileSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  const stage = JSON.parse(readFileSync(out, 'utf8')) as StageFile;
  choices.push(...(stage.review?.choices ?? [])); rounds.push(...(stage.review?.rounds ?? []));
  const before = last?.carry.milestones;
  const reached = (Object.entries(stage.carry.milestones) as [keyof Milestones, number | null][])
    .filter(([k, v]) => v !== null && (!before || before[k] === null)).map(([k, v]) => `${k} ${hms(v)}`);
  const s = stage.stage;
  rows.push(`| ${n} | ${hms(s.startTick / 10)} → ${hms(s.endTick / 10)} | ${s.wallS.toFixed(1)} s | ${Math.round(s.speedup)}× | ${reached.join(', ') || '-'} |`);
  console.log(rows.at(-1));
  last = stage; prev = out;
  if (stage.carry.milestones[until] !== null || s.endTick >= maxTicks) break;
  // Aim the next stage at the wall budget from this stage's speed, within 1 h to 2 weeks of game time.
  hours = Math.min(336, Math.max(1, (s.speedup * budgetS * 0.6) / 3600), (maxTicks - s.endTick) / 36_000);
}

const m = last!.carry.milestones;
const phases = [['0–1 h', 0, 3600], ['1–8 h', 3600, 28800], ['8–24 h', 28800, 86400], ['After 24 h', 86400, Infinity]] as const;
const pacing = phases.flatMap(([name, from, until]) => {
  const end = Math.min(last!.stage.endTick / 10, until);
  if (end <= from) return [];
  let at: number = from, gap = 0;
  for (const choice of choices) if (choice >= from && choice < end) { gap = Math.max(gap, choice - at); at = choice; }
  gap = Math.max(gap, end - at);
  const inEra = rounds.filter(r => r.startS >= from && r.startS < end);
  const mean = inEra.length ? (inEra.reduce((sum, r) => sum + r.lengthS, 0) / inEra.length / 60).toFixed(1) : '-';
  return [`| ${name} | ${mean} min | ${(gap / 60).toFixed(1)} min | ${inEra.length} |`];
});
const md = [`# Stage chain, seed ${seed}, until ${until}`, '', ...rows, '',
  '| Milestone | Reached |', '|---|---|', ...(Object.entries(m) as [string, number | null][]).map(([k, v]) => `| ${k} | ${hms(v)} |`), '',
  'Every stage save was serialized and reloaded before continuing.', '',
  '| Era | Mean round length | Largest choice gap | Rounds |', '|---|---:|---:|---:|', ...pacing, ''].join('\n');
writeFileSync(path.join(dir, 'chain.md'), md);
console.log(`\n${md}\nChain: ${dir}`);
