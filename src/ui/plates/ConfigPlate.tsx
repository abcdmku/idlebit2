import { useState } from 'react';
import type { Amount, ConfigSource, Quote, UnitRef } from '../../game';
import { UNIT_NOUN } from './copy';
import type { ConfigKind } from './configArt';
import { wholeText } from './format';
import { PlateFrame } from './PlateFrame';
import { QuoteKey } from './widgets';
import type { PlateCommon } from './types';

type AddQuote = Quote & { action: { type: 'addUnit'; source: ConfigSource } };
const isAdd = (q: Quote): q is AddQuote => q.action.type === 'addUnit';
export interface ConfigOptions { barebones: AddQuote[]; copies: AddQuote[]; saved: AddQuote[] }
export function configOptions(quotes: readonly Quote[]): ConfigOptions {
  const adds = quotes.filter(isAdd);
  return { barebones: adds.filter(q => q.action.source.kind === 'barebones'), copies: adds.filter(q => q.action.source.kind === 'copy'), saved: adds.filter(q => q.action.source.kind === 'saved') };
}
export function barebonesText(kind: ConfigKind, q: AddQuote): string {
  const source = q.action.source;
  if (kind === 'system' && source.kind === 'barebones') return source.storageNode ? '1 drive' : '1 core \u00b7 1 cache cell';
  return kind === 'rack' ? '12 server slots' : kind === 'room' ? '16 rack slots' : '1 zone';
}
export function shortfall(price: Amount, credits: Amount | undefined): string | null {
  if (credits === undefined) return null;
  try { const d = BigInt(price) - BigInt(credits); return d > 0n ? wholeText(d) : null; } catch { return null; }
}
export interface ConfigPlateProps extends PlateCommon {
  kind: ConfigKind; title?: string; sub?: string; credits?: Amount; landscape?: boolean;
  nameOf?: ((from: UnitRef) => string) | null;
  drawCopy?: ((from: UnitRef, g: CanvasRenderingContext2D, w: number, h: number) => void) | null;
}
/** One selected build, one component-local purchase. */
export function ConfigPlate({ kind, title, sub, credits: _credits, landscape: _land, drawCopy: _draw, nameOf, quotes, onAction, onClose, onResearch, researchName, bootS: _boot, ...frame }: ConfigPlateProps) {
  const [choice, setChoice] = useState(0), options = quotes?.quotes.filter(isAdd) ?? [];
  const q = options[choice] ?? options[0], noun = UNIT_NOUN[kind];
  const name = (q: AddQuote) => {
    const source = q.action.source;
    return source.kind === 'copy' ? 'Copy ' + (nameOf?.(source.from) ?? q.label) : source.kind === 'saved' ? 'Saved ' + source.name : q.label;
  };
  const gain = q ? '+1 ' + noun.toLowerCase() + (q.action.source.kind === 'barebones' ? ' \u00b7 ' + barebonesText(kind, q) : '') : '';
  return <PlateFrame {...frame} onClose={onClose} title={title ?? 'New ' + noun} sub={sub} className="part config-picker"
    footer={q && <QuoteKey quote={q} label={'Buy ' + noun} detail={gain} onAction={value => { onAction(value.action); onClose(); }} onResearch={onResearch} researchName={researchName} />}>
    <label className="component-picker">Build<select aria-label="Build" value={Math.min(choice, Math.max(0, options.length - 1))} onChange={e => setChoice(Number(e.target.value))}>
      {options.map((q, i) => <option key={i} value={i}>{name(q)}</option>)}
    </select></label>
    {!options.length && <p className="p-line muted">No build available</p>}
  </PlateFrame>;
}
