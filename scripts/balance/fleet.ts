/**
 * Fleet scaling (D25.10 check under D30): 1, 2, 4, 8 and 12 copies of a bot stage's Rack-era server, full
 * rounds from Return to round end, repeated. Per fleet: peak I, round length, tasks met, gross and net per
 * hour of play (round time plus a fixed between-round gap), and energy share.
 *
 *   npx tsx scripts/balance/fleet.ts --from=stage.json [--sizes=1,2,4,8,12] [--rounds=4] [--gap-s=15]
 */
import { advanceGameOwned, applyAction, type GameState } from '../../src/game';
import { grownFleet, loadStage, tryAct } from './fleetFixture';

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const stage = loadStage(arg('from', ''));
const rounds = Number(arg('rounds', '4')), gapS = Number(arg('gap-s', '15'));

console.log('| Systems | Peak I | Round length | Tasks met | Gross/h | Energy share | Net/h |');
console.log('|---:|---:|---:|---:|---:|---:|---:|');
for (const n of arg('sizes', '1,2,4,8,12').split(',').map(Number)) {
  let s: GameState = grownFleet(stage, n, { log: arg('log', '') === '1' });
  let peak = 0, len = 0, met = 0, gross = 0, energy = 0;
  for (let r = 0; r < rounds; r += 1) {
    s = tryAct(s, { type: 'returnToMarket' });
    const index = s.round.index;
    for (let i = 0; i < 4000 && s.round.phase === 'running' && s.round.index === index; i += 1) s = advanceGameOwned(s, 1_000).state;
    const rep = s.round.reports.at(-1)!;
    peak += rep.peakIntensity; len += rep.durationMs / 1000; met += rep.met;
    gross += Number(rep.gross); energy += Number(rep.energy);
    if (s.round.phase === 'running') { const out = applyAction(s, { type: 'endRound' }); if (out.ok) s = out.state; }
  }
  const hours = (len + rounds * gapS) / 3600;
  console.log(`| ${n} | ${(peak / rounds).toFixed(1)} | ${(len / rounds / 60).toFixed(1)} min | ${Math.round(met / rounds)} | ${(gross / hours).toExponential(2)} | ${(100 * energy / gross).toFixed(0)}% | ${((gross - energy) / hours).toExponential(2)} |`);
}
