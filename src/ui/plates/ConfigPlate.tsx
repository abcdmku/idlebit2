import { useEffect, useRef, type ReactNode } from 'react';
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

/**
 * What a barebones build holds, read from the configurations it installs (configModel, defaults): a server's
 * CPU tier with one core and 1 cache cell on a power supply; a rack, zone or site with its own infrastructure.
 */
export function barebonesText(kind: ConfigKind, q: AddQuote): string {
  const s = q.action.source;
  if (kind === 'system' && s.kind === 'barebones') {
    if (s.storageNode) return 'One drive and a power supply. No CPU.';
    if (s.board === 'accelerator') return '1 core, 1 cache cell, power supply. GPU bays empty.';
    return '1 core, 1 cache cell, power supply. No RAM or storage.';
  }
  if (kind === 'rack') return 'Cooling, PDU, load balancer, 4-port switch. No servers.';
  if (kind === 'room') return '2 rack rows, cooling, UPS, network rack. No racks.';
  return 'Grid supply, data plane, one empty zone.';
}

/** A barebones tile's short name: the CPU tier for a server, else "Empty rack" (the section already says Barebones). */
function tileName(kind: ConfigKind, q: AddQuote): string {
  const s = q.action.source;
  if (s.kind !== 'barebones') return q.label;
  if (kind !== 'system') return `Empty ${UNIT_NOUN[kind]}`;
  return s.storageNode ? 'Storage node' : q.label;
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
  /** A copy's world name ("Rack A", "Zone A", "US East"); the sim's label otherwise. */
  nameOf?: ((from: UnitRef) => string) | null;
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

/** A tile's difference from the plain barebones server, shown under its name. */
function tileNote(kind: ConfigKind, q: AddQuote): string | null {
  const s = q.action.source;
  if (kind !== 'system' || s.kind !== 'barebones') return null;
  return s.storageNode ? 'One drive, no CPU' : s.board === 'accelerator' ? 'GPU bays empty' : null;
}

/**
 * Configuration plate: the one way to add a server, rack, zone or site (program §11). Every option is its own
 * priced key (user, 26 Oct: one tap opens the slot, the second builds): barebones tiers under one line saying
 * what a barebones holds, copies by their world names, saved names. A supply the builds would overload is said
 * once, with its fix, above them.
 */
export function ConfigPlate({ kind, title, sub, credits: _c, landscape, drawCopy, nameOf, quotes, onAction, onClose, onResearch, researchName, bootS: _b, ...frame }: ConfigPlateProps) {
  const noun = UNIT_NOUN[kind];
  const opts = configOptions(quotes?.quotes ?? []);
  // Every copy and saved build is its own tile in the scrolling body: none waits behind a More (user, 26 Oct).
  const [mw, mh] = MINI_SIZE[kind], namedCopies = kind === 'room' || kind === 'site';
  const all = [...opts.barebones, ...opts.copies, ...opts.saved], over = all.find(q => q.overSupply && !q.locked);
  const plain = opts.barebones.find(q => q.action.source.kind === 'barebones' && !q.action.source.board && !q.action.source.storageNode) ?? opts.barebones[0];

  const name = (q: AddQuote) => q.action.source.kind === 'copy' && nameOf ? nameOf(q.action.source.from) : tileName(kind, q);
  const press = (q: AddQuote) => {
    const lock = q.locked;
    if (lock?.code === 'research' && lock.node) { onResearch?.(lock.node); return; }
    if (!lock && q.affordable) { onAction(q.action); onClose(); }
  };
  const option = (q: AddQuote, cls: string, art: ReactNode) => {
    const lock = q.locked, research = lock?.code === 'research' && lock.node ? researchName?.(lock.node) ?? lock.text : null, note = tileNote(kind, q);
    return <button key={JSON.stringify(q.action.source)} type="button" className={`cfg-opt ${cls}${lock ? ' lock' : ''}${q.overSupply ? ' over' : ''}`}
      disabled={!research && (!!lock || !q.affordable)}
      aria-label={research ? `${name(q)}: research ${research}` : `Add ${name(q)}, ${lock ? lock.text : `${q.cost} Credits`}${q.overSupply ? ', over the supply at full load' : ''}`}
      onClick={() => press(q)}>
      {art}
      <span className="nm">{name(q)}</span>
      {note && <span className="nt">{note}</span>}
      <span className="pr">{research ? <span className="lk"><LockIcon /></span> : lock ? <span className="lk"><LockIcon /> {lock.text}</span>
        : <span className={q.affordable ? '' : 'price-short'}><Price cost={q.cost} /></span>}</span>
    </button>;
  };

  return <PlateFrame {...frame} closeKey onClose={onClose} title={title ?? `New ${noun}`} sub={sub} className="cfg">
    {over && <OverSupplyNote quote={over} onAction={q => onAction(q.action)} />}
    <div className="cfg-sec tiers"><span className="cfg-lab">Barebones</span>
      {plain && <p className="cfg-detail">{barebonesText(kind, plain)}</p>}
      <div className="cfg-row">
        {opts.barebones.map((q) => option(q, 'tier', <Canvas w={16} h={12} className="ic"
          draw={(g) => drawTierIcon(g, kind, q.action.source.kind === 'barebones' ? 0 : 0, Boolean(q.locked))} />))}
      </div></div>
    {opts.copies.length > 0 && <div className="cfg-sec copies"><span className="cfg-lab">{COPY_FROM[kind]}</span>
      {/* No level draws a zone or site mini, so those copies are named tiles, not empty wells. */}
      <div className={`cfg-row${namedCopies ? ' named-row' : ''}`}>
        {namedCopies ? opts.copies.map((q) => option(q, 'named', null))
          : opts.copies.map((q) => option(q, 'copy', <Canvas w={mw} h={mh} className="ic" draw={(g) => {
            g.fillStyle = '#0e0b1c'; g.fillRect(0, 0, mw, mh);
            if (drawCopy && q.action.source.kind === 'copy') drawCopy(q.action.source.from, g, mw, mh);
          }} />))}
      </div></div>}
    {opts.saved.length > 0 && <div className="cfg-sec saved"><span className="cfg-lab">Saved</span>
      <div className="cfg-row">
        {opts.saved.map((q) => option(q, 'named', null))}
      </div></div>}
  </PlateFrame>;
}
