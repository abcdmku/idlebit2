import type { ResearchDef } from '../../types/catalog';

type DeferredHardwareNodeId = 'ddr' | 'rdimm';
type RuntimeResearchOverride = Readonly<Pick<ResearchDef, 'effect'> & Partial<Pick<ResearchDef, 'effects'>>>;

/**
 * tree.data.ts and tree.text.ts describe the accepted reference design. CPU/RAM integration
 * is deferred during the GPU wave, so these two nodes retain the deployed behavior and copy.
 * Only effects and their description may differ; costs and prerequisites always use the source.
 *
 * Remove DDR's override when the 36-level RAM capacity/bandwidth and energy curves land.
 * Remove RDIMM's override only when registeredCapacity is typed and consumed by ECC capacity,
 * the old level bonus is removed, and purchase/config/save checks support the common L36 cap.
 * See docs/hardware-progression.md for the complete pending integration and validation.
 */
export const DEFERRED_HARDWARE_RESEARCH: Readonly<Record<DeferredHardwareNodeId, RuntimeResearchOverride>> = {
  ddr: {
    effect: "RAM gen 1: twice SDRAM's capacity and bandwidth at the same level; load watts scale with bandwidth.",
  },
  rdimm: {
    effects: [{ kind: 'ceiling', key: 'ramLevelBonus', value: 4 }],
    effect: 'ECC modules can be upgraded 4 levels further within each RAM generation.',
  },
};

export const deferredHardwareResearch = (id: string): RuntimeResearchOverride | undefined =>
  id === 'ddr' || id === 'rdimm' ? DEFERRED_HARDWARE_RESEARCH[id] : undefined;
