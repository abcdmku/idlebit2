import { amount } from './amount';
import { formatAmount, formatBits, formatCountdownMs, formatCredits, formatData, formatDurationMs,
  formatMetric, formatNet, formatPrice, formatRate, formatSeconds, formatSignedAmount, formatWatts } from './format';

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
  it('keeps bit dimensions separate from currency suffixes',()=>{
    expect(formatBits(8)).toBe('8 b');
    expect(formatBits('1000')).toBe('1 Kb');
    expect(formatBits(2000000)).toBe('2 Mb');
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
