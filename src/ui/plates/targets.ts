import type { HitTarget } from '../../render/core';

/** The rack's Power control slot (D31.3): its target ID, or its part once PartSlot names it. */
export const POWER_CTL_TARGET = 'powerCtl';
export const isPowerCtl = (t: Pick<HitTarget, 'id' | 'part'>) => t.id === POWER_CTL_TARGET || (t.part?.slot.kind as string | undefined) === 'powerCtl';
