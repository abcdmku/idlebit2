import { amount } from './amount';
import { formatAmount, formatCountdownMs, formatCredits, formatData, formatDurationMs,
  formatMetric, formatNet, formatPrice, formatRate, formatSeconds, formatSignedAmount, formatWatts, formatSize, formatHertz, formatOps, formatEnergy } from './format';

// Approved core/format.js fmt/fmtTime and the Phase 0D wallet/part-plate examples.
describe('shared mockup currency formatting',()=>{
  it.each([
    ['0','0'],['0.99','0.99'],['2','2'],['3.5','3.5'],['99.999','100'],['100.99','100'],
    ['-0.99','−0.99'],['-0.001','0'],['490114','490,114'],['380000','380,000'],['999999','999,999'],
    ['1000000','1.00M'],['389500000','389.5M'],['37810000','37.81M'],
    ['1460000000','1.46B'],['18490000000000','18.49T'],['18700000000000','18.70T'],
  ])('formats %s Credits as %s',(input,expected)=>{
    expect(formatCredits(amount(input))).toBe(expected);
    expect(formatAmount(input)).toBe(expected);
  });
  it('keeps small Data to three decimals and larger balances as full integers',()=>{
    expect(formatData('38.012')).toBe('38.012');
    expect(formatData('0.0009765625')).toBe('0.001');
    expect(formatData('38.0129')).toBe('38.013');
    expect(formatData('38.010')).toBe('38.01');
    expect(formatData('100.125')).toBe('100');
    expect(formatData('380000')).toBe('380,000');
    expect(formatData('37810000')).toBe('37.81M');
  });
  it('preserves exact decimal prices on tags/buttons and shares the Credit bands',()=>{
    expect(formatPrice('538.2')).toBe('538.2');
    expect(formatPrice('3300')).toBe('3,300');
    expect(formatPrice('380000')).toBe('380,000');
    expect(formatPrice('18700000000000')).toBe('18.70T');
    expect(formatPrice('999999.99999999999999999999')).toBe('999,999.99999999999999999999');
  });
  it('formats payouts and negative values with one real sign',()=>{
    expect(formatSignedAmount('4619000000000')).toBe('+4.62T');
    expect(formatSignedAmount('-4619000000000')).toBe('−4.62T');
    expect(formatCredits('-490114')).toBe('−490,114');
    expect(formatPrice('-538.2')).toBe('−538.2');
    expect(formatCredits('-0')).toBe('0');
  });
  it('carries rounded band boundaries without binary-float loss',()=>{
    expect(formatCredits('999999999')).toBe('1.00B');
    expect(formatCredits('999999999999999')).toBe('1.00Q');
    expect(formatPrice('9007199254740993')).toBe('9.01Q');
    expect(formatCredits('garbage')).toBe('0');
    expect(formatCredits(Infinity)).toBe('0');
  });
});

describe('shared measurement and income formatting',()=>{
  it('pins the Phase 0D three-significant-figure plate/rate examples',()=>{
    expect(formatWatts('233.893',true)).toBe('+234 W');
    expect(formatWatts('0.385')).toBe('0.385 W');
    expect(formatRate('2000','ops/s')).toBe('2,000 ops/s');
    expect(formatRate('1.28999','/min')).toBe('1.29 /min');
    expect(formatWatts('-233.893',true)).toBe('−234 W');
    expect(formatMetric('0.000123456')).toBe('0.000123');
    expect(formatMetric('1234567')).toBe('1.23M');
    expect(formatMetric('999999')).toBe('1M');
  });
  it('matches the signed net HUD, including small negative rates',()=>{
    expect(formatNet('718')).toBe('+718 net/min');
    expect(formatNet('-718')).toBe('−718 net/min');
    expect(formatNet('-0.125')).toBe('−0.13 net/min');
    expect(formatNet('1')).toBe('+1.00 net/min');
    expect(formatNet('4619000000000')).toBe('+4.62T net/min');
    expect(formatNet('-0')).toBe('+0.00 net/min');
  });
});

describe('shared unit quantities (board, deck, callouts and cards)', () => {
  it.each([
    [formatSize, 1, '1 b'], [formatSize, 64, '64 b'], [formatSize, 21_400, '21.4 kb'], [formatSize, 197_000, '197 kb'],
    [formatSize, 2_500_000, '2.5 Mb'], [formatSize, 1e9, '1 Gb'],
    [formatHertz, 1, '1 Hz'], [formatHertz, 1024, '1.02 kHz'], [formatHertz, 8000, '8 kHz'], [formatHertz, 50_000, '50 kHz'],
    [formatHertz, 1.28e9, '1.28 GHz'],
    [formatOps, 1, '1 op'], [formatOps, 3, '3 ops'], [formatOps, 999, '999 ops'], [formatOps, 53_400, '53.4k ops'], [formatOps, 1.2e6, '1.2M ops'],
    // Rounding carries across a prefix; past Y the UI's scientific fallback.
    [formatSize, 999.7, '1 kb'], [formatHertz, 999_600, '1 MHz'], [formatOps, 1000, '1k ops'], [formatSize, 3e24, '3 Yb'],
    [formatEnergy, 6e8, '600 MJ'], [formatEnergy, 1.2e11, '120 GJ'],
    [formatSize, 1.8e36, '1.80e36 b'], [formatOps, 0, '0 ops'], [formatSize, 0.5, '0.5 b'],
  ] as const)('%o(%d) is %s', (fmt, n, text) => {
    expect(fmt(n)).toBe(text);
  });
});

describe('shared duration and countdown formatting',()=>{
  it('pins the payback and offline-duration examples',()=>{
    expect(formatDurationMs(690500)).toBe('11m 31s');
    expect(formatDurationMs('691000')).toBe('11m 31s');
    expect(formatDurationMs(8160000)).toBe('2h 16m');
    expect(formatDurationMs(7200000)).toBe('2h 0m');
    expect(formatDurationMs(259200000)).toBe('3d 0h');
    expect(formatDurationMs(-1000)).toBe('0s');
  });
  it('ports fmtTime countdown phases without rounding up a fractional second',()=>{
    expect(formatCountdownMs(565000)).toBe('9:25');
    expect(formatCountdownMs('565999.99')).toBe('9:25');
    expect(formatCountdownMs(8160000)).toBe('2:16:00');
    expect(formatCountdownMs(59999)).toBe('0:59');
    expect(formatCountdownMs(60000)).toBe('1:00');
    expect(formatCountdownMs(-1)).toBe('0:00');
  });
  it('retains the short seconds helper with exact decimal rounding',()=>{
    expect(formatSeconds('0.87')).toBe('0.9s');
    expect(formatSeconds(42)).toBe('42s');
    expect(formatSeconds('9.95')).toBe('10.0s');
    expect(formatSeconds(-1)).toBe('0.0s');
  });
});
