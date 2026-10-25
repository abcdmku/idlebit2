// The upgrade callout (D15.4): tapping a part in the world opens it beside the part, never over it.
// "x → x", price, Buy; Open drills into a unit; More opens the part's full plate.
import { useEffect, useState } from 'react';
import type { LevelSnapshot } from '../../game';
import type { HitTarget, Rect } from '../../render/core';
import { useShellOffers } from '../deck/useOffers';
import { lockWord, offerAction, PriceText } from '../deck/offerUi';
import type { Offer } from '../deck/offers';
import { plateRequest } from '../plates/PlateLayer';
import { box, T, useLayout } from '../shell/geometry';
import { useGameSelector, useQuote, useShell, useViewState } from '../storeHooks';
import { calloutModel, placeCallout } from './model';

/** On the CPU the callout sits beside the package (L2): the cache spans the die, 16 art px in from the package, plus its 3 px frame. */
const PACKAGE_INSET_ART = 19;

/** The target's rect on the stage, following the camera (rack scroll, resize). Null while hidden. */
function useAnchor(id: string, chip: boolean, n: number): Rect | null {
  const { surface } = useShell();
  const [at, setAt] = useState<Rect | null>(null);
  useEffect(() => {
    const out: Rect = { x: 0, y: 0, w: 0, h: 0 }, die: Rect = { x: 0, y: 0, w: 0, h: 0 };
    let last = '';
    const read = () => {
      const r = surface.renderer;
      const ok = !!r && !r.transition && r.anchor(id, out);
      if (ok && chip && r.anchor('cache', die)) { out.x = die.x - PACKAGE_INSET_ART * n; out.w = die.w + 2 * PACKAGE_INSET_ART * n; }
      const key = ok ? `${out.x},${out.y},${out.w},${out.h}` : '';
      if (key !== last) { last = key; setAt(ok ? { ...out } : null); }
    };
    read();
    surface.frameListeners.add(read);
    return () => { surface.frameListeners.delete(read); };
  }, [surface, id, chip, n]);
  return at;
}

export function Callout() {
  const view = useViewState(), focus = useGameSelector(s => s.focus);
  const t = view.selected;
  if (!t || view.plate || t.kind === 'save' || focus.level !== t.owner.level) return null;
  return <Open key={t.id} target={t} focus={focus} />;
}

function Open({ target: t, focus }: { target: HitTarget; focus: LevelSnapshot }) {
  const L = useLayout(), shell = useShell(), offers = useShellOffers();
  const anchor = useAnchor(t.id, t.owner.level === 'chip', L.N);
  const request = plateRequest(t, focus);
  const quotes = useQuote(request);
  const m = calloutModel(t, focus, quotes, offers);
  if (!anchor) return null;
  const c = placeCallout(anchor, L.callout, L.calloutBounds, L.lat);
  // Phone and compact desktop: keys at least 44 px tall (48 on the grid).
  const big = L.N === 3, pad = big ? 16 : 8, bw = big ? 72 : 56, bh = big ? 24 : 48, by = big ? 64 : 48, gap = 8;
  const o = m.offer, act = o ? offerAction(o as Offer) : null;
  const keys: { id: string; label: string; tone: string; disabled?: boolean; run: () => void }[] = [];
  if (o?.quote && !o.where && (o.price !== null || act)) {
    keys.push({ id: 'buy', label: act && 'research' in act ? 'Research' : 'Buy', tone: o.affordable ? 'buy' : act ? 'plain' : 'off', disabled: !act,
      run: () => { if (!act) return; if ('action' in act) shell.dispatch(act.action); else shell.view.dispatch({ type: 'openResearch', project: act.research.node }); } });
  }
  if (m.drill) { const ref = m.drill; keys.push({ id: 'open', label: 'Open', tone: 'plain', run: () => shell.view.dispatch({ type: 'drill', ref }) }); }
  if (request || t.kind === 'unit') keys.push({ id: 'more', label: 'More', tone: 'plain', run: () => shell.view.dispatch({ type: 'openPlate' }) });
  return <aside className="panel callout" style={box(c)} data-k="callout" data-testid="callout" role="dialog" aria-label={m.name}
    onPointerDown={e => e.stopPropagation()}>
    <T x={pad} y={pad} w={c.w - 2 * pad - 80}><b>{m.name}</b></T>
    <T right={pad} y={pad}>{o?.price != null ? <PriceText offer={o as Offer} n={L.N} /> : o?.lock ? <span className="dim">{lockWord(o as Offer)}</span> : null}</T>
    <T x={pad} y={pad + L.lh} w={c.w - 2 * pad} className="mute">{m.change}</T>
    {keys.map((k, i) => <button key={k.id} type="button" className={`skey ${k.tone}`} data-testid={`callout-${k.id}`} disabled={k.disabled} data-qa-target={big ? undefined : ''}
      style={{ right: pad + i * (bw + gap), top: by, width: bw, height: bh, lineHeight: `${bh}px` }}
      onClick={k.run}>{k.label}</button>)}
  </aside>;
}
