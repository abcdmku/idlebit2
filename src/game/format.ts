import Decimal from 'decimal.js';
import type { AmountInput } from './amount';

// Display rounding only. Exact saved Amounts never pass through binary floats.
const D=Decimal.clone({precision:1024,rounding:Decimal.ROUND_HALF_UP,toExpNeg:-1000000000,toExpPos:1000000000});
const BANDS=[['1e6','M'],['1e9','B'],['1e12','T'],['1e15','Q']] as const;
const MINUS='−';
function decimal(value:AmountInput):Decimal {
  try {const d=new D(value);return d.isFinite()?d:new D(0);} catch {return new D(0);}
}
function grouped(value:string):string {
  const [whole,fraction]=value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');
}
const sign=(d:Decimal,positive=false)=>d.lt(0)?MINUS:positive?'+':'';

/** Mockup fmt: two decimals below 100 of a band, one above; no K band. */
function compact(d:Decimal,metric=false):string {
  for(let i=BANDS.length-1;i>=0;i--){
    const [scale,suffix]=BANDS[i];if(d.lt(scale))continue;
    const coefficient=d.div(scale);
    const rounded=metric?coefficient.toSignificantDigits(3):coefficient.gte(1000)
      ?coefficient.toSignificantDigits(4):coefficient.toDecimalPlaces(coefficient.gte(100)?1:2);
    // Carry across a rounded band edge without producing a five-digit 1000.0M.
    if(rounded.gte(1000)&&i<BANDS.length-1)return compact(new D(BANDS[i+1][0]),metric);
    return (metric||coefficient.gte(1000)?rounded.toFixed():rounded.toFixed(coefficient.gte(100)?1:2))+suffix;
  }
  return grouped(d.floor().toFixed());
}

/** Wallet Credits: two trimmed decimals below 100, integers/compact above. */
export function formatCredits(value:AmountInput):string {
  const d=decimal(value),abs=d.abs(),body=abs.lt(100)?abs.toDecimalPlaces(2).toFixed():compact(abs.floor());
  return (body==='0'?'':sign(d))+body;
}
/** Compatibility name; all generic Amount labels now follow Credit formatting. */
export const formatAmount=formatCredits;

/** The mockup meter keeps up to three Data decimals below 100. */
export function formatData(value:AmountInput):string {
  const d=decimal(value),abs=d.abs();
  const body=abs.lt(100)?grouped(abs.toDecimalPlaces(3).toFixed()):compact(abs.floor());
  return (body==='0'?'':sign(d))+body;
}
/** Tags/buttons use Credit bands, preserving exact decimal prices below 1M. */
export function formatPrice(value:AmountInput):string {
  const d=decimal(value),abs=d.abs();
  return sign(d)+(abs.lt('1e6')?grouped(abs.toFixed()):compact(abs.floor()));
}
/** Payout/difference labels such as +4.62T. */
export function formatSignedAmount(value:AmountInput):string {
  const d=decimal(value);return sign(d,true)+formatCredits(d.abs());
}

/** Measurements have at most three significant figures; 2,000 stays unabridged. */
export function formatMetric(value:AmountInput):string {
  const d=decimal(value),abs=d.abs(),rounded=abs.toSignificantDigits(3);
  return sign(d)+(rounded.gte('1e6')?compact(rounded,true):grouped(rounded.toFixed()));
}
export function formatRate(value:AmountInput,unit:string,signed=false):string {
  const d=decimal(value),prefix=signed&&!d.lt(0)?'+':'';
  return prefix+formatMetric(d)+(unit?' '+unit:'');
}
export const formatWatts=(value:AmountInput,signed=false):string=>formatRate(value,'W',signed);

/** HUD net rate, including the mockup's fixed two decimals below 10/min. */
export function formatNet(value:AmountInput):string {
  const d=decimal(value),abs=d.abs();
  return sign(d,true)+(abs.lt(10)?abs.toFixed(2):formatCredits(abs))+' net/min';
}

/** Human duration, rounded to the nearest second; payback 690.5s is 11m 31s. */
export function formatDurationMs(milliseconds:AmountInput):string {
  const total=D.max(0,decimal(milliseconds)).div(1000).toDecimalPlaces(0);
  const hours=total.div(3600).floor(),minutes=total.mod(3600).div(60).floor(),seconds=total.mod(60);
  if(hours.gte(48))return hours.div(24).floor().toFixed()+'d '+hours.mod(24).toFixed()+'h';
  if(hours.gt(0))return hours.toFixed()+'h '+minutes.toFixed()+'m';
  if(minutes.gt(0))return minutes.toFixed()+'m '+seconds.toFixed()+'s';
  return seconds.toFixed()+'s';
}
/** Mockup fmtTime, taking milliseconds: m:ss or h:mm:ss, floored and clamped. */
export function formatCountdownMs(milliseconds:AmountInput):string {
  const total=D.max(0,decimal(milliseconds)).div(1000).floor();
  const hours=total.div(3600).floor(),minutes=total.mod(3600).div(60).floor().toFixed();
  return (hours.gt(0)?hours.toFixed()+':'+minutes.padStart(2,'0'):minutes)+':'+total.mod(60).toFixed().padStart(2,'0');
}
/** Short sub-ten-second measurements retain tenths, as in the original readout. */
export function formatSeconds(seconds:AmountInput):string {
  const d=D.max(0,decimal(seconds));return (d.lt(10)?d.toFixed(1):d.toDecimalPlaces(0).toFixed())+'s';
}
/* ---------- Unit quantities: one string per quantity on the board, deck, callouts and cards ---------- */

const SI = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'] as const;
/** Up to 3 significant figures of a coefficient below 1000, trailing zeros dropped. */
const sig3 = (x: number): string => {
  const t = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toPrecision(3);
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
};
/**
 * A plain number as [number, SI prefix]: 3 significant figures, trailing zeros dropped, k M G T P
 * E Z Y. A coefficient that rounds to 1000 carries to the next prefix. Past Y it is scientific,
 * "1.80e36", with no prefix (the UI's fallback).
 */
function siParts(n: number): [string, string] {
  if (!Number.isFinite(n)) return ['—', ''];
  const sign = n < 0 ? MINUS : '', a = Math.abs(n);
  if (a === 0) return ['0', ''];
  let i = a < 1000 ? 0 : Math.min(SI.length - 1, Math.floor(Math.log10(a) / 3));
  let text = sig3(a / 1000 ** i);
  if (Number(text) >= 1000) { i += 1; text = i < SI.length ? '1' : text; }
  if (i >= SI.length || a >= 1000 ** SI.length) return [sign + a.toExponential(2).replace('e+', 'e'), ''];
  return [sign + text, SI[i]!];
}

/** Bits: "1 b", "64 b", "21.4 kb", "197 kb", "2.5 Mb", "1 Gb". */
export function formatSize(bits: number): string {
  const [num, prefix] = siParts(bits);
  return `${num} ${prefix}b`;
}
/** Clocks and link speeds: "1 Hz", "1.02 kHz", "8 kHz", "50 kHz", "1.28 GHz". */
export function formatHertz(hz: number): string {
  const [num, prefix] = siParts(hz);
  return `${num} ${prefix}Hz`;
}
/** Work, the prefix on the number (the queue cards' style): "1 op", "3 ops", "53.4k ops", "1.2M ops". */
export function formatOps(n: number): string {
  const [num, prefix] = siParts(n);
  return `${num}${prefix} ${num === '1' && prefix === '' ? 'op' : 'ops'}`;
}
