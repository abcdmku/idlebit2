import { describe, expect, it } from 'vitest';
import type { Amount } from '../../game';
import { clock, hertz, perMinuteText, quantity, sig3, span, watts, wholeText } from './format';

const A = (s: string) => s as Amount;

describe('wholeText: Credits and Data are whole numbers (D2.2, D3.3)', () => {
  it('groups below 10,000 and goes compact above, never with a fraction', () => {
    expect(wholeText(A('40'))).toBe('40');
    expect(wholeText(A('2400'))).toBe('2,400');
    expect(wholeText(A('9960'))).toBe('9,960');
    expect(wholeText(A('12345'))).toBe('12.3k');
    expect(wholeText(A('30200'))).toBe('30.2k');
    expect(wholeText(A('1240000'))).toBe('1.24M');
    expect(wholeText(A('108000000'))).toBe('108M');
    expect(wholeText(A('6000000000000000'))).toBe('6Q');
  });
  it('keeps the zeros of a round coefficient (100k is not 1k)', () => {
    expect(wholeText(100_000)).toBe('100k');
    expect(wholeText(200_000_000)).toBe('200M');
    expect(wholeText(10_000)).toBe('10k');
    expect(wholeText(1_500_000)).toBe('1.5M');
  });
  it('carries a rounded band edge into the next band', () => {
    expect(wholeText(999_960)).toBe('1M');
  });
  it('rounds fractional input up, as prices do, and signs negatives with a minus', () => {
    expect(wholeText(0.2)).toBe('1');
    expect(wholeText(39.01)).toBe('40');
    expect(wholeText(A('-12'))).toBe('−12');
    expect(wholeText(-45_600)).toBe('−45.6k');
    for (const n of [0.5, 12.7, 999.2, 12_345.6, 1.5e7 + 0.3]) expect(wholeText(n)).not.toMatch(/\.\d*[^\dkMBTQ]|^\d+\.\d+$/);
  });
  it('whole Credits per minute', () => {
    expect(perMinuteText(-9960, false)).toBe('−9,960/min');
    expect(perMinuteText(12_300)).toBe('+12.3k/min');
    expect(perMinuteText(0)).toBe('0/min');
    expect(perMinuteText(-0.7)).toBe('0/min');
  });
});

describe('measurements: at most 3 significant figures', () => {
  it('sig3 and units', () => {
    expect(sig3(30)).toBe('30 ');
    expect(sig3(1e15)).toBe('1.00 P');
    expect(sig3(42_700_000_000_000)).toBe('42.7 T');
    expect(watts(234.051)).toBe('234 W');
    expect(watts(4096)).toBe('4.1 kW');
    expect(hertz(1000)).toBe('1 kHz');
    expect(hertz(50_000)).toBe('50 kHz');
    expect(hertz(2.5e6)).toBe('2.5 MHz');
    expect(quantity(26.713, 'W')).toBe('26.7 W');
  });
  it('durations', () => {
    expect(clock(523)).toBe('8:43');
    expect(clock(3725)).toBe('1:02:05');
    expect(span(250)).toBe('4m 10s');
    expect(span(7500)).toBe('2h 5m');
    expect(span(3 * 86400 + 4 * 3600)).toBe('3d 4h');
  });
});
