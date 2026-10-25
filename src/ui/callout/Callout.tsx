// The upgrade callout (D15.4, A07): tapping a part in the world opens it. On desktop it docks in the
// world's right gutter, level with the part; on phone it sits above or below the part. A leader joins
// it to the part. "x → x", price, Buy; Open drills into a unit; More opens the part's full plate.
import { useEffect, useRef, useState } from 'react';
import type { LevelSnapshot } from '../../game';
import type { HitTarget, Rect } from '../../render/core';
import { useShellOffers } from '../deck/useOffers';
import { offerAction, PriceText, RightText } from '../deck/offerUi';
import type { Offer } from '../deck/offers';
import { plateRequest } from '../plates/PlateLayer';
import { box, T, useLayout } from '../shell/geometry';
import { useGameSelector, useQuote, useShell, useViewState } from '../storeHooks';
import { calloutModel, dockCallout, leaderRect, placeCallout, placePhone } from './model';

/** On the CPU the callout sits beside the package (L2): the cache spans the die, 16 art px in from the package, plus its 3 px frame. */
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
  if (!t || view.plate || t.kind === 'save' || focus.level !== t.owner.level) return null;
  return <Open key={t.id} target={t} focus={focus} />;
}

/** The target has a plate to open (the global scheduler has none until it is installed, A23). */
function hasPlate(t: HitTarget, focus: LevelSnapshot): boolean {
  if (t.part?.slot.kind === 'globalScheduler') return focus.level === 'global' && !!focus.scheduler;
  return !!plateRequest(t, focus) || t.kind === 'unit';
}

function Open({ target: t, focus }: { target: HitTarget; focus: LevelSnapshot }) {
  const L = useLayout(), shell = useShell(), offers = useShellOffers();
  // The part itself, not the package: the leader points at what was tapped.
  const part = useAnchor(t.id, false, L.N), around = useAnchor(t.id, t.owner.level === 'chip', L.N);
  const request = plateRequest(t, focus);
  const quotes = useQuote(request);
  const m = calloutModel(t, focus, quotes, offers);
  const [bought, setBought] = useState(0), [armed, setArmed] = useState(true), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!part || !around) return null;
  const d = L.kind === 'desktop';
  // The renderer keeps the right gutter clear on desktop; a part that reaches into it falls back to beside-it placement.
  const dock = d ? dockCallout(part, L.callout, L.calloutBounds) : null;
  // Phone: below the part, else above, else docked above the head card; always from the part's own rect.
  const at = !d ? placePhone(part, L.callout, L.calloutBounds)
    : dock && dock.x >= part.x + part.w ? dock : placeCallout(around, L.callout, L.calloutBounds, L.lat);
  const leader = leaderRect(part, at, L.N);
  const pad = d ? 16 : 8, bw = 80, gap = 8, by = at.h - pad - KEY_H;
  const o = m.offer, act = o ? offerAction(o as Offer) : null;
  const keys: { id: string; label: string; tone: string; disabled?: boolean; run: () => void }[] = [];
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
  if (m.drill) { const ref = m.drill; keys.push({ id: 'open', label: 'Open', tone: 'plain', run: () => shell.view.dispatch({ type: 'drill', ref }) }); }
  if (hasPlate(t, focus)) keys.push({ id: 'more', label: 'More', tone: 'plain', run: () => shell.view.dispatch({ type: 'openPlate' }) });
  return <>
    {leader && <i className="leader" data-free="art" aria-hidden="true" style={box(leader)} />}
    <aside className="panel callout" style={box(at)} data-k="callout" data-testid="callout" role="dialog" aria-label={m.name}
      onPointerDown={e => e.stopPropagation()}>
      <T x={pad} y={pad} w={at.w - 2 * pad - 96}><b>{m.name}</b></T>
      <T right={pad} y={pad}>{o?.price != null ? <PriceText offer={o as Offer} n={L.N} />
        : o && !m.research && (o as Offer).right ? <RightText offer={o as Offer} n={L.N} /> : null}</T>
      <T x={pad} y={pad + L.lh} w={at.w - 2 * pad} className={m.research ? 'warn' : 'mute'}>
        <span key={bought} className={bought ? 'flash' : undefined}>{m.change}</span></T>
      {keys.map((k, i) => <button key={k.id} type="button" className={`skey ${k.tone}`} data-testid={`callout-${k.id}`} disabled={k.disabled} data-qa-target
        style={{ right: pad + i * (bw + gap), top: by, width: bw, height: KEY_H }} onClick={k.run}>{k.label}</button>)}
    </aside>
  </>;
}
