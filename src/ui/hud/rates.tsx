// D90 live rates: net Credits and Data per second counted from work done, and the share of work value kept
// after energy. Running, they follow the last two seconds; out of a round they are the last round's averages.
import type { CSSProperties } from 'react';
import type { HudRates } from '../../game';
import { CoinIcon, GemIcon } from '../plates/icons';
import { wholeText } from '../plates/format';
import { useGameSelector } from '../storeHooks';

const sameRates = (a: HudRates | undefined, b: HudRates | undefined) => a === b
  || !!a && !!b && a.live === b.live && a.creditsPerSec === b.creditsPerSec && a.dataPerSec === b.dataPerSec && a.efficiency === b.efficiency;

/** The HUD's rates, re-read twice a second. */
export const useRates = (): HudRates | undefined => useGameSelector(s => s.hud.rates, sameRates, 500);

/** "+5,786/s", "+16.5k/s", "−120/s"; whole units. */
export function rateText(perSec: number): string {
  const whole = Math.round(perSec);
  return `${whole > 0 ? '+' : whole < 0 ? '−' : ''}${wholeText(Math.abs(whole))}/s`;
}

export const efficiencyText = (efficiency: number | null): string => efficiency === null ? '—' : `${Math.round(efficiency * 100)}%`.replace('-', '−');

export const ratesWords = (r: HudRates): string =>
  `${r.live ? 'Now' : 'Last round'}: ${rateText(r.creditsPerSec)} Credits, ${rateText(r.dataPerSec)} Data, efficiency ${efficiencyText(r.efficiency)}`;

/** The phone rates line: Credits/s, Data/s and efficiency, each in a fixed place. */
export function RatesLine({ style }: { style: CSSProperties }) {
  const r = useRates();
  if (!r) return null;
  return <p className="rates-line" style={style} data-testid="rates-line" aria-label={ratesWords(r)}>
    <span className={r.creditsPerSec < 0 ? 'bad' : 'gold'}><CoinIcon />{rateText(r.creditsPerSec)}</span>
    <span className="data"><GemIcon />{rateText(r.dataPerSec)}</span>
    <span className={r.efficiency !== null && r.efficiency < 0 ? 'bad' : ''}><span className="mute">{r.live ? 'Efficiency' : 'Last round'}</span> {efficiencyText(r.efficiency)}</span>
  </p>;
}
