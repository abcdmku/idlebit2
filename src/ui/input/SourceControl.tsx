import { useEffect, useRef } from 'react';
import type { HitTarget, Rect } from '../../render/core';
import { selectResearchTree, type ResearchId } from '../../game';
import { useQuote, useShell } from '../storeHooks';
import { Price } from '../plates/widgets';
import { purchaseReason } from '../plates/purchaseText';
import { sourceAction, sourceRequest, runSourceAction } from './sourceAction';

/** Facts and the purchase are on the hardware. The canvas keeps pointer gestures, including dragging. */
export function SourceControl({ target }: { target: HitTarget }) {
  const shell = useShell(), ref = useRef<HTMLDivElement>(null);
  const focus = shell.store.getSnapshot().focus;
  const result = useQuote(sourceRequest(target, focus));
  const model = sourceAction(target, focus, result?.quotes ?? []);
  useEffect(() => {
    const el = ref.current;
    if (!el || !model) return;
    const sources = shell.surface.sourceActions ??= new Map();
    const source = { target, rect: { x: 0, y: 0, w: 0, h: 0 } };
    const r: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const position = () => {
      const renderer = shell.surface.renderer, L = shell.surface.layout;
      if (!renderer || renderer.transition || !renderer.anchor(target.id, r)) { el.hidden = true; sources.delete(target.id); return; }
      const link = model.kind === 'link', narrow = !link && r.w < 140;
      const w = link ? Math.min(256, L.view.w - 16) : Math.min(r.w, L.view.w - 16);
      const h = model.kind === 'part' && narrow ? 80 : 44;
      const x = Math.max(L.view.x + 8, Math.min(L.view.x + L.view.w - w - 8, link ? r.x + r.w / 2 - w / 2 : r.x));
      const desiredY = link ? r.y - h - 4 : model.kind === 'add' ? r.y + r.h - h : r.y;
      const y = Math.max(L.view.y + 4, Math.min(L.view.y + L.view.h - h - 4, desiredY));
      el.hidden = r.x + r.w < L.view.x || r.x > L.view.x + L.view.w || r.y + r.h < L.view.y || r.y > L.view.y + L.view.h;
      if (el.hidden) sources.delete(target.id);
      else { Object.assign(source.rect, { x, y, w, h }); sources.set(target.id, source); }
      el.dataset.narrow = String(narrow);
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    };
    position(); shell.surface.frameListeners.add(position);
    return () => { sources.delete(target.id); shell.surface.frameListeners.delete(position); };
  }, [shell, target.id, model?.kind]);
  if (!model) return null;
  const q = model.quote, research = q.locked?.code === 'research' ? q.locked.node : null;
  const reason = purchaseReason(q), disabled = !research && !!reason;
  const researchName = (id: ResearchId) =>
    selectResearchTree(shell.store.getState()).nodes.find(n => n.id === id)?.name ?? String(id);
  const cold = q.cold && q.downtimeMs > 0 ? `${Math.ceil(q.downtimeMs / 1000)}s offline` : '';
  const detail = research ? `Research ${researchName(research)}` : disabled ? reason : [model.gain, cold].filter(Boolean).join(' · ');
  const shown = disabled ? q.overSupply || q.locked?.code === 'power' ? 'No power' : !q.affordable && !q.locked ? 'No cash' : detail : detail;
  return <div ref={ref} className={`source-control source-${model.kind}`} data-source-control={target.id}>
    <button type="button" className="source-buy" disabled={disabled} data-source-action={target.id} data-qa-target
      data-purchase-action={!research ? JSON.stringify(q.action) : undefined}
      aria-label={[model.name, detail, !research && `${q.cost} Credits`].filter(Boolean).join('. ')}
      onClick={() => runSourceAction(shell, target)}>
      <span className="source-name">{model.name}</span>
      <span className={`source-gain${disabled ? ' mute' : ''}`} data-qa-label title={detail ?? undefined}>{shown}</span>
      {!research && q.cost !== '0' && <span className="source-price">{!disabled && <span aria-hidden="true">{model.kind === 'add' ? '+' : '↑'} </span>}<Price cost={q.cost} currency={q.currency} /></span>}
    </button>
  </div>;
}
