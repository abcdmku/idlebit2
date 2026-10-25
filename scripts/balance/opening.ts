/**
 * Opening proof (program D20, §14): round 1 under the passive bot (no purchases, no research) and
 * the active bot, across seeds. Prints the end time and the top fail causes of round 1.
 *
 *   npx tsx scripts/balance/opening.ts [--seeds=8] [--minutes=12]
 */
import { runCampaign } from '../../src/game/probes/campaign';
import type { PolicyId } from '../../src/game/probes/policies';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const seeds = Array.from({ length: Number(arg('seeds', '8')) }, (_, i) => 42 + 1000 * i);
const ticks = Math.round(Number(arg('minutes', '12')) * 600);
const ms = (s: number | null) => (s === null ? 'not reached' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

for (const policy of ['passive', 'active'] as PolicyId[]) {
  const ends: number[] = [];
  console.log(`\n${policy}`);
  for (const seed of seeds) {
    const r = runCampaign({ ticks, seed, policy });
    const r1 = r.rounds[0];
    if (r1) ends.push(r1.lengthS);
    console.log(`seed ${seed}: round 1 ${ms(r1?.lengthS ?? null)}, met ${r1?.met ?? '-'}, failed ${r1?.failed ?? '-'}, top ${r1?.topCause ?? '-'}${r1?.topDetail ? ` · ${r1.topDetail}` : ''}, peak I ${r1?.peakIntensity.toFixed(1) ?? '-'}, first purchase ${ms(r.milestones.firstPurchaseS)}`);
  }
  const sorted = [...ends].sort((a, b) => a - b);
  if (sorted.length) console.log(`round 1 min / median / max: ${ms(sorted[0]!)} / ${ms(sorted[Math.floor(sorted.length / 2)]!)} / ${ms(sorted.at(-1)!)}`);
}
