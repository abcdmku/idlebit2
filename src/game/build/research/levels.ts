import { amount } from '../../amount';
import { researchId } from '../../types/ids';
import type { ResearchDef, ResearchEffect } from '../../types/catalog';
import { secondsToTicks, TICK_MS } from '../../core/constants';

/** CPU/RAM CSV level effects; user 27 Oct replaces the price with 100k, then ×1.8. */
export const RESEARCH_LEVEL_MAX = 36;
export const idleFactorAt = (level: number): number => (74 - 2 * level) / 100;
export const bootSecondsAt = (level: number): number => (946 - 26 * level) / 100;
export type PurchaseSeries = 'cstate' | 'memoryVoltage' | 'bootLoader';

/** Whole-credit prices, rounded up after each exact 9/5 multiplication. */
export function researchLevelCost(level: number): string {
  let cost = 100_000n;
  for (let n = 1; n < level; n++) cost = (cost * 9n + 4n) / 5n;
  return cost.toString();
}

const NAMES: Readonly<Record<PurchaseSeries, string>> = { cstate: 'C-state', memoryVoltage: 'Memory voltage', bootLoader: 'Boot loader' };
export const LEVEL_RESEARCH: readonly ResearchDef[] = (['cstate', 'memoryVoltage', 'bootLoader'] as const).flatMap(series =>
  Array.from({ length: RESEARCH_LEVEL_MAX }, (_, i): ResearchDef => {
    const level = i + 1, factor = idleFactorAt(level), seconds = bootSecondsAt(level);
    const effects: readonly ResearchEffect[] = series === 'cstate'
      ? [{ kind: 'rule', id: 'coreIdle', params: { factor, level, afterS: 0, wakeS: 0 } }]
      : series === 'memoryVoltage' ? [{ kind: 'rule', id: 'ramWatts', params: { factor, level } }]
      : [{ kind: 'rule', id: 'bootSeconds', params: { seconds, level } }];
    const effect = series === 'cstate' ? `Idle CPU cores use ${Math.round(factor * 100)}% of their base idle power.`
      : series === 'memoryVoltage' ? `RAM uses ${Math.round(factor * 100)}% of its base power, with the same capacity and bandwidth.`
      : `Boots, reboots and cold hardware changes take ${secondsToTicks(seconds) * TICK_MS / 1000} s.`;
    return { id: researchId(`${series}${level}`), name: NAMES[series], category: series === 'memoryVoltage' ? 'memory' : series === 'cstate' ? 'power' : 'operations',
      requires: [researchId(level === 1 ? 'systemBoard' : `${series}${level - 1}`)], level: 'system', era: 'hz', tier: 1,
      data: 0, creditCost: amount(researchLevelCost(level)), work: 0, effects, effect, summary: effect,
      answers: [series === 'bootLoader' ? 'downtime' : 'energy'], implemented: true, purchase: { series, level, maxLevel: RESEARCH_LEVEL_MAX } };
  }));
