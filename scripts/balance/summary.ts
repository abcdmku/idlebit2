/**
 * Summarizes campaign reports (run.ts report.json files, in order) for the balance pass: round length
 * by era, income and energy against fleet size, late rate and disk spill, and the longest choice gaps.
 *
 *   npx tsx scripts/balance/summary.ts artifacts/qa/balance/<a>/report.json [<b>/report.json ...]
 */
import { readFileSync } from 'node:fs';
import type { BotEvent } from '../../src/game/probes/bot';
import type { Milestones, RoundSummary } from '../../src/game/probes/campaign';

interface Report { readonly rounds: RoundSummary[]; readonly events: BotEvent[]; readonly milestones: Milestones; readonly ticks: number; readonly startTick: number }
const reports = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')) as Report);
const rounds = reports.flatMap((r) => r.rounds);
const events = reports.flatMap((r) => r.events);
const m = reports.at(-1)!.milestones;
const endS = reports.at(-1)!.ticks / 10;
const hms = (s: number | null) => (s === null ? '-' : `${Math.floor(s / 86400) ? `${Math.floor(s / 86400)}d ` : ''}${Math.floor(s / 3600) % 24}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`);
const e = (x: number) => x.toExponential(2);

console.log('| Milestone | Time |\n|---|---|');
for (const [k, v] of Object.entries(m)) console.log(`| ${k} | ${hms(v)} |`);

const eras: [string, number, number][] = [
  ['Round 1', 0, 1], ['to System', 1, m.systemS ?? Infinity], ['System → Rack', m.systemS ?? Infinity, m.rackS ?? Infinity],
  ['Rack → Room', m.rackS ?? Infinity, m.roomS ?? Infinity], ['Room on', m.roomS ?? Infinity, Infinity],
];
console.log('\n| Era | Rounds | Mean length | Min / max | Peak I | Gross/h | Energy share | Late/round | Disk work |\n|---|---:|---:|---|---:|---:|---:|---:|---:|');
for (const [name, from, to] of eras) {
  const rs = rounds.filter((r) => (name === 'Round 1' ? r.index === 1 : r.index > 1 && r.startS >= from && r.startS < to));
  if (!rs.length) continue;
  const len = rs.map((r) => r.lengthS), span = rs.reduce((a, r) => a + r.lengthS, 0) / 3600;
  const gross = rs.reduce((a, r) => a + Number(r.gross), 0), energy = rs.reduce((a, r) => a + Number(r.energy), 0);
  const delivered = rs.reduce((a, r) => a + (r.diskShare ?? 0) * Number(r.gross), 0);
  console.log(`| ${name} | ${rs.length} | ${(len.reduce((a, b) => a + b, 0) / rs.length / 60).toFixed(1)} min | ${(Math.min(...len) / 60).toFixed(1)} / ${(Math.max(...len) / 60).toFixed(1)} | ${Math.max(...rs.map((r) => r.peakIntensity)).toFixed(1)} | ${e(gross / span)} | ${(100 * energy / gross).toFixed(0)}% | ${(rs.reduce((a, r) => a + (r.late ?? 0), 0) / rs.length).toFixed(1)} | ${(100 * delivered / gross).toFixed(0)}% |`);
}

console.log('\n| Systems | Racks | Rounds | Gross/h | Net/h | Energy share | Peak I | Mean length |\n|---:|---:|---:|---:|---:|---:|---:|---:|');
const bySize = new Map<string, RoundSummary[]>();
for (const r of rounds) if (r.racks > 0) { const k = `${r.systems}|${r.racks}`; bySize.set(k, [...(bySize.get(k) ?? []), r]); }
for (const [k, rs] of [...bySize].sort((a, b) => a[1][0]!.startS - b[1][0]!.startS)) {
  const [sys, racks] = k.split('|');
  const span = rs.reduce((a, r) => a + r.lengthS, 0) / 3600;
  const gross = rs.reduce((a, r) => a + Number(r.gross), 0), energy = rs.reduce((a, r) => a + Number(r.energy), 0);
  console.log(`| ${sys} | ${racks} | ${rs.length} | ${e(gross / span)} | ${e((gross - energy) / span)} | ${(100 * energy / gross).toFixed(0)}% | ${Math.max(...rs.map((r) => r.peakIntensity)).toFixed(1)} | ${(rs.reduce((a, r) => a + r.lengthS, 0) / rs.length / 60).toFixed(1)} min |`);
}

const times = events.filter((x) => x.kind !== 'return').map((x) => x.tick / 10).sort((a, b) => a - b);
const gaps: [number, number][] = [];
let last = reports[0]!.startTick / 10;
for (const t of [...times, endS]) { gaps.push([last, t - last]); last = t; }
console.log('\nLongest choice gaps (start, length):', gaps.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, g]) => `${hms(s)} +${(g / 60).toFixed(0)}m`).join(', '));
const tops = new Map<string, number>();
for (const r of rounds.filter((x) => x.startS >= (m.rackS ?? Infinity))) { const k = `${r.topCause}·${r.topDetail}`; tops.set(k, (tops.get(k) ?? 0) + 1); }
console.log('Post-Rack round ends:', [...tops].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
