import { describe, expect, it } from 'vitest';
import { REGION_IDS } from '../../../game';
import { silkWidth } from '../../core';
import { CELLS, REGION_SIGNS } from './layout';
import { CLIMATE_SIGNS } from './world';
import { GEN_BOX, genText } from './power';
import { CASES } from './fixtures';

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

describe('D31 site generation', () => {
  it('reads used of output as three glyphs in the corner, clear of the sign', () => {
    const g = { kind: 'solar', level: 1, outputW: 50_000, usedW: 30_000, marginalPrice: 0 } as const;
    expect(genText(g)).toBe('60%');
    expect(genText({ ...g, usedW: 50_000 })).toBe('MAX');
    expect(genText({ ...g, usedW: 0 })).toBe('0%');
    for (let i = 0; i < CELLS.length; i++) {
      const sign = Math.max(silkWidth(REGION_SIGNS[REGION_IDS[i]!]) + 6, silkWidth(CLIMATE_SIGNS[i]!)) + 5;
      // the sign plate ends (exclusive) at or before the corner box's ink backing starts
      expect(CELLS[i]!.x + 1 + sign + 2).toBeLessThanOrEqual(CELLS[i]!.x + CELLS[i]!.w + GEN_BOX.dx - 1);
    }
    const w = CASES.power!(0);
    expect(w.start?.awake).toBe(2);
    expect(w.sites.filter(s => s.generation).length).toBe(4);
  });
});
