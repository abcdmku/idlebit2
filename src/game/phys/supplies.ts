import { SUPPLY_BAND, SUPPLY_MULT_HIGH } from './constants';

/* ---------- Supply math (spec §9.2) ---------- */

/** Loss multiplier by usage (D4.3): ×1 up to 90%, ×1.5 above. */
export const supplyMultiplier = (usage: number): number => (usage <= SUPPLY_BAND ? 1 : SUPPLY_MULT_HIGH);

/** Usage of a supply. A supply without a compiled capacity is unlimited (usage 0). */
export const supplyUsage = (deliveredW: number, capacityW: number): number => (capacityW > 0 ? deliveredW / capacityW : 0);

/** Waste watts: real power, billed, and heat in the lump that holds the supply. */
export const supplyLossW = (deliveredW: number, capacityW: number, lossFraction: number): number =>
  deliveredW * lossFraction * supplyMultiplier(supplyUsage(deliveredW, capacityW));
