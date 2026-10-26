import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Amount, ConfigSource, Quote, UnitRef } from '../../game';
import { COPY_FROM, UNIT_NOUN } from './copy';
import { drawTierIcon, MINI_SIZE, type ConfigKind } from './configArt';
import { wholeText } from './format';
import { LockIcon } from './icons';
import { PlateFrame } from './PlateFrame';
import { Price, OverSupplyNote } from './widgets';
import type { PlateCommon } from './types';

type AddQuote = Quote & { action: { type: 'addUnit'; source: ConfigSource } };
const isAdd = (q: Quote): q is AddQuote => q.action.type === 'addUnit';
const sameAction = (a: AddQuote, b: AddQuote) => JSON.stringify(a.action.source) === JSON.stringify(b.action.source);

export interface ConfigOptions { barebones: AddQuote[]; copies: AddQuote[]; saved: AddQuote[] }
/** Splits the add-unit quotes into the plate's three rows, in quote order. */
export function configOptions(quotes: readonly Quote[]): ConfigOptions {
  const adds = quotes.filter(isAdd);
  return {
    barebones: adds.filter((q) => q.action.source.kind === 'barebones'),
    copies: adds.filter((q) => q.action.source.kind === 'copy'),
    saved: adds.filter((q) => q.action.source.kind === 'saved'),
  };
}

/** Credits still missing for a price, or null when affordable or unknown. */
export function shortfall(price: Amount, credits: Amount | undefined): string | null {
  if (credits === undefined) return null;
  try { const d = BigInt(price) - BigInt(credits); return d > 0n ? wholeText(d) : null; } catch { return null; }
}

export interface ConfigPlateProps extends PlateCommon {
  kind: ConfigKind;
  title?: string;
  sub?: string;
  /** Wallet Credits, for "N more Credits". */
  credits?: Amount;
  landscape?: boolean;
  /** Draws a live mini of a unit to copy (renderer art). Optional: wells stay plain without it. */
  drawCopy?: ((from: UnitRef, g: CanvasRenderingContext2D, w: number, h: number) => void) | null;
}

function Canvas({ w, h, className, draw }: { w: number; h: number; className: string; draw: (g: CanvasRenderingContext2D) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext('2d');
    if (g) { g.imageSmoothingEnabled = false; draw(g); }
  });
  return <canvas ref={ref} className={className} width={w} height={h} aria-hidden="true" />;
}

const CopyPer = 3;
function usePager<T>(list: readonly T[], per: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(list.length / per)), p = page % pages;
  return { slice: list.slice(p * per, p * per + per), pages, page: p, next: () => setPage(p + 1) };
}

/**
 * Configuration plate: the one way to add a server, rack, zone or site (program §11). Three rows of
 * option wells (barebones tiers, copies, saved names), one detail line and one buy key. Every row
 * keeps its height whether it holds four options or none.
 */
export function ConfigPlate({ kind, title, sub, credits, landscape, drawCopy, quotes, onAction, onClose, onResearch: _r, researchName: _n, bootS: _b, ...frame }: ConfigPlateProps) {
  const noun = UNIT_NOUN[kind];
  const opts = configOptions(quotes?.quotes ?? []);
  const [pick, setPick] = useState<AddQuote | null>(null);
  // Re-read the pick from the latest quotes so affordability follows the wallet.
  const chosen = pick ? [...opts.barebones, ...opts.copies, ...opts.saved].find((q) => sameAction(q, pick)) ?? null : null;
  const copies = usePager(opts.copies, CopyPer), saved = usePager(opts.saved, landscape ? 2 : 4);
  const [mw, mh] = MINI_SIZE[kind];

  const option = (q: AddQuote, cls: string, art: ReactNode) =>
    <button key={JSON.stringify(q.action.source)} type="button" className={`cfg-opt ${cls}${q.locked ? ' lock' : ''}`}
      aria-pressed={chosen != null && sameAction(chosen, q)}
      aria-label={`${q.label}, ${q.locked ? `locked: ${q.locked.text}` : `${wholeText(q.cost)} Credits`}`}
      onClick={() => setPick(q)}>
      {art}
      <span className="nm">{q.label}</span>
      <span className="pr">{q.locked ? <span className="lk"><LockIcon /> Locked</span> : <Price cost={q.cost} />}</span>
    </button>;
  const more = (pg: { pages: number; page: number; next: () => void }) => pg.pages > 1 &&
    <button type="button" className="cfg-opt more" onClick={pg.next}><span className="nm">More</span><span className="pr">{pg.page + 1} / {pg.pages}</span></button>;

  const what = !chosen ? '' : chosen.action.source.kind === 'barebones' ? `${chosen.label} barebones`
    : chosen.action.source.kind === 'copy' ? `Copy of ${chosen.label}` : `“${chosen.label}”`;
  const short = chosen && !chosen.locked && !chosen.affordable ? shortfall(chosen.cost, credits) : null;
  const detail = !chosen ? 'Pick a starting point. Prices include every part.'
    : chosen.locked ? `${what} · ${chosen.locked.text}`
    : short ? `${what} · ${short} more Credits`
    : !chosen.affordable ? `${what} · Needs more Credits`
    : `${what} · ${chosen.action.source.kind === 'barebones' ? `${chosen.label} CPU at level 1, base cache. Nothing else.` : 'Total price, every part included'}`;
  const canBuy = Boolean(chosen && !chosen.locked && chosen.affordable);

  return <PlateFrame {...frame} closeKey onClose={onClose} title={title ?? `New ${noun}`} sub={sub} className="cfg">
    <div className="cfg-sec tiers"><span className="cfg-lab">Barebones</span>
      <div className="cfg-row">
        {opts.barebones.slice(0, 4).map((q) => option(q, 'tier', <Canvas w={16} h={12} className="ic"
          draw={(g) => drawTierIcon(g, kind, q.action.source.kind === 'barebones' ? q.action.source.tier : 0, Boolean(q.locked))} />))}
      </div></div>
    <div className="cfg-sec copies"><span className="cfg-lab">{COPY_FROM[kind]}</span>
      <div className="cfg-row">
        {opts.copies.length === 0 ? <p className="cfg-empty">No other {noun}s yet</p>
          : copies.slice.map((q) => option(q, 'copy', <Canvas w={mw} h={mh} className="ic" draw={(g) => {
            g.fillStyle = '#0e0b1c'; g.fillRect(0, 0, mw, mh);
            if (drawCopy && q.action.source.kind === 'copy') drawCopy(q.action.source.from, g, mw, mh);
          }} />))}
        {more(copies)}
      </div></div>
    <div className="cfg-sec saved"><span className="cfg-lab">Saved</span>
      <div className="cfg-row">
        {opts.saved.length === 0 ? <p className="cfg-empty">Save a {noun} with its floppy icon to reuse it here</p>
          : saved.slice.map((q) => option(q, 'named', null))}
        {more(saved)}
      </div></div>
    <p className={`cfg-detail${chosen && (chosen.locked || !chosen.affordable) ? ' warn' : ''}`} aria-live="polite">{detail}</p>
    <div className="keys">
      <button type="button" className="key buy" disabled={!canBuy}
        onClick={() => { if (chosen && canBuy) { onAction(chosen.action); onClose(); } }}>
        <span className="kl">{chosen?.locked ? 'Locked' : `Add ${noun}`}</span>
        {chosen && !chosen.locked && <Price cost={chosen.cost} />}
      </button>
      {chosen && <OverSupplyNote quote={chosen} onAction={q => onAction(q.action)} />}
    </div>
  </PlateFrame>;
}
