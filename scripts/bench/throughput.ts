// Ticks per second by era (program D21) (diagnostic only).
// npx tsx scripts/bench/throughput.ts [--wall=8] [--bot=0]
// 1. The campaign itself (bot included), stage by stage: boot → Rack, → 6 servers, → Room.
// 2. The sim alone on the owned path in 60 s chunks, on the bot's states at those points and on the
//    synthetic rackFull / roomFull fixtures (upper bounds: top hardware, always loaded).
import { advanceGameOwned, copyGameState, type GameState } from '../../src/game';
import { runCampaign, type CampaignResult } from '../../src/game/probes/campaign';
import { FLEETS } from '../../src/game/testkit/fleets';

const arg = (key: string) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
const WALL_S = Number(arg('wall') ?? 8), CHUNK_MS = 60_000, DAY = 864_000;
const done = (s: GameState, node: string) => s.research.completed.includes(node as never);
const servers = (s: GameState) => s.build.systems.filter((x) => x).length;
const hours = (ticks: number) => (ticks / 36_000).toFixed(2);

/** The sim alone: a copy advanced in 60 s chunks for up to WALL_S of wall time (or 2 h of game). */
function measure(name: string, start: GameState): void {
  let state = copyGameState(start), ticks = 0, active = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < WALL_S * 1000 && ticks < 72_000) {
    const { state: next, report } = advanceGameOwned(state, CHUNK_MS);
    state = next; ticks += report.ticks; active += report.activeTicks;
  }
  const s = (performance.now() - t0) / 1000;
  console.log(`sim ${name.padEnd(24)} ${String(servers(start)).padStart(4)} sys  ${String(Math.round(ticks / s)).padStart(9)} ticks/s`
    + `  ${active ? (s * 1e6 / active).toFixed(1).padStart(7) : '      -'} µs/active tick  active ${Math.round(100 * active / ticks)}%`);
}

const eras: [string, GameState][] = [];
if (arg('bot') !== '0') {
  let last: CampaignResult | null = null;
  const stage = (name: string, until: (s: GameState) => boolean): CampaignResult | null => {
    const from = last;
    const t0 = performance.now();
    const r = runCampaign({ ...(from ? { from: { state: from.state, carry: from.carry } } : {}), ticks: DAY, until });
    const s = (performance.now() - t0) / 1000, ticks = r.ticks - r.startTick;
    console.log(`bot ${name.padEnd(24)} ${String(servers(r.state)).padStart(4)} sys  ${String(Math.round(ticks / s)).padStart(9)} ticks/s`
      + `  game ${hours(r.startTick)} → ${hours(r.ticks)} h in ${s.toFixed(1)} s${until(r.state) ? '' : '  (not reached in 24 h)'}`);
    last = r;
    return until(r.state) ? r : null;
  };
  const early = stage('boot → +10 min', (s) => s.clock.tick >= 6_000);
  if (early) eras.push(['bot boot +10 min', early.state]);
  const rack = stage('→ Rack research', (s) => done(s, 'rack'));
  const mid = rack && stage('→ 6 servers', (s) => servers(s) >= 6);
  if (mid) eras.push(['bot mid-Rack (6+ servers)', mid.state]);
  const room = mid && stage('→ Room research', (s) => done(s, 'room'));
  if (room) eras.push(['bot Room', room.state]);
}
eras.push(['rackFull (synthetic)', FLEETS.rackFull()], ['roomFull (synthetic)', FLEETS.roomFull()]);
for (const [name, state] of eras) measure(name, state);
