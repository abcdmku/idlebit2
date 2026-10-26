import type { ReactNode } from 'react';
import type { Amount, Currency, Quote, ResearchId } from '../../game';
import { CoinIcon, GemIcon, LockIcon } from './icons';
import { span, wholeText } from './format';
import { overSupplyText, SUPPLY_NAME, supplyRequest } from './overSupply';
import { useQuote, useShell } from '../storeHooks';

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

/** Fixed-count line slots: a plate reserves `slots` rows so it never resizes when a warning appears. */
export function Lines({ lines, slots = lines.length }: { lines: readonly Line[]; slots?: number }) {
  const rows = Array.from({ length: Math.max(slots, lines.length) }, (_, i) => lines[i] ?? null);
  return <>{rows.map((l, i) => <p key={i} className={`p-line ${l?.tone ?? ''}`} aria-live={i === 0 ? 'polite' : undefined}>{l?.text ?? ''}</p>)}</>;
}

export function PlateList({ items }: { items: readonly { text: string; value?: ReactNode }[] }) {
  return <ul className="p-list">{items.map((it, i) => <li key={i}><span>{it.text}</span>{it.value != null && <span className="v">{it.value}</span>}</li>)}</ul>;
}

export type KeyTone = '' | 'replace' | 'go' | 'row' | 'ghost' | 'prio' | 'locked-action';
export interface KeyProps {
  label: ReactNode;
  price?: { cost: Amount; currency?: Currency } | null;
  detail?: ReactNode;
  tone?: KeyTone;
  disabled?: boolean;
  ariaLabel?: string;
  /** A choice key that is the current setting. */
  pressed?: boolean;
  onPress: () => void;
}
export function Key({ label, price, detail, tone = '', disabled, ariaLabel, pressed, onPress }: KeyProps) {
  return <button type="button" className={`key ${tone}${pressed ? ' on' : ''}`} disabled={disabled} aria-label={ariaLabel} aria-pressed={pressed}
    onClick={(e) => { e.stopPropagation(); if (!disabled) onPress(); }}>
    <span className="kl">{label}</span>
    {price && <Price cost={price.cost} currency={price.currency} />}
    {detail != null && <span className="action-detail">{detail}</span>}
  </button>;
}

/** Hot or cold, with what a cold change costs in time and work (program §3). */
export function changeNote(q: Pick<Quote, 'cold' | 'downtimeMs'>): string {
  return q.cold ? `Cold · ${span(q.downtimeMs / 1000)} offline, running work lost` : 'Hot · no downtime';
}

export interface QuoteKeyProps {
  quote: Quote;
  label: ReactNode;
  detail?: ReactNode;
  tone?: KeyTone;
  /** Shown under the key when it cannot be bought. */
  reason?: string | null;
  researchName?: (id: ResearchId) => string;
  onAction: (q: Quote) => void;
  onResearch?: (id: ResearchId) => void;
}
/** A purchase key for one quote. A research lock turns it into a key that opens that research. */
export function QuoteKey({ quote, label, detail, tone = '', reason, researchName, onAction, onResearch }: QuoteKeyProps) {
  const lock = quote.locked;
  if (lock?.code === 'research' && lock.node && onResearch) {
    const node = lock.node;
    return <Key tone="locked-action" label={<>{label} · <LockIcon /> research</>}
      detail={researchName?.(node) ?? lock.text} ariaLabel={`${typeof label === 'string' ? label : 'Option'} locked. ${lock.text}. Open research.`}
      onPress={() => onResearch(node)} />;
  }
  const cantBuy = Boolean(lock) || !quote.affordable;
  const why = lock ? lock.text : !quote.affordable ? (reason ?? `Needs more ${quote.currency === 'data' ? 'Data' : 'Credits'}`) : null;
  return <>
    <Key tone={tone} label={label} price={lock ? null : { cost: quote.cost, currency: quote.currency }} detail={detail}
      disabled={cantBuy} onPress={() => onAction(quote)} />
    {why && <p className="need">{why}</p>}
    <OverSupplyNote quote={quote} onAction={onAction} />
  </>;
}

/**
 * A buy that would push a supply past its cap (sim `overSupply`, view watts): "Over the power supply · 64 W → 80 W",
 * and a key that upgrades that supply. Nothing at all when the quote stays under every supply.
 */
export function OverSupplyNote({ quote, onAction }: { quote: Quote; onAction: (q: Quote) => void }) {
  return quote.overSupply ? <SupplyFix os={quote.overSupply} onAction={onAction} /> : null;
}
function SupplyFix({ os, onAction }: { os: NonNullable<Quote['overSupply']>; onAction: (q: Quote) => void }) {
  const shell = useShell(), r = useQuote(supplyRequest(os, shell.store.getSnapshot()));
  const supply = r?.quotes.find(q => q.action.type === 'upgradePart' && !q.locked) ?? r?.quotes.find(q => !q.locked) ?? null;
  return <>
    <p className="need warn" data-testid="over-supply">{overSupplyText(os)}</p>
    {supply && <Key tone="ghost" label={`Upgrade ${SUPPLY_NAME[os.part]}`} price={{ cost: supply.cost, currency: supply.currency }}
      disabled={!supply.affordable} onPress={() => onAction(supply)} />}
  </>;
}

/* ---------- widgets: port grid, toggle row, choice list ---------- */

export interface PortCell { readonly id: string; readonly label: string; readonly value: string; readonly lit: boolean; readonly dim: boolean; readonly sel: boolean }
export function PortGrid({ cells, onSelect }: { cells: readonly PortCell[]; onSelect: (id: string) => void }) {
  return <div className="cx-grid" role="group" aria-label="Ports">
    {cells.map((c) => <button key={c.id} type="button" className={`cx-cell${c.dim ? ' dim' : ''}${c.sel ? ' sel' : ''}`}
      aria-pressed={c.sel} aria-label={`${c.label}, ${c.value}${c.lit ? ', sending' : ''}`}
      onClick={(e) => { e.stopPropagation(); onSelect(c.id); }}>
      {c.label}<b>{c.value}</b><i className={c.lit ? 'on' : ''} />
    </button>)}
  </div>;
}

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
      <u /><span>{r.label}{r.lock ? <small title={r.lock}><LockIcon /> Locked</small> : r.note ? <small>{r.note}</small> : null}</span>
    </button>)}
  </div>;
}
