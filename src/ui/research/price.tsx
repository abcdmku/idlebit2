// A research price: Data and Credits as the project costs them (Credits only for some), compact like
// every other surface. `exact` writes each figure out in full instead, for a price the compact form rounds.
import { CoinIcon, GemIcon } from '../plates/icons';
import type { Amount } from '../../game';
import { wholeText } from '../plates/format';
import type { Currency, Price } from './money';

/** Compact amounts keep three figures: anything longer is rounded on screen. */
export const rounded = (amount: string | null) => !!amount && amount.length > 4 && !/^\d{1,3}0*$/.test(amount);
const full = (amount: string) => BigInt(amount).toLocaleString('en-US');

/** A currency the wallet is short of reads as the blocker. */
export function PriceTag({ price, short = [], exact = false }: { price: Price; short?: readonly Currency[]; exact?: boolean }) {
  const part = (currency: Currency, amount: Amount | null) => amount &&
    <span className={`pt-${currency === 'data' ? 'd' : 'c'}${short.includes(currency) ? ' short' : ''}`}>
      {currency === 'data' ? <GemIcon /> : <CoinIcon />}{exact ? full(amount) : wholeText(amount)}
    </span>;
  return <span className="pt">{part('data', price.data)}{part('credits', price.credits)}</span>;
}
