// What a part plate says it unblocks (QA-21): a small leaf module, so its test loads nothing else.

/** What each board part supplies, as the blocks it clears (QA-21). */
const PART_BLOCKS: Readonly<Partial<Record<string, readonly string[]>>> = {
  l1: ['cache'], l2: ['cache'], l3: ['cache'], ram: ['ram'], drive: ['disk'], gpu: ['gpu', 'vram', 'gpuCores'],
};
/** Tasks in the visible line waiting on what `part` supplies. */
export function blockedOn(window: readonly { readonly blockedBy: string | null }[], part: string | undefined): number {
  const clears = part ? PART_BLOCKS[part] : undefined;
  return clears ? window.filter(t => t.blockedBy !== null && clears.includes(t.blockedBy)).length : 0;
}
