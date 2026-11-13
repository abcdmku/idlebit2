// Display text for world labels (Control deck dom.js). Formatting only: every value comes from the snapshot.
// Sizes, speeds and ops use the game's shared formatters (formatSize, formatHertz, formatOps), so the
// board, the deck, the callouts and the cards print one string per quantity.
import { formatWatts } from '../../game';

const GROUP = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Whole number with thousands separators: 1,024. */
export function whole(n: number): string { return GROUP.format(Math.floor(n)); }

const COUNT_BANDS = [[1e33, 'Dc'], [1e30, 'No'], [1e27, 'Oc'], [1e24, 'Sp'], [1e21, 'Sx'], [1e18, 'Qi'],
  [1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const;
/** Payouts use the shell's three-significant-figure currency scheme. */
export function payoutCount(value: number): string {
  const n = Math.round(value);
  if (n < 1e4) return whole(n);
  if (n >= 1e36) return n.toExponential(2).replace('e+', 'e');
  for (let i = 0; i < COUNT_BANDS.length; i++) {
    const [scale, suffix] = COUNT_BANDS[i]!;
    if (n < scale) continue;
    const text = Number((n / scale).toPrecision(3)).toString();
    if (Number(text) >= 1000) return i > 0 ? `1${COUNT_BANDS[i - 1]![1]}` : (1000 * scale).toExponential(2).replace('e+', 'e');
    return text + suffix;
  }
  return whole(n);
}

/** Power: the one shared watts string (game `formatWatts`), "41 µW", "2.5 mW", "64 W", "1.2 kW". */
export function wattsText(w: number): string { return formatWatts(w); }

/** Seconds left on a transfer, one decimal, never below 0.1 while it runs. */
export function secondsText(s: number): string { return `${Math.max(0.1, s).toFixed(1)} s`; }
