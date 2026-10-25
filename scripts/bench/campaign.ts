import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUDGETS, judge, type Gate } from './budgets';
import type { CaseResult } from './report';
import { round3 } from './stats';

/**
 * S2's hook (architecture §6, §7.3), expected at src/game/probes/campaign.ts:
 *   export function runCampaign(options?: { ticks?: number }): { ticks: number; milestones?: unknown };
 * It plays from `boot` with the bot's normal cadence. The import is by path so this file
 * typechecks before S2 lands the module.
 */
interface CampaignModule { runCampaign(options?: { ticks?: number }): { ticks: number; milestones?: unknown } }
const CAMPAIGN_TICKS = 864_000;

export async function benchCampaign(gate: Gate, root: string): Promise<CaseResult> {
  const file = path.join(root, 'src/game/probes/campaign.ts');
  if (!existsSync(file)) {
    return { id: 'campaign', budget: BUDGETS.campaign.label, status: 'skip', value: null, limit: BUDGETS.campaign.limit,
      unit: 's', note: 'S2 campaign hook not landed (src/game/probes/campaign.ts)', detail: {} };
  }
  const module = await import(pathToFileURL(file).href) as Partial<CampaignModule>;
  if (typeof module.runCampaign !== 'function') throw new Error('probes/campaign.ts does not export runCampaign');
  const start = performance.now();
  const result = module.runCampaign({ ticks: CAMPAIGN_TICKS });
  const seconds = (performance.now() - start) / 1000;
  const valid = result.ticks >= CAMPAIGN_TICKS;
  return judge(BUDGETS.campaign, gate, round3(seconds), valid, `${result.ticks} ticks${valid ? '' : ', INVALID: short run'}`,
    { ticks: result.ticks, milestones: result.milestones ?? null });
}
