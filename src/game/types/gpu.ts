/** The four decimal digits are generation, series and two-digit tier. */
export type GpuGeneration = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type GpuSeries = 3 | 5 | 7 | 9;
export type GpuTier = 30 | 50 | 60 | 70 | 80 | 90;
export type GpuModelId = `${GpuGeneration}${GpuSeries}${GpuTier}`;

/** A card's upgrade state is its model: generation (researched), type (series, chosen at install) and tier. */
export interface GpuBuild {
  readonly kind: 'gpu';
  readonly model: GpuModelId;
}
export interface NpuBuild {
  readonly kind: 'npu';
  readonly gen: number;
  readonly level: number;
}
export type AccelBuild = GpuBuild | NpuBuild;

export interface GpuTechnology {
  readonly vramMultiplier: number;
  readonly hbmIdleFactor: number;
  readonly tensorFactor: number;
}
export interface GpuStats {
  readonly model: GpuModelId;
  readonly generation: GpuGeneration;
  readonly series: GpuSeries;
  readonly tier: GpuTier;
  /** 0 for tier 30 … 5 for tier 90. */
  readonly tierIndex: number;
  readonly maxTierIndex: number;
  readonly cores: number;
  readonly vramBits: number;
  readonly clockHz: number;
  readonly opsPerS: number;
  readonly tensorOpsPerS: number;
  readonly idleW: number;
  readonly loadW: number;
  readonly efficiencyOpsPerJ: number;
}
/** Model specifications before installed memory and tensor technology. */
export type GpuModelDefinition = GpuStats;
