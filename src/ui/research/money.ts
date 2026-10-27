// Research prices and shortfalls. Research costs Data and Credits at 1:10, or Credits
// only (power, cooling and other work that is not about data: Data cost 0). Amounts stay exact
// (decimal strings and bigint).
import type { Amount, ResearchNodeView } from '../../game';

export type Currency = 'data' | 'credits';
export const CURRENCY_NAME: Readonly<Record<Currency, string>> = { data: 'Data', credits: 'Credits' };

export interface Wallet { readonly credits?: Amount; readonly data?: Amount }
/** What a project costs at Start; null for a currency it does not cost. */
export interface Price { readonly data: Amount | null; readonly credits: Amount | null }

const CREDITS_PER_DATA = 10n;
const whole = (a: Amount): bigint => BigInt(a.split('.')[0] || '0');
const nonzero = (a: Amount | undefined): a is Amount => a !== undefined && /[1-9]/.test(a);

/**
 * The node's price. Until the sim fills `creditCost` for every node, a node with a Data cost and no
 * Credit cost is priced at 10 Credits per Data (the 10:1 rule).
 */
export function priceOf(n: Pick<ResearchNodeView, 'dataCost' | 'creditCost'>): Price {
  const data = nonzero(n.dataCost) ? n.dataCost : null;
  const credits = nonzero(n.creditCost) ? n.creditCost : data ? (whole(data) * CREDITS_PER_DATA).toString() as Amount : null;
  return { data, credits };
}

/** Exact scaled integers of two decimal strings, so fractional balances compare exactly. */
function scaled(a: Amount, b: Amount): [bigint, bigint, bigint] {
  const [ai = '0', af = ''] = a.split('.'), [bi = '0', bf = ''] = b.split('.');
  const digits = Math.max(af.length, bf.length);
  return [BigInt(ai + af.padEnd(digits, '0')), BigInt(bi + bf.padEnd(digits, '0')), 10n ** BigInt(digits)];
}

/** Whole units still needed to pay `cost` from `balance` (0 when it is enough). */
export function shortBy(balance: Amount | undefined, cost: Amount | null): bigint {
  if (cost === null || balance === undefined) return 0n;
  const [b, c, unit] = scaled(balance, cost);
  return c <= b ? 0n : (c - b + unit - 1n) / unit;
}

export interface Shortfall { readonly currency: Currency; readonly need: bigint }

/**
 * The currencies the wallet is short of, in Data/Credits order. Empty when the wallet pays the price.
 */
export function shortfalls(price: Price, w: Wallet): Shortfall[] {
  const out: Shortfall[] = [];
  for (const currency of ['data', 'credits'] as const) {
    const need = shortBy(w[currency], price[currency]);
    if (need > 0n) out.push({ currency, need });
  }
  return out;
}
