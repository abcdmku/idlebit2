import { expect, it } from 'vitest';
import { bitRate, bitsText, hertz, wattsText } from './format';

it('formats label values the way L2 prints them, across every era', () => {
  expect([hertz(1024), hertz(1000), hertz(2000), hertz(8.2e12), hertz(5.4e17)]).toEqual(['1,024 Hz', '1 kHz', '2 kHz', '8.2 THz', '540 PHz']);
  expect([bitsText(1), bitsText(64), bitsText(8192), bitsText(2 ** 33), bitsText(2 ** 63)]).toEqual(['1 bit', '64 bits', '1 KiB', '1 GiB', '1 EiB']);
  expect([wattsText(64), wattsText(1200), wattsText(1.6384e18)]).toEqual(['64 W', '1.2 kW', '1.6 EW']);
  expect([bitRate(4), bitRate(2000)]).toEqual(['4 b/s', '2 kb/s']);
});
