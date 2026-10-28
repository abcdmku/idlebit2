// The callout (D15.4, A07): what a tapped part with no plate of its own offers (a rack seen from its room, a
// room on the map): its buy, Open to drill in, and On market. Placed by the plates' rule, never over the part.
import { useEffect, useRef, useState } from 'react';
import type { LevelSnapshot } from '../../game';
import type { HitTarget, Rect } from '../../render/core';
import { useShellOffers } from '../deck/useOffers';
import { offerAction, PriceText, RightText } from '../deck/offerUi';
import type { Offer } from '../deck/offers';
import { plateRequest } from '../plates/PlateLayer';
import { marketKey, marketLine, marketOf, targetUnit } from '../plates/market';
import { box, T, useLayout } from '../shell/geometry';
import { useGameSelector, useQuote, useShell, useViewState } from '../storeHooks';
import { calloutModel } from './model';
import { placePlate } from '../plates/place';

/** On the CPU the callout sits beside the package (Control deck): the cache spans the die, 16 art px in from the package, plus its 3 px frame. */
const PACKAGE_INSET_ART = 19;
/** A10: after a purchase the Buy key ignores taps this long, so the next level isn't bought by a double tap. */
const REARM_MS = 250;
const KEY_H = 48;

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
  if (!t || view.sheet || view.plate || t.kind === 'save' || focus.level !== t.owner.level) return null;
  return <Open key={t.id} target={t} focus={focus} />;
}


function Open({ target: t, focus }: { target: HitTarget; focus: LevelSnapshot }) {
  const L = useLayout(), shell = useShell(), offers = useShellOffers();
  const part = useAnchor(t.id, false, L.N), around = useAnchor(t.id, t.owner.level === 'chip', L.N);
  const request = plateRequest(t, focus);
  const quotes = useQuote(request);
  const m = calloutModel(t, focus, quotes, offers, shell.store.getState());
  const unit = targetUnit(t), market = unit ? marketOf(shell.store.getState(), unit) : null;
  const [bought, setBought] = useState(0), [armed, setArmed] = useState(true), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!part || !around) return null;
  const d = L.kind === 'desktop';
  // The plates' rule (place.ts): never over the tapped part. Desktop docks in the gutter beside it; phone
  // sits below, else above. No leader: it would cross other parts' art (user, 26 Oct).
  const pad = d ? 16 : 8, gap = 8;
  const o = m.offer, act = o ? offerAction(o as Offer) : null;
  const keys: { id: string; label: string; tone: string; disabled?: boolean; pressed?: boolean; run: () => void }[] = [];
  if (market) keys.push({ id: 'market', label: marketKey(market), tone: market.on ? 'go' : 'plain', pressed: market.on,
    run: () => { shell.dispatch({ type: 'setOnline', unit: market.unit, online: !market.on }); } });
  if (o?.quote && !o.where && (o.price !== null || act)) {
    const research = !!act && 'research' in act;
    keys.push({ id: 'buy', label: research ? 'Research' : 'Buy', tone: o.affordable ? 'buy' : act ? 'plain' : 'off', disabled: !act || (!research && !armed),
      run: () => {
        if (!act) return;
        if ('research' in act) { shell.view.dispatch({ type: 'openResearch', project: act.research.node }); return; }
        if (!armed) return;
        if (shell.dispatch(act.action)?.ok) {
          setBought(b => b + 1); setArmed(false);
          clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(true), REARM_MS);
        }
      } });
  }
  const line = m.change || (market ? marketLine(market) : '');
  const h = keys.length ? L.callout.h : 2 * pad + (line ? 2 : 1) * L.lh;
  const p = placePlate(around, L.callout.w, h, L.calloutBounds, { beside: d });
  const at = { x: Math.round(p.x / 8) * 8, y: Math.round(p.y / 8) * 8, w: L.callout.w, h };
  const by = at.h - pad - KEY_H;
  // The market key is wider ("Off market"); the keys beside it narrow so three still fit.
  const keyW = (i: number) => market ? (i === 0 ? 96 : 72) : 80;
  const keyRight = (i: number) => pad + Array.from({ length: i }, (_, j) => keyW(j) + gap).reduce((a, b) => a + b, 0);
  return <>
    <aside className="panel callout" style={box(at)} data-k="callout" data-testid="callout" role="dialog" aria-label={m.name}
      onPointerDown={e => e.stopPropagation()}>
      <T x={pad} y={pad} w={at.w - 2 * pad - (o ? 96 : 0)}><b>{m.name}</b></T>
      <T right={pad} y={pad}>{o?.price != null ? <PriceText offer={o as Offer} n={L.N} />
        : o && !m.research && (o as Offer).right ? <RightText offer={o as Offer} n={L.N} /> : null}</T>
      {line && <T x={pad} y={pad + L.lh} w={at.w - 2 * pad} className={m.research ? 'warn' : 'mute'}>
        <span key={bought} className={bought ? 'flash' : undefined}>{line}</span></T>}
      {keys.map((k, i) => <button key={k.id} type="button" className={`skey ${k.tone}`} data-testid={`callout-${k.id}`} disabled={k.disabled} data-qa-target
        aria-pressed={k.pressed} style={{ right: keyRight(i), top: by, width: keyW(i), height: KEY_H }} onClick={k.run}>{k.label}</button>)}
    </aside>
  </>;
}
