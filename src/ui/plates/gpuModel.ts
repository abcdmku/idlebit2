import { researchId, type GpuGeneration, type GpuSeries, type ResearchNodeView } from '../../game';

export const GPU_GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const SERIES_NAMES: Readonly<Record<GpuSeries, string>> = { 3: 'Cores', 5: 'VRAM', 7: 'Clock', 9: 'All' };

export const gpuResearchId = (generation: GpuGeneration) => researchId(`gpuGen${generation}`);
export function gpuResearch(nodes: readonly ResearchNodeView[], generation: GpuGeneration) {
  return nodes.find(n => n.id === gpuResearchId(generation));
}
