// Display formatting for the v3 HUD, feed and round plate (mockup core/plate.js wholeText,
// feed-view.js). Credits and Data are whole numbers (D2.2, D3.3): nothing here ever prints
// a fractional currency.
import type { Amount } from '../../game/amount';

const MINUS = '−';
const BANDS: readonly (readonly [number, string])[] = [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

/** A whole count: grouped below 10,000, then 41.2k, 1.48M, 413M. Rounds to a whole first. */
export function wholeText(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const n = Math.round(value), a = Math.abs(n), sign = n < 0 ? MINUS : '';
  if (a < 1e4) return sign + a.toLocaleString('en-US');
  for (const [scale, suffix] of BANDS) {
    if (a < scale) continue;
    const x = a / scale;
    const body = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
    return sign + body.replace(/\.?0+$/, '') + suffix;
  }
  return sign + String(a);
}

/** A whole Amount. Exact strings are parsed only for display. */
export function amountText(value: Amount): string {
  return wholeText(Math.trunc(Number(value)));
}

/** Round clock: 0:38, 14:05, 1:02:09. Whole seconds, truncated. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(x).padStart(2, '0');
}

/** SLA percent already floored to one decimal by the sim: 79.9%. */
export function slaText(percent: number): string {
  return percent.toFixed(1) + '%';
}

/** The gauge fill: the 60–100% band, so the 80% floor sits at the middle. */
export function slaFill(percent: number): number {
  return Math.max(0, Math.min(100, (percent - 60) / 40 * 100));
}

