// A research price: Data and Credits as the project costs them (Credits only for some).
import { CoinIcon, GemIcon } from '../plates/icons';
import { wholeText } from '../plates/format';
import type { Currency, Price } from './money';

/** A currency the wallet is short of reads dim. */
export function PriceTag({ price, short = [] }: { price: Price; short?: readonly Currency[] }) {
  return <span className="pt">
    {price.data && <span className={`pt-d${short.includes('data') ? ' short' : ''}`}><GemIcon />{wholeText(price.data)}</span>}
    {price.credits && <span className={`pt-c${short.includes('credits') ? ' short' : ''}`}><CoinIcon />{wholeText(price.credits)}</span>}
  </span>;
}
