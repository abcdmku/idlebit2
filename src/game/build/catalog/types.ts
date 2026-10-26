import type { CoolTech, Curve, PartId, PartScope } from '../../types/catalog';
import type { ResearchId } from '../../types/ids';

/** Catalog row shapes, spec Appendix A.5 (post-D5). Domain-private to build/. */
export type WattsRule =
  /** Rate parts (§9.1): draw follows the rated rate; pushing past native costs push^0.3 more per unit. */
  | { readonly kind: 'rate'; readonly wPerUnit: number }
  /**
   * CPU cores and RAM (hardware-progression.md §3): energy ratio E = nativeRatio / push^a, a = −ln(decay) / ln 1.5,
   * per energy era; full-use W = rate / (0.010 × E), idle at most 10% of it. `era[g]` maps a generation to its era.
   */
  | { readonly kind: 'ratio'; readonly era: readonly number[]; readonly decay?: readonly number[] }
  /** Non-rate parts: idle[g] × x^0.25, no load. */
  | { readonly kind: 'idle'; readonly idle: readonly number[] }
  | { readonly kind: 'cooler'; readonly wpw: readonly number[] }
  | { readonly kind: 'supply'; readonly loss: readonly number[]; readonly lossPerLevel: number };

export interface CatalogRow {
  readonly id: PartId; readonly scope: PartScope; readonly names: readonly string[]; readonly gates: readonly ResearchId[];
  readonly curve: Curve; readonly levelMax?: number;
  /** Primary capacity per generation at L1; base2 the secondary (RAM bandwidth, VRAM, IO, scheduler Q). */
  readonly base: readonly number[]; readonly base2?: readonly number[];
  /** Primary capacity factor per level (index L − 1) instead of the curve's (RAM, hardware-progression.md §4). */
  readonly capacityTable?: readonly number[];
  readonly watts: WattsRule;
  /** Whole Credits per generation. */
  readonly price: readonly number[]; readonly upgrade: readonly number[];
  /** Clock: upgrades cost × cores on the socket (an oscillator retunes every core it drives, D34). */
  readonly upgradeDrive?: 'cores';
  readonly tech?: readonly CoolTech[]; readonly tau?: readonly number[];
  readonly tensorFactor?: readonly number[];
}

export interface LadderDef {
  readonly id: 'switch' | 'roomSwitch' | 'dataPlane' | 'backbone'; readonly scope: PartScope;
  readonly names: readonly string[]; readonly gates: readonly ResearchId[];
  readonly baseK: readonly number[]; readonly topK: readonly number[]; readonly latency: readonly number[];
  readonly minPorts: number; readonly portCeiling?: 'rackPorts' | 'roomPorts';
  /** W per bit/s of a 1 kHz link at full use; faster links scale by linkWatts (D18.5). */
  readonly wPerUnit: number;
  readonly price: readonly number[];
  /** Native clock streams carried by one port; uplinks default to the same count. */
  readonly streams: number; readonly uplinkStreams?: number;
  readonly portAdd?: readonly number[]; readonly portAddGrowth?: number;
}
