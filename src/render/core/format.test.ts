import { expect, it } from 'vitest';
import { wattsText, whole } from './format';

it('formats the label values the renderer still owns; sizes, speeds and ops use the shared formatters', () => {
  expect([wattsText(64), wattsText(1200), wattsText(1.6384e18)]).toEqual(['64 W', '1.2 kW', '1.6 EW']);
  expect(whole(1024.9)).toBe('1,024');
});
