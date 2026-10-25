import { describe, expect, it } from 'vitest';
import { REGION_IDS } from '../../../game';
import { silkWidth } from '../../core';
import { CELLS, REGION_SIGNS } from './layout';
import { CLIMATE_SIGNS } from './world';

describe('region signs (A28)', () => {
  it('spells the energy multiplier as a cost after the outside air', () => {
    expect(CLIMATE_SIGNS[0]).toMatch(/^\d+°F · cost ×\d\.\d$/);
  });
  it('fits every sign plate inside its region cell', () => {
    for (let i = 0; i < CELLS.length; i++) {
      const w = Math.max(silkWidth(REGION_SIGNS[REGION_IDS[i]!]) + 6, silkWidth(CLIMATE_SIGNS[i]!)) + 5;
      expect(1 + w + 2).toBeLessThanOrEqual(CELLS[i]!.w);
    }
  });
});
