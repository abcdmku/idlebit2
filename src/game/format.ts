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
/** Bit quantities keep explicit bit units; this is not a Credit abbreviation. */
export function formatBits(bits:AmountInput):string {
  const d=decimal(bits),abs=d.abs();
  for(const [scale,unit] of [['1e15','Pb'],['1e12','Tb'],['1e9','Gb'],['1e6','Mb'],['1e3','Kb']])
    if(abs.gte(scale))return formatMetric(d.div(scale))+' '+unit;
  return formatMetric(d)+' b';
}
