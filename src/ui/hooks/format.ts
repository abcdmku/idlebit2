// Display formatting for the v3 HUD, feed and round plate (mockup core/plate.js wholeText,
// feed-view.js). Credits and Data are whole numbers (D2.2, D3.3): nothing here ever prints
// a fractional currency.
import type { Amount } from '../../game/amount';
import { compactWhole } from '../plates/format';

const MINUS = '−';

/** A whole count: grouped below 10,000, then 41.2k, 1.48M, 413M … Dc, then 1.80e36 (A13). Rounds to a whole first. */
export function wholeText(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const n = Math.round(value), a = Math.abs(n), sign = n < 0 ? MINUS : '';
  if (a < 1e4) return sign + a.toLocaleString('en-US');
  return sign + compactWhole(a);
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


/** One ETA everywhere (QA-09): "~9 s" under a minute, "~35 min" under 90 min, then "~2 h". */
export function etaSpan(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.max(1, Math.ceil(seconds));
  return s < 60 ? `~${s} s` : s < 5400 ? `~${Math.round(s / 60)} min` : `~${Math.round(s / 3600)} h`;
}
