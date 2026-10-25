import type { Amount } from '../../game';

/**
 * Display formatting for plates, tray and research. Credits and Data are whole numbers (D2.2, D3.3);
 * measurements carry at most 3 significant figures (v2 Phase 0D port fixes).
 */

const MINUS = '−';
const COMPACT: readonly (readonly [number, string])[] = [[1e18, 'Qi'], [1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const trimZeros = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

function toNumber(value: Amount | number | bigint): number {
  return typeof value === 'number' ? value : Number(value);
}

/** Up to 3 significant figures of a positive coefficient below 1000, trailing zeros dropped. */
function coefficient(x: number): string {
  return trimZeros(x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
}

/**
 * A whole Credit or Data amount: "40", "2,400", "9,960", then compact from 10,000: "12.3k", "1.24M".
 * Never a fraction. Fractional input rounds up (prices round up, D2).
 */
export function wholeText(value: Amount | number | bigint): string {
  if (typeof value === 'string' && /^-?\d{1,15}$/.test(value)) {
    const neg = value.startsWith('-'), digits = neg ? value.slice(1) : value;
    if (digits.length <= 4) return (neg && digits !== '0' ? MINUS : '') + grouped(digits);
  }
  let n = Math.ceil(toNumber(value));
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? MINUS : '';
  n = Math.abs(n);
  if (n < 1e4) return sign + grouped(String(n));
  for (let i = 0; i < COMPACT.length; i++) {
    const [scale, suffix] = COMPACT[i];
    if (n < scale) continue;
    const text = coefficient(n / scale);
    // 999.6k rounds to "1000k": carry into the next band.
    if (Number(text) >= 1000 && i > 0) return sign + '1' + COMPACT[i - 1][1];
    return sign + text + suffix;
  }
  return sign + grouped(String(n));
}

/** Whole Credits per minute, signed: "−9,960/min", "+12.3k/min", "0/min". */
export function perMinuteText(value: Amount | number, signed = true): string {
  const n = toNumber(value);
  const body = wholeText(Math.abs(Math.trunc(n)));
  return (n < 0 && body !== '0' ? MINUS : signed && n > 0 ? '+' : '') + body + '/min';
}

/** At most 3 significant figures with an SI prefix and a space: "30 ", "1.00 P", "42.7 T". */
export function sig3(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n), sign = n < 0 ? MINUS : '';
  const units: readonly (readonly [number, string])[] = [[1e21, ' Z'], [1e18, ' E'], [1e15, ' P'], [1e12, ' T'], [1e9, ' G'], [1e6, ' M'], [1e3, ' k']];
  const u = units.find(([v]) => a >= v) ?? [1, ' '];
  const v = a / u[0], d = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return sign + (u[0] === 1 && Number.isInteger(a) ? String(a) : v.toFixed(d)) + u[1];
}

/** A measurement with a unit, 3 significant figures, trailing zeros dropped: "234 W", "4.1 kW", "50 kHz". */
export function quantity(n: number, unit: string): string {
  if (!Number.isFinite(n)) return '—';
  const s = sig3(n), num = trimZeros(s.slice(0, s.lastIndexOf(' '))), prefix = s.slice(s.lastIndexOf(' ') + 1);
  return `${num} ${prefix}${unit}`;
}

export const watts = (w: number) => quantity(w, 'W');
export const hertz = (hz: number) => quantity(hz, 'Hz');
export const bits = (b: number) => quantity(b, 'b');
export const fahrenheit = (f: number) => `${Math.round(f)}°F`;
export const percent = (fraction: number) => `${Math.round(Math.max(0, fraction) * 100)}%`;

/** m:ss or h:mm:ss, floored. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const t = Math.max(0, Math.floor(seconds)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s).padStart(2, '0');
}

/** Payback copy: "4m 10s", "2h 5m", "3d 4h". */
export function span(seconds: number): string {
  const t = Math.max(0, Math.round(seconds)), d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (d >= 2) return `${d}d ${h}h`;
  if (d || h) return `${d * 24 + h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
