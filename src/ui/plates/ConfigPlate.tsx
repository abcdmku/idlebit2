import type { Amount, ConfigSource, Quote, UnitRef } from '../../game';
import { UNIT_NOUN } from './copy';
import type { ConfigKind } from './configArt';
import { PlateFrame } from './PlateFrame';
import { QuoteKey } from './widgets';
import type { PlateCommon } from './types';

type AddQuote = Quote & { action: { type: 'addUnit'; source: ConfigSource } };
const isAdd = (q: Quote): q is AddQuote => q.action.type === 'addUnit';

/** What a barebones build holds (spec §13.2). */
function barebonesText(kind: ConfigKind, source: ConfigSource & { kind: 'barebones' }): string {
  if (kind === 'system') return source.storageNode ? '1 drive' : '1 core · 1 cache cell';
  return kind === 'rack' ? '12 server slots' : kind === 'room' ? '16 rack slots' : '1 zone';
}

/** A build over a ceiling (spec §13.3): the sim's lock says only "Max", which on a build reads as nothing. */
const fits = (q: AddQuote): AddQuote => q.locked?.code === 'ceiling' && q.locked.text === 'Max'
  ? { ...q, locked: { ...q.locked, text: 'A part is over its max level' } } : q;

export interface ConfigPlateProps extends PlateCommon {
  kind: ConfigKind; title?: string; sub?: string; credits?: Amount; landscape?: boolean;
  nameOf?: ((from: UnitRef) => string) | null;
  drawCopy?: ((from: UnitRef, g: CanvasRenderingContext2D, w: number, h: number) => void) | null;
}

/**
 * The add-new plate (spec §13.2): every barebones, copy and saved build as its own priced key. Opening the plate
 * never spends; one tap on a build buys it and closes. A build that cannot be bought says why on its key.
 */
export function ConfigPlate({ kind, title, sub, credits: _credits, landscape: _land, drawCopy: _draw, nameOf, quotes, onAction, onClose, onResearch, researchName, bootS: _boot, ...frame }: ConfigPlateProps) {
  const options = quotes?.quotes.filter(isAdd) ?? [], noun = UNIT_NOUN[kind];
  const row = (q: AddQuote): { label: string; detail: string } => {
    const source = q.action.source;
    if (source.kind === 'copy') return { label: `Copy of ${nameOf?.(source.from) ?? q.label}`, detail: '' };
    if (source.kind === 'saved') return { label: source.name, detail: 'Saved build' };
    const plainSystem = kind === 'system' && !source.storageNode && (source.board ?? 'general') === 'general';
    return { label: plainSystem ? `${q.label} CPU` : q.label.replace(/^Barebones .*/, 'Barebones'), detail: barebonesText(kind, source) };
  };
  return <PlateFrame {...frame} onClose={onClose} title={title ?? 'New ' + noun} sub={sub} className="part config-picker">
    {options.length ? <div className="build-options" role="group" aria-label={`Builds for a new ${noun}`}>
      {options.map((q, i) => <QuoteKey key={i} quote={fits(q)} tone="replace" {...row(q)} onAction={value => { onAction(value.action); onClose(); }}
        onResearch={onResearch} researchName={researchName} />)}
    </div> : <p className="p-line muted">No build available</p>}
  </PlateFrame>;
}
