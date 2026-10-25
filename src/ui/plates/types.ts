import type { GameAction, QuoteResult, ResearchId } from '../../game';
import type { PlatePosition } from './PlateFrame';

/** What every plate gets from the plate layer. Plates never compute prices: they read quotes. */
export interface PlateCommon extends PlatePosition {
  /** Quotes for this plate's request, or null while none are held. */
  quotes: QuoteResult | null;
  onAction: (action: GameAction) => void;
  onClose: () => void;
  /** Opens the research wafer on a node (a locked key or choice). */
  onResearch?: (id: ResearchId) => void;
  /** Display name of a research node, for "Needs …" copy. */
  researchName?: (id: ResearchId) => string;
  /** The current boot time in seconds (10 s base). */
  bootS?: number;
}
