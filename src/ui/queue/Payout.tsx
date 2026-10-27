// A task's reward, Credits at 1 per op of work (D2.2): the coin, then the whole amount. The coin replaces the "+".
import { CoinIcon } from '../plates/icons';

export const Payout = ({ text }: { text: string }) => <span className="payout"><CoinIcon />{text.replace(/^\+/, '')}</span>;

/** What a fit check measures for a payout: the coin and its gap are about two characters wide, the "+" one. */
export const payoutFit = (text: string): string => ` ${text}`;
