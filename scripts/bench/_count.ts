import { PHASES } from '../../src/game/core/tick';
import { newTouchLog } from '../../src/game/core/touch';
import { openWorld } from '../../src/game/core/world';
import { FLEETS, type FleetName } from '../../src/game/testkit/fleets';
const c: Record<string, number> = new Proxy({}, { get: (t: any, k) => t[k] ?? 0, set: (t: any, k, v) => { t[k] = v; return true; } });
(globalThis as any).__c = c;
const name = (process.argv[2] ?? 'fleetMax') as FleetName, ticks = Number(process.argv[3] ?? 1000), every = Number(process.argv[4] ?? 500);
const w = openWorld(FLEETS[name](), true); w.touch = newTouchLog();
let last: Record<string, number> = {}; let t0 = performance.now();
for (let i = 1; i <= ticks; i += 1) {
  if (w.round.phase === 'running') w.report.activeTicks += 1;
  for (const [, run] of PHASES) run(w);
  w.tick += 1;
  if (i % every === 0) {
    const snap = { ...(c as any) }; const d: Record<string, string> = {};
    for (const k of Object.keys(snap)) d[k] = ((snap[k] - (last[k] ?? 0)) / every).toFixed(2);
    console.log(`tick ${w.tick} ${w.round.phase} I=${w.market.intensity.toFixed(1)} ${((performance.now()-t0)/every).toFixed(2)}ms/t`, JSON.stringify(d));
    last = snap; t0 = performance.now();
  }
}
