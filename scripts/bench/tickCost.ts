// Per-tick wall time distribution and the slowest ticks by phase (diagnostic only).
// npx tsx scripts/bench/tickCost.ts [rackFull|fleetMax|fleetMaxHot|...] [ticks]
import { PHASES } from '../../src/game/core/tick';
import { newTouchLog } from '../../src/game/core/touch';
import { commitWorld, openWorld } from '../../src/game/core/world';
import { FLEETS, type FleetName } from '../../src/game/testkit/fleets';

const name = (process.argv[2] ?? 'rackFull') as FleetName, ticks = Number(process.argv[3] ?? 600);
const state = FLEETS[name]();
const w = openWorld(state, true);
w.touch = newTouchLog();
const rows: { tick: number; ms: number; phases: Record<string, number> }[] = [];
for (let i = 0; i < ticks; i += 1) {
  const phases: Record<string, number> = {};
  w.late = false;
  if (w.round.phase === 'running') w.report.activeTicks += 1;
  const t0 = performance.now();
  for (const [phase, run] of PHASES) { const p0 = performance.now(); run(w); phases[phase] = performance.now() - p0; }
  rows.push({ tick: w.tick, ms: performance.now() - t0, phases });
  w.tick += 1;
}
commitWorld(state, w, 0);
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const at = (q: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))]!.toFixed(3);
console.log(`${name}: ${ticks} ticks, p50 ${at(0.5)} p90 ${at(0.9)} p95 ${at(0.95)} p99 ${at(0.99)} max ${at(1)} ms`);
for (const r of [...rows].sort((a, b) => b.ms - a.ms).slice(0, 8)) {
  const top = Object.entries(r.phases).filter(([, v]) => v > 0.02).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ');
  console.log(`  tick ${r.tick} ${r.ms.toFixed(3)} ms: ${top}`);
}
