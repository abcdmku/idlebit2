/** The four decimal digits are generation, series and two-digit tier. */
export type GpuGeneration = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type GpuSeries = 3 | 5 | 7 | 9;
export type GpuTier = 30 | 50 | 60 | 70 | 80 | 90;
export type GpuModelId = `${GpuGeneration}${GpuSeries}${GpuTier}`;

export interface GpuBuild {
  readonly kind: 'gpu';
  readonly model: GpuModelId;
  readonly upgrades: number;
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
  readonly upgrades: number;
  readonly cores: number;
  readonly vramBits: number;
  readonly clockHz: number;
  readonly opsPerS: number;
  readonly tensorOpsPerS: number;
  readonly idleW: number;
  readonly loadW: number;
  readonly efficiencyOpsPerJ: number;
  readonly maxUpgrades: number;
}
/** Native model specifications, evaluated with zero hot upgrades. */
export type GpuModelDefinition = GpuStats;
