/**
 * Balance campaign runner (architecture §6, S2; program D19, D21). Plays the bot from a fresh game,
 * or continues a saved stage, and writes artifacts/qa/balance/<stamp>/{report.json,report.md}.
 *
 *   npx tsx scripts/balance/run.ts [--hours=24] [--policy=active|idle|passive] [--seed=42]
 *     [--from=stage.json] [--out=stage.json] [--no-fail]
 *
 * --from continues a stage file and --out writes one: the exact save (serializeSave) plus the bot's
 * small carry. Chained stages replay exactly what one long run would (campaign.test.ts proves it).
 * Exits 1 when any program §14 pacing target fails, unless --no-fail.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deserializeSave, serializeSave } from '../../src/game';
import { runCampaign, type CampaignCarry, type CampaignResult } from '../../src/game/probes/campaign';
import { pacingMarkdown, pacingReport } from '../../src/game/probes/pacing';
import type { PolicyId } from '../../src/game/probes/policies';

const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

/** A stage file: the game, the bot's carry, and what the stage did. */
export interface StageFile {
  readonly save: string;
  readonly carry: CampaignCarry;
  readonly seed: number;
  readonly policy: PolicyId;
  readonly review?: { readonly choices: readonly number[]; readonly rounds: readonly { startS: number; lengthS: number }[]; readonly saveReloaded: true };
  readonly stage: { readonly startTick: number; readonly endTick: number; readonly wallS: number; readonly rounds: number; readonly decisions: number; readonly speedup: number };
}

/** D21: game time ÷ wall time at each milestone reached in this stage, and over the stage. */
export function speedMarkdown(result: CampaignResult): string {
  const rows = (Object.entries(result.wallMs) as [string, number][]).map(([key, ms]) => {
    const atS = key === 'end' ? result.ticks / 10 : result.milestones[key as keyof CampaignResult['milestones']]!;
    const simS = atS - result.startTick / 10;
    return `| ${key} | ${(atS / 3600).toFixed(2)} h | ${(ms / 1000).toFixed(1)} s | ${Math.round(simS / Math.max(ms / 1000, 1e-3))}× |`;
  });
  return ['| Reached | Game time | Stage wall | Stage speedup (D21) |', '|---|---:|---:|---:|', ...rows].join('\n') + '\n';
}

if (process.argv[1]?.endsWith('run.ts')) {
  const hours = Number(arg('hours', '24'));
  const fromFile = arg('from', '');
  const from = fromFile ? (JSON.parse(readFileSync(fromFile, 'utf8')) as StageFile) : null;
  const policy = (from?.policy ?? arg('policy', 'active')) as PolicyId;
  const seed = from?.seed ?? Number(arg('seed', '42'));
  let start = undefined as { state: CampaignResult['state']; carry: CampaignCarry } | undefined;
  if (from) {
    const loaded = deserializeSave(from.save);
    if (!loaded.ok) throw new Error(`--from ${fromFile}: ${loaded.error}`);
    start = { state: loaded.state, carry: from.carry };
  }
  const startTick = start?.state.clock.tick ?? 0;

  const t0 = performance.now();
  const result = runCampaign({ ticks: startTick + Math.round(hours * 36_000), policy, seed, from: start, clock: () => performance.now() });
  const saved = serializeSave(result.state);
  const reload = deserializeSave(saved);
  if (!reload.ok) throw new Error(`Campaign save cannot reload: ${reload.error}`);
  const wallS = (performance.now() - t0) / 1000;
  const rows = pacingReport(result);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join('artifacts', 'qa', 'balance', stamp);
  mkdirSync(dir, { recursive: true });
  const md = `${pacingMarkdown(result, rows)}\nWall time: ${wallS.toFixed(1)} s for ticks ${result.startTick}–${result.ticks}, ${result.decisions} decisions.\n\n${speedMarkdown(result)}`;
  writeFileSync(path.join(dir, 'report.md'), md);
  const { state: _state, ...json } = result;
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ wallS, pacing: rows, ...json }, null, 1));
  const out = arg('out', '');
  if (out) {
    const stage: StageFile = {
      save: saved, carry: result.carry, seed, policy,
      review: { choices: result.events.filter(e => e.kind === 'buy' || e.kind === 'research').map(e => e.tick / 10),
        rounds: result.rounds.map(({ startS, lengthS }) => ({ startS, lengthS })), saveReloaded: true },
      stage: { startTick: result.startTick, endTick: result.ticks, wallS, rounds: result.rounds.length, decisions: result.decisions,
        speedup: (result.ticks - result.startTick) / 10 / wallS },
    };
    writeFileSync(out, JSON.stringify(stage));
  }

  if (!process.argv.includes('--quiet')) {
    console.log(md.split('\n').slice(0, rows.length + 8).join('\n'));
    console.log(speedMarkdown(result));
  }
  console.log(`Wall ${wallS.toFixed(1)} s. Report: ${dir}`);
  if (!process.argv.includes('--no-fail') && rows.some((r) => !r.pass)) process.exitCode = 1;
}
