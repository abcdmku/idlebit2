// The buy a new player needs next, priced on its part. Until the build first changes (`build.revision`), that is the
// cheapest upgrade; while the head task is blocked by a part of this CPU, it is the upgrade that unblocks it (the sim's
// meet quote, as the task detail's fix key). Real state both ways: the quoted price, dim until the wallet meets it.
// Taps stay with the part.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { HitTarget, Rect } from '../../render/core';
import type { Quote } from '../../game';
import { meetNeed, meetSystem } from '../queue/meet';
import { shallowEqual, useGameSelector, useQuote, useShell } from '../storeHooks';
import { Price, quotePrice } from '../plates/widgets';

const cheaper = (a: Quote, b: Quote) => (BigInt(a.cost) <= BigInt(b.cost) ? a : b);
const partKind = (q: Quote | null | undefined) => (q && 'part' in q.action ? q.action.part.slot.kind : null);

export function FirstBuy({ targets }: { targets: readonly HitTarget[] }) {
  const shell = useShell(), ref = useRef<HTMLSpanElement>(null);
  const untouched = useSyncExternalStore(shell.store.subscribe, () => shell.store.getState().build.revision === 0);
  const owner = targets[0]?.owner ?? null, chip = owner?.level === 'chip';
  const quotes = useQuote(untouched && chip ? { kind: 'tray', at: owner } : null)?.quotes ?? [];
  const steps = quotes.filter(q => q.action.type === 'upgradePart' && !q.locked && q.currency === 'credits' && BigInt(q.cost) > 0n);
  // The blocked head's gates, as the task detail reads them; null while the head can run or no round is running.
  const need = useGameSelector(s => {
    const h = s.feed.window[0];
    return chip && h?.blockedBy && s.round.state === 'running' ? { need: meetNeed(h), system: meetSystem(s) } : null;
  }, (a, b) => a === b || (!!a && !!b && a.system === b.system && shallowEqual(a.need, b.need)), 250);
  const fix = (useQuote(need?.need ? { kind: 'meet', system: need.system, need: need.need } : null)?.quotes ?? [])
    .find(q => !q.locked && partKind(q) !== null) ?? null;
  const quote = fix ?? (steps.length ? steps.reduce(cheaper) : null);
  const kind = partKind(quote);
  const target = kind ? targets.find(t => t.kind === 'part' && t.part?.slot.kind === kind) : null;
  const id = target?.id;
  useEffect(() => {
    const el = ref.current;
    if (!el || !id || !target) return;
    const r: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const position = () => {
      const renderer = shell.surface.renderer, L = shell.surface.layout;
      el.hidden = !renderer || !!renderer.transition || !renderer.anchor(id, r);
      // The right end of the part, where its own label and meter never reach; a part too narrow for both keeps its label.
      if (!el.hidden && r.w < el.offsetWidth + 144) el.style.visibility = 'hidden';
      else if (!el.hidden) el.style.visibility = '';
      // The cache's meter occupies its lower half. Share the heading's snapped text row above it.
      const scale = r.w / target.rect.w;
      const top = id === 'cache' ? L.view.y + Math.round((r.y + 3 * scale - L.view.y) / 8) * 8 : r.y + (r.h - L.lh) / 2;
      if (!el.hidden) Object.assign(el.style, { left: `${Math.round(r.x + r.w - el.offsetWidth - 16)}px`, top: `${Math.round(top)}px` });
    };
    position(); shell.surface.frameListeners.add(position);
    return () => { shell.surface.frameListeners.delete(position); };
  }, [shell, id, target, quote?.cost]);
  if (!quote || !id) return null;
  return <span ref={ref} className={`first-buy${quote.affordable ? '' : ' short'}`} data-testid="first-buy" hidden>
    Upgrade <Price {...quotePrice(quote)} affordable={quote.affordable} />
  </span>;
}
