import type { ReactNode } from 'react';
import { supplyPreparation, supplyResearch, type Amount, type Currency, type Quote, type ResearchId } from '../../game';
import { CoinIcon, GemIcon, LockIcon } from './icons';
import { span, watts, wholeText } from './format';
import { overSupplyText, supplyRequest } from './overSupply';
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
  /** Shown under the key when it cannot be bought. */
  reason?: string | null;
  researchName?: (id: ResearchId) => string;
  onAction: (q: Quote) => void;
  onResearch?: (id: ResearchId) => void;
}
/**
 * A purchase key for one quote. A research lock turns it into a key that opens that research, and it says so
 * ("Research Rack"): a key never names a purchase it does not make (user, 26 Oct).
 */
export function QuoteKey({ quote, label, detail, tone = '', reason, researchName, onAction, onResearch, showSupplyNote = true, ariaLabel }: QuoteKeyProps) {
  const lock = quote.locked;
  if (lock?.code === 'research' && lock.node && onResearch) {
    const node = lock.node, name = researchName?.(node) ?? lock.text.replace(/^Needs /, '').replace(/ research$/, '');
    return <Key tone="locked-action" label={<><LockIcon />{`Research ${name}`}</>}
      ariaLabel={`Research ${name}. ${typeof label === 'string' ? `${label} needs it.` : lock.text}`}
      onPress={() => onResearch(node)} />;
  }
  const cantBuy = Boolean(lock) || !quote.affordable;
  const why = lock ? lock.text : !quote.affordable ? (reason ?? null) : null;
  return <>
    <Key tone={tone} label={label} price={lock ? null : { cost: quote.cost, currency: quote.currency }} detail={detail} ariaLabel={ariaLabel}
      disabled={cantBuy} onPress={() => onAction(quote)} />
    {why && <p className="need">{why}</p>}
    {showSupplyNote && <OverSupplyNote quote={quote} onAction={onAction} />}
  </>;
}

/**
 * A buy that would push a supply past its cap (sim `overSupply`, view watts): "Over the power supply · 64 W → 80 W",
 * and a key that upgrades that supply. Nothing at all when the quote stays under every supply.
 * R17: the warning names the option it belongs to (`scope`), so it never reads as the machine as it is now, and its
 * preparation is a secondary key inside that option, never a competing main key. `prepAbove`: an earlier option
 * on the same plate already carries this very preparation, so this one points to it instead of repeating the key.
 */
export function OverSupplyNote({ quote, onAction, scope, prepAbove = false }: { quote: Quote; onAction: (q: Quote) => void; scope?: string; prepAbove?: boolean }) {
  return quote.overSupply ? <SupplyFix purchase={quote} onAction={onAction} scope={scope} prepAbove={prepAbove} /> : null;
}
/** "With DDR4 · L1: full load 13 kW over the 3.2 kW power supply" (the option's future, not the machine's present). */
export const scopedOverSupplyText = (os: NonNullable<Quote['overSupply']>, scope?: string) => scope
  ? `With ${scope}: ${watts(os.afterW)} at full load, over the ${watts(os.capW)} ${os.part === 'pdu' ? 'PDU' : os.part === 'ups' ? 'UPS' : 'power supply'}`
  : overSupplyText(os);
function SupplyFix({ purchase, onAction, scope, prepAbove }: { purchase: Quote; onAction: (q: Quote) => void; scope?: string; prepAbove: boolean }) {
  const shell = useShell(), os = purchase.overSupply!;
  // Refresh with the same wallet/unlock cadence as purchase quotes. Resolve dependencies from
  // the quoted unit, including an upstream PDU, rather than guessing the focused supply.
  useQuote(supplyRequest(os, shell.store.getSnapshot()));
  const state = shell.store.getState(), supply = supplyPreparation(state, purchase, false);
  const research = !supply ? supplyResearch(state, purchase) : null;
  const slot = supply && (supply.action.type === 'upgradePart' || supply.action.type === 'upgradePartTo' || supply.action.type === 'replacePart')
    ? supply.action.part.slot.kind : os.part;
  const name = slot === 'pdu' ? 'PDU' : slot === 'ups' ? 'UPS' : 'power supply';
  const verb = supply?.action.type === 'replacePart' ? 'Replace' : 'Upgrade';
  return <>
    <p className="need warn power-limit" data-testid="over-supply">{scopedOverSupplyText(os, scope)}</p>
    {prepAbove ? <p className="option-values">Same {name} {verb.toLowerCase()} as above</p> : <>
    {supply && <>
      <p className="option-values">{slot !== os.part ? `First the ${name}: ` : `${name[0]!.toUpperCase()}${name.slice(1)} `}{watts(supply.effect!.capacityBefore)} → {watts(supply.effect!.capacityAfter)}</p>
      {coldText(supply) && <p className="option-cold">{coldText(supply)}</p>}
    </>}
    {research ? <Key tone="locked-action" label="Research power supply"
      onPress={() => shell.view.dispatch({ type: 'openResearch', project: research })} />
      // The preparation is a step toward the option, so it is a secondary key, never the plate's gold one.
      : supply && <Key tone="replace prep" label={`${verb} ${name}`} price={{ cost: supply.cost, currency: supply.currency }}
        ariaLabel={`First ${verb.toLowerCase()} ${name} to ${watts(supply.effect!.capacityAfter)}, ${supply.cost} Credits`}
        disabled={!supply.affordable} onPress={() => onAction(supply)} />}
    </>}
  </>;
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
