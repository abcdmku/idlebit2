/**
 * Balance debug probe: loads a stage file and prints what the bot sees at that state: the fleet,
 * the credit reserve, and every buyable quote with its score.
 *
 *   npx tsx scripts/balance/inspect.ts --from=stage.json [--all]
 */
import { readFileSync } from 'node:fs';
import { deserializeSave, quote } from '../../src/game';
import { amountToNumber } from '../../src/game/amount';
import { buyable, candidateRequests, score } from '../../src/game/probes/bot';
import type { StageFile } from './run';

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const stage = JSON.parse(readFileSync(arg('from', ''), 'utf8')) as StageFile;
const loaded = deserializeSave(stage.save);
if (!loaded.ok) throw new Error(loaded.error);
const s = loaded.state;
console.log(`tick ${s.clock.tick} (${(s.clock.tick / 36000).toFixed(2)} h), credits ${Number(s.wallet.credits).toExponential(3)}, data ${Number(s.wallet.data).toExponential(3)}, phase ${s.round.phase}`);
console.log(`systems ${s.build.systems.filter(Boolean).length}, racks ${s.build.racks.filter(Boolean).length}, rooms ${s.build.rooms.filter(Boolean).length}, research done ${s.research.completed.length}`);
const quotes = candidateRequests(s).flatMap((r) => quote(s, r).quotes);
const list = process.argv.includes('--all') ? quotes : buyable(s, quotes);
for (const q of list) {
  const v = q.currency === 'credits' && q.locked === null ? score(s, q) : null;
  console.log(`${q.label.padEnd(40)} ${q.currency} ${amountToNumber(q.cost).toExponential(2)} aff=${q.affordable} lock=${q.locked ?? '-'} score=${v === null ? '-' : v.toFixed(1)} ${q.action.type}`);
}
