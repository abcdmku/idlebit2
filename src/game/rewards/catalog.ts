import type { RoundRewardDefinition } from '../types/roundRewards';

/** Counts follow the report's existing six-per-decade ladder, beginning at 50. */
export const ROUND_REWARDS: readonly RoundRewardDefinition[] = [
  { milestone: 50, name: 'Prepared queue', summary: 'Prepare 2 tasks', icon: 'hashBatch', effect: 'Prepare two queued tasks instead of one. Cache and idle cores still limit preparation.', limit: '2 prepared targets', research: 'parallelLoaders' },
  { milestone: 75, name: 'Data dividend I', summary: '+10% task Data', icon: 'parity', effect: 'Earn 10% more Data from completed market tasks.', limit: '10% total; milestone grants are excluded', research: null },
  { milestone: 100, name: 'Research tray I', summary: '+1 research queue slot', icon: 'compare', effect: 'Queue one additional project to start after the active research finishes.', limit: '+1 waiting slot; normal research upgrades still apply', research: null },
  { milestone: 150, name: 'Resident workspace', summary: 'Research: reusable workspace', icon: 'intSort', effect: 'Opens research to retain a recipe’s reusable fixed workspace across intervening tasks.', limit: '1 fixed workspace in real cache; private inputs stay separate', research: 'residentWorkspace' },
  { milestone: 200, name: 'Energy contract I', summary: '−5% energy cost', icon: 'sqlScan', effect: 'Pay 5% fewer Credits for energy. Watts, heat and supply limits stay the same.', limit: '5% total energy Credit discount', research: null },
  { milestone: 300, name: 'Preparation bank', summary: 'Prepare 4 tasks', icon: 'jsonParse', effect: 'Prepare up to four queued tasks using installed queue space and cache.', limit: '4 prepared targets maximum', research: null },
  { milestone: 500, name: 'Parallel loading II', summary: 'Research: 4 cache loaders', icon: 'hashBatch', effect: 'Opens research for up to four simultaneous cache loaders.', limit: 'Each loader needs a separate idle physical core', research: 'parallelLoaderController' },
  { milestone: 750, name: 'Research tray II', summary: '+2 research queue slots', icon: 'compare', effect: 'Add a second extra project to the waiting research queue.', limit: '+2 waiting slots in total; one active project', research: null },
  { milestone: 1000, name: 'R&D Data grant I', summary: '−10% research Data', icon: 'intSort', effect: 'Newly funded research projects cost 10% less Data.', limit: '10% total; paid projects receive no refund', research: null },
  { milestone: 1500, name: 'Data dividend II', summary: '+20% task Data', icon: 'parity', effect: 'Raise the market Data dividend to 20% in total.', limit: '20% maximum; bonuses do not compound', research: null },
  { milestone: 2000, name: 'Energy contract II', summary: '−10% energy cost', icon: 'sqlScan', effect: 'Raise the energy Credit discount to 10% in total.', limit: 'Physical power and cooling requirements still apply', research: null },
  { milestone: 3000, name: 'Research funding', summary: '−10% research Credits', icon: 'apiFanout', effect: 'Newly funded research projects cost 10% fewer Credits.', limit: 'Hardware and immediate level purchases keep their normal prices', research: null },
  { milestone: 5000, name: 'Energy contract III', summary: '−15% energy cost', icon: 'sqlScan', effect: 'Raise the energy Credit discount to its final 15%.', limit: '15% maximum; electricity still costs Credits', research: null },
  { milestone: 7500, name: 'R&D Data grant II', summary: '−20% research Data', icon: 'intSort', effect: 'Raise the research Data discount to its final 20%.', limit: 'Positive costs stay at least 1; full processing work remains', research: null },
];

export function roundRewardDefinition(milestone: number): RoundRewardDefinition {
  return ROUND_REWARDS.find(row => row.milestone === milestone) ?? {
    milestone, name: 'Workload grant', summary: 'Credits + Data', icon: 'hashBatch',
    effect: 'Match the base task Credits and Data earned since the previous milestone.',
    limit: 'One grant per save; permanent modifiers remain capped', research: null,
  };
}
