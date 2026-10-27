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
/** D36: watts with SI prefixes, sub-unit included: "41 µW", "2.5 mW", "41 kW", "1.2 GW". */
export const formatWatts=(value:AmountInput,signed=false):string=>{
  const n=Number(decimal(value).toString());
  const [num,prefix]=siPartsAll(n);
  return (signed&&n>=0?'+':'')+num+' '+prefix+'W';
};
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

const SUB = ['m', 'µ', 'n', 'p', 'f'] as const;
/** siParts plus sub-unit prefixes (m, µ, n, p, f) for values below 1 (D36: power and energy). */
function siPartsAll(n: number): [string, string] {
  const a = Math.abs(n);
  if (!Number.isFinite(n) || a === 0 || a >= 1) return siParts(n);
  let i = Math.min(SUB.length, Math.ceil(-Math.log10(a) / 3));
  let text = sig3(a * 1000 ** i);
  if (Number(text) >= 1000 && i > 1) { i -= 1; text = sig3(a * 1000 ** i); }
  if (Number(text) >= 1000) return siParts(n < 0 ? -1 : 1);
  return [(n < 0 ? MINUS : '') + text, SUB[i - 1]!];
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
/**
 * A countdown on a display (the battery's time left): m:ss under an hour ("4:12", "10:00"), then hours,
 * one decimal under 10 h ("1.5 h", "2 h", "12 h"). Floored; negative or not finite reads "0:00".
 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  if (seconds < 3600) {
    const t = Math.floor(seconds);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  const h = seconds / 3600;
  return `${h < 10 ? String(Math.floor(h * 10) / 10) : String(Math.floor(h))} h`;
}
/** Energy: "600 MJ", "120 GJ", "5 µJ" (a battery's capacity; D36 sub-unit prefixes). */
export function formatEnergy(joules: number): string {
  const [num, prefix] = siPartsAll(joules);
  return `${num} ${prefix}J`;
}
/** Work, the prefix on the number (the queue cards' style): "1 op", "3 ops", "53.4k ops", "1.2M ops". */
export function formatOps(n: number): string {
  const [num, prefix] = siParts(n);
  return `${num}${prefix} ${num === '1' && prefix === '' ? 'op' : 'ops'}`;
}
