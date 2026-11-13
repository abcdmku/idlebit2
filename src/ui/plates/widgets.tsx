import type { ReactNode } from 'react';
import { type Amount, type Currency, type Quote, type ResearchId } from '../../game';
import { CoinIcon, GemIcon, LockIcon } from './icons';
import { wholeText } from './format';
import { overloadWarning, purchaseGain, purchaseReason } from './purchaseText';

/* The plate language (mockup core/plate.js): head, status and bar, lines, list, keys, port grid, toggle, choices. */

export function Pips({ filled, max }: { filled: number; max: number }) {
  const n = Math.max(0, Math.min(max, 16));
  return <span className="pips" role="img" aria-label={`Level ${filled} of ${max}`}>
    {Array.from({ length: n }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
  </span>;
}

/** A whole price with its currency glyph. Shortfalls use the menu or hardware context's shared color. */
export function Price({ cost, currency = 'credits', affordable }: { cost: Amount | number; currency?: Currency; affordable?: boolean }) {
  return <span className={`pz ${currency === 'data' ? 'd' : 'c'}`} data-affordable={affordable}
    style={affordable === false ? { color: 'var(--currency-short)' } : undefined}>
    {currency === 'data' ? <GemIcon /> : <CoinIcon />}<span>{wholeText(cost)}</span>
  </span>;
}

export type Tone = '' | 'ben' | 'warn' | 'muted';
export interface Line { readonly text: string; readonly tone?: Tone }

/** A usage meter. Its figure is the plate's inline usage on the title line. */
export function Bar({ progress, tone = '', label }: { progress: number; tone?: Tone | 'rnd'; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return <div className={`p-bar ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
    <b style={{ width: `${pct}%` }} /></div>;
}

export function Status({ text, tone = '', progress }: { text: string; tone?: Tone | 'rnd'; progress?: number | null }) {
  return <>
    <p className={`p-status ${tone}`}>{text}</p>
    {progress != null && <Bar progress={progress} tone={tone} label={text} />}
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
    {price && <Price cost={price.cost} currency={price.currency} affordable={purchase?.affordable} />}
    {detail != null && <span className="action-detail clip">{detail}</span>}
  </button>;
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
export function QuoteKey({ quote, label, detail, tone = '', researchName, onAction, onResearch, ariaLabel }: QuoteKeyProps) {
  const why = purchaseReason(quote, researchName);
  // A purchase research still locks is a key to that project, as on every locked choice; it never buys.
  const node = quote.locked?.code === 'research' ? quote.locked.node : null;
  if (node && onResearch) {
    const project = `Research ${researchName?.(node) ?? quote.locked!.text.replace(/^Needs /, '')}`;
    return <button type="button" className="key generation-action replace" data-research-target={node}
      aria-label={`${ariaLabel ?? (typeof label === 'string' ? label : quote.label)}, locked. ${project}`}
      onClick={(e) => { e.stopPropagation(); onResearch(node); }}>
      <span className="kl">{label}</span><span className="pz"><LockIcon /></span><span className="action-detail clip">{project}</span>
    </button>;
  }
  const gain = detail ?? purchaseGain(quote);
  const shownLabel = quote.gpu && typeof label === 'string' ? `${label} · ${quote.gpu.after.cores} ${quote.gpu.after.cores === 1 ? 'core' : 'cores'}` : label;
  const cold = quote.cold && quote.downtimeMs > 0 ? Math.ceil(quote.downtimeMs / 1000) + 's offline' : '';
  const shown = quote.locked ? why : overloadWarning(quote) || [gain, cold].filter(Boolean).join(' · ') || why;
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
