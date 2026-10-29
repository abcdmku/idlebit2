import type { ReactNode } from 'react';
import { type Amount, type Currency, type Quote, type ResearchId } from '../../game';
import { CoinIcon, GemIcon, LockIcon } from './icons';
import { span, wholeText } from './format';
import { purchaseGain, purchaseReason } from './purchaseText';

/* The plate language (mockup core/plate.js): head, status and bar, lines, list, keys, port grid, toggle, choices. */

export function Pips({ filled, max }: { filled: number; max: number }) {
  const n = Math.max(0, Math.min(max, 16));
  return <span className="pips" role="img" aria-label={`Level ${filled} of ${max}`}>
    {Array.from({ length: n }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
  </span>;
}

/** A whole price with its currency glyph. Gold for Credits, green for Data. */
export function Price({ cost, currency = 'credits' }: { cost: Amount | number; currency?: Currency }) {
  return <span className={`pz ${currency === 'data' ? 'd' : 'c'}`}>
    {currency === 'data' ? <GemIcon /> : <CoinIcon />}<span>{wholeText(cost)}</span>
  </span>;
}

export type Tone = '' | 'ben' | 'warn' | 'muted';
export interface Line { readonly text: string; readonly tone?: Tone }

export function Status({ text, tone = '', progress }: { text: string; tone?: Tone | 'rnd'; progress?: number | null }) {
  return <>
    <p className={`p-status ${tone}`}>{text}</p>
    {progress != null && <div className={`p-bar ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(Math.max(0, Math.min(1, progress)) * 100)} aria-label={text}>
      <b style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} /></div>}
  </>;
}

/** Render actual facts without reserving empty paragraph rows. */
export function Lines({ lines, slots: _slots = lines.length }: { lines: readonly Line[]; slots?: number }) {
  const rows = lines.filter(line => line.text.trim());
  return <>{rows.map((l, i) => <p key={i} className={`p-line ${l?.tone ?? ''}`} aria-live={i === 0 ? 'polite' : undefined}>{l?.text ?? ''}</p>)}</>;
}


export type KeyTone = '' | 'replace' | 'replace prep' | 'go' | 'row' | 'ghost' | 'prio' | 'locked-action';
export interface KeyProps {
  label: ReactNode;
  price?: { cost: Amount; currency?: Currency } | null;
  detail?: ReactNode;
  tone?: KeyTone;
  disabled?: boolean;
  ariaLabel?: string;
  /** A choice key that is the current setting. */
  pressed?: boolean;
  purchase?: Quote;
  onPress: () => void;
}
export function Key({ label, price, detail, tone = '', disabled, ariaLabel, pressed, purchase, onPress }: KeyProps) {
  return <button type="button" className={`key ${tone}${pressed ? ' on' : ''}`} disabled={disabled} aria-label={ariaLabel} aria-pressed={pressed} data-purchase-action={purchase ? JSON.stringify(purchase.action) : undefined}
    onClick={(e) => { e.stopPropagation(); if (!disabled) onPress(); }}>
    <span className="kl">{label}</span>
    {price && <Price cost={price.cost} currency={price.currency} />}
    {detail != null && <span className="action-detail clip">{detail}</span>}
  </button>;
}

/** A cold change's real cost: time offline and running work lost, only while a round runs (between rounds nothing runs). */
export const coldText = (q: Pick<Quote, 'cold' | 'downtimeMs'>) => (q.cold && q.downtimeMs > 0 ? `Cold swap · ${span(q.downtimeMs / 1000)} offline, running work lost` : '');

/** Hot or cold, with what a cold change costs in time and work (program §3). */
export function changeNote(q: Pick<Quote, 'cold' | 'downtimeMs'>): string {
  return q.cold ? coldText(q) || 'Cold swap' : '';
}

export interface QuoteKeyProps {
  quote: Quote;
  label: ReactNode;
  detail?: ReactNode;
  tone?: KeyTone;
  showSupplyNote?: boolean;
  ariaLabel?: string;
  /** Optional caller hint. Component locks are read from the quote itself. */
  reason?: string | null;
  researchName?: (id: ResearchId) => string;
  onAction: (q: Quote) => void;
  onResearch?: (id: ResearchId) => void;
}
/** One purchase, its stat gain and price. Limits disable this same key. */
export function QuoteKey({ quote, label, detail, tone = '', researchName, onAction, ariaLabel }: QuoteKeyProps) {
  const why = purchaseReason(quote, researchName);
  const gain = detail ?? purchaseGain(quote);
  const noPower = !!quote.overSupply || quote.locked?.code === 'power';
  const shownLabel = noPower ? "Can't upgrade" : quote.gpu && typeof label === 'string' ? `${label} · ${quote.gpu.after.cores} ${quote.gpu.after.cores === 1 ? 'core' : 'cores'}` : label;
  const cold = quote.cold && quote.downtimeMs > 0 ? Math.ceil(quote.downtimeMs / 1000) + 's offline' : '';
  const shown = (quote.locked || quote.overSupply) ? why : [gain, cold].filter(Boolean).join(' · ') || why;
  return <Key tone={tone} label={shownLabel} price={quote.locked && quote.cost === '0' ? null : { cost: quote.cost, currency: quote.currency }} detail={shown || undefined}
    ariaLabel={[ariaLabel ?? (typeof shownLabel === 'string' ? shownLabel : quote.label), purchaseGain(quote), why, cold].filter(Boolean).join('. ')}
    disabled={!!why} purchase={quote} onPress={() => onAction(quote)} />;
}

/* ---------- widgets: port grid, toggle row, choice list ---------- */


export function Toggle({ label, note, on, disabled, onToggle }: { label: string; note?: string; on: boolean; disabled?: boolean; onToggle: () => void }) {
  return <button type="button" className={`cx-tog${on ? ' on' : ''}`} role="switch" aria-checked={on} disabled={disabled}
    onClick={(e) => { e.stopPropagation(); onToggle(); }}>
    <s /><span>{label}{note && <small>{note}</small>}</span>
  </button>;
}

export interface Choice { readonly id: string; readonly label: string; readonly on: boolean; readonly note?: string; readonly lock?: string | null }
export function Choices({ rows, label, onPick }: { rows: readonly Choice[]; label: string; onPick: (id: string) => void }) {
  return <div className="cx-rows" role="group" aria-label={label}>
    {rows.map((r) => <button key={r.id} type="button" className={`cx-row${r.on ? ' on' : ''}${r.lock ? ' lock' : ''}`}
      aria-pressed={r.on} aria-disabled={r.lock ? true : undefined}
      onClick={(e) => { e.stopPropagation(); if (!r.lock) onPick(r.id); }}>
      <u /><span>{r.label}{!r.lock && r.note ? <small>{r.note}</small> : null}</span>
      {r.lock && <small title={r.lock} aria-label={r.lock}><LockIcon /></small>}
    </button>)}
  </div>;
}
