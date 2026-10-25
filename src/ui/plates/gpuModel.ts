import { researchId, type Amount, type GpuGeneration, type GpuSeries, type GpuTier, type ResearchNodeView } from '../../game';

export const GPU_GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const GPU_SERIES = [3, 5, 7, 9] as const;
export const GPU_TIERS = [30, 50, 60, 70, 80, 90] as const;
export const GPU_CLASSES = ['1 kHz', '10 kHz', '100 kHz', '1 MHz', '10 MHz', '100 MHz', '1 GHz', '10 GHz', '100 GHz'] as const;
export const SERIES_NAMES: Readonly<Record<GpuSeries, string>> = { 3: 'Cores', 5: 'VRAM', 7: 'Clock', 9: 'All' };
export const SERIES_COPY: Readonly<Record<GpuSeries, string>> = {
  3: 'More cores for parallel work and core requirements.',
  5: 'More VRAM for larger working sets.',
  7: 'Faster clock. Fewer cores than 3-series.',
  9: 'Best speed and efficiency at the same tier.',
};
export interface GpuSelection { generation: GpuGeneration; series: GpuSeries; tier: GpuTier }

export const gpuResearchId = (generation: GpuGeneration) => researchId(`gpuGen${generation}`);
export function gpuResearch(nodes: readonly ResearchNodeView[], generation: GpuGeneration) {
  return nodes.find(n => n.id === gpuResearchId(generation));
}

/** Exact whole amounts. GPU prices remain readable digit for digit, including above 2^53. */
export function exactAmount(value: Amount): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function lacksAmount(balance: Amount | undefined, cost: Amount | undefined): boolean {
  if (balance === undefined || cost === undefined) return false;
  // Canonical Amount strings may contain a fractional balance. Compare scaled integers exactly.
  const [a = '0', af = ''] = balance.split('.'), [b = '0', bf = ''] = cost.split('.');
  const digits = Math.max(af.length, bf.length);
  return BigInt(a + af.padEnd(digits, '0')) < BigInt(b + bf.padEnd(digits, '0'));
}
