/**
 * Round-start check (D30, warm-up rule): from Return to market, Credits earned against energy billed per
 * 10 s over the first 2 minutes of a round. A large fleet must not go net-negative while it climbs
 * through the round's small opening tasks.
 *
 *   npx tsx scripts/balance/roundstart.ts [--fleet=roomFull|rackFull] [--from=stage.json]
 */
import { readFileSync } from 'node:fs';
import { advanceGameOwned, applyAction, copyGameState, deserializeSave, type GameState } from '../../src/game';
import { FLEETS } from '../../src/game/testkit/fleets';

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

function load(): { label: string; state: GameState } {
  const from = arg('from', '');
  if (from) {
    const l = deserializeSave((JSON.parse(readFileSync(from, 'utf8')) as { save: string }).save);
    if (!l.ok) throw new Error(l.error);
    return { label: from, state: l.state };
  }
  const fleet = arg('fleet', 'roomFull') as keyof typeof FLEETS;
  return { label: fleet, state: FLEETS[fleet]() };
}

const { label, state } = load();
let s = copyGameState(state);
// End the running round (or wait for it), then Return: the next round opens at I = 0.
for (let i = 0; i < 2000 && s.round.phase === 'running'; i += 1) s = advanceGameOwned(s, 1_000).state;
s = { ...s, wallet: { ...s.wallet, credits: '1000000000000000000000000000' as never } };
const back = applyAction(s, { type: 'returnToMarket' });
if (!back.ok) throw new Error('return');
s = back.state;
const systems = s.build.systems.filter((x) => x !== null).length;
console.log(`${label}: ${systems} systems, round ${s.round.index} from I = 0`);
console.log('| Window | Gross | Energy | Net | I at end | Tasks taken |');
console.log('|---|---:|---:|---:|---:|---:|');
let gross = Number(s.ledger.gross), energy = Number(s.ledger.energy);
for (let k = 1; k <= 12; k += 1) {
  s = advanceGameOwned(s, 10_000).state;
  const g = Number(s.ledger.gross) - gross, e = Number(s.ledger.energy) - energy;
  gross = Number(s.ledger.gross); energy = Number(s.ledger.energy);
  console.log(`| ${(k - 1) * 10}–${k * 10} s | ${g.toExponential(2)} | ${e.toExponential(2)} | ${(g - e).toExponential(2)} | ${s.market.intensity.toFixed(1)} | ${s.hot.g[33]} |`);
  if (s.round.phase !== 'running') { console.log(`round ended at ${k * 10} s`); break; }
}
