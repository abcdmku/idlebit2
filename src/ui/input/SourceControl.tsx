import { useEffect, useRef } from 'react';
import type { HitTarget, Rect } from '../../render/core';
import { selectResearchTree, type ResearchId } from '../../game';
import { useQuote, useShell } from '../storeHooks';
import { Price } from '../plates/widgets';
import { purchaseReason } from '../plates/purchaseText';
import { sourceAction, sourceExtraRequest, sourceRequest, runSourceAction } from './sourceAction';

/** Text and chip padding of an add's tag, and the gap between its name and price. */
const TAG_PAD = 12, TAG_GAP = 8, TAG_H = 20;

/** Facts and the purchase are on the hardware. The canvas keeps pointer gestures, including dragging. */
export function SourceControl({ target }: { target: HitTarget }) {
  const shell = useShell(), ref = useRef<HTMLDivElement>(null);
  const focus = shell.store.getSnapshot().focus;
  const result = useQuote(sourceRequest(target, focus)), extra = useQuote(sourceExtraRequest(target, focus));
  const model = sourceAction(target, focus, extra ? [...result?.quotes ?? [], ...extra.quotes] : result?.quotes ?? []);
  const socket = /^add:cpu\d+$/.test(target.id), compute = socket || target.id === 'add:core';
  const foot = focus.level === 'global';
  // The World's closed regions share one plate (phone list) or legend (desktop grid): it says what opens them, once.
  const group = target.id === 'locked';
  const board = focus.level === 'system';
  const textKey = model ? `${model.name}|${model.quote.cost}|${model.choice}|${model.quote.locked?.code ?? ''}` : '';
  useEffect(() => {
    const el = ref.current;
    if (!el || !model) return;
    const sources = shell.surface.sourceActions ??= new Map();
    const source = { target, rect: { x: 0, y: 0, w: 0, h: 0 } };
    // One label per site: this control claims its target while it is shown, and the level then draws none there.
    // The renderer redraws at once on a change, so the canvas and this element agree in every painted frame.
    const claim = (on: boolean) => {
      if (on) sources.set(target.id, source); else sources.delete(target.id);
      shell.surface.renderer?.claim(target.id, on);
    };
    const r: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const nameEl = el.querySelector<HTMLElement>('.source-name'), priceEl = el.querySelector<HTMLElement>('.source-price');
    // The add's text widths, measured once per wording (the short compute names have their own).
    const need = new Map<string, readonly [number, number, number]>();
    let flatNeed: number | null = null, fullName: number | null = null;
    const position = () => {
      const renderer = shell.surface.renderer, L = shell.surface.layout;
      if (!renderer || renderer.transition || !renderer.anchor(target.id, r)) { el.hidden = true; claim(false); return; }
      const link = model.kind === 'link', add = model.kind === 'add', narrow = !link && !add && r.w < 140;
      // A part shorter than a key (a rack bay) keeps the 44 px target centred on it and shows one line.
      const flat = model.kind === 'part' && r.h < 40;
      const tight = compute && r.w < 64;
      // A core or socket site that cannot hold its full name 2 px clear of each edge wears the short one, so no text
      // touches or crosses the site's dotted edge.
      const brief = tight || compute && fullName !== null && fullName + 4 > r.w;
      const w = link ? Math.min(256, L.view.w - 16) : add ? Math.max(44, r.w) : Math.min(r.w, L.view.w - 16);
      // An empty site is its own key: the whole site, with what it adds and the price centred in it.
      const h = add ? Math.max(44, r.h) : model.kind === 'part' && narrow ? 80 : 44;
      const desiredX = link ? r.x + r.w / 2 - w / 2 : r.x + (r.w - w) / 2, desiredY = link ? r.y - h - 4 : group ? r.y : add || flat ? r.y + (r.h - h) / 2 : r.y;
      // An empty site's text stays on the site: panned half out of view it goes with it, never onto a neighbour.
      const x = add ? desiredX : Math.max(L.view.x + 8, Math.min(L.view.x + L.view.w - w - 8, desiredX));
      const y = add ? desiredY : Math.max(L.view.y + 4, Math.min(L.view.y + L.view.h - h - 4, desiredY));
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      el.hidden = (!add && r.w < 44)
        || (add && !group ? cx < L.view.x || cx > L.view.x + L.view.w || cy < L.view.y || cy > L.view.y + L.view.h
          : r.x + r.w < L.view.x || r.x > L.view.x + L.view.w || r.y + r.h < L.view.y || r.y > L.view.y + L.view.h);
      if (el.hidden) { claim(false); return; }
      Object.assign(source.rect, { x, y, w, h }); claim(true);
      el.dataset.narrow = String(narrow);
      el.dataset.tight = String(tight);
      el.dataset.brief = String(brief);
      el.dataset.flat = String(flat);
      // The bay's own band inside the centred target.
      if (flat) {
        el.style.setProperty('--bay-top', `${Math.round(r.y - y)}px`); el.style.setProperty('--bay-h', `${Math.round(r.h)}px`);
        // One line holds the name and price; the gain joins them only when it fits whole.
        flatNeed ??= (nameEl?.offsetWidth ?? 0) + (priceEl?.offsetWidth ?? 0) + (el.querySelector<HTMLElement>('.source-gain')?.scrollWidth ?? 0) + 32;
        el.dataset.gain = String(flatNeed <= w);
      }
      if (group) {
        el.dataset.mode = 'head';
        // The head line: the grid's legend is all head; the list's plate has it (24 px) over its region lines.
        el.style.setProperty('--head-y', `${Math.max(0, Math.round(((L.kind === 'desktop' ? r.h : 24) - L.lh) / 2))}px`);
      } else if (add) {
        const wording = `${tight}|${brief}`;
        let widths = need.get(wording);
        if (!widths && el.dataset.mode) {
          need.set(wording, widths = [nameEl?.offsetWidth ?? 0, priceEl?.offsetWidth ?? 0, priceEl?.querySelector<HTMLElement>('.pz')?.offsetWidth ?? 0]);
          if (!brief) fullName = widths[0];
        }
        const [nameW, priceW, figureW] = widths ?? [0, 0, 0];
        // In the site when its text fits: name over price ("from" on its own line in a narrow site that draws no mark
        // of its own), or one line in a flat site. Otherwise a tag just outside it.
        // A map pad too narrow for "from" beside its figure keeps the name over the figure alone.
        // So does a board plate where "from" would bring the price within 6 px of the plate's edges (the memory column at 320).
        const bare = model.choice && r.h >= 34 && (foot ? Math.max(nameW, priceW) + 2 > r.w && r.h < 48 && Math.max(nameW, figureW) + 2 <= r.w
          : board && !compute && Math.max(nameW, priceW) + 12 > r.w && Math.max(nameW, figureW) + 12 <= r.w);
        el.dataset.from = String(!bare);
        // A bay too flat for two clear lines (a rack unit at 3) reads on one where that fits.
        const row = nameW + priceW + TAG_GAP + 16 <= r.w && r.h >= 16, flatBay = row && r.h < 44 && !compute && !foot;
        const mode = bare || Math.max(nameW, priceW) + (compute ? 0 : 2) <= r.w && r.h >= 34 && !flatBay ? 'stack'
          : model.choice && (target.kind === 'add' || target.owner.level === 'global') && Math.max(nameW, figureW) + 2 <= r.w && r.h >= 48 ? 'stack3'
          : row ? 'row' : 'out';
        el.dataset.mode = mode;
        if (mode === 'out') {
          const tw = nameW + priceW + (priceW ? TAG_GAP : 0) + TAG_PAD;
          // A rack or server site runs its tag east over the free slots; a pad at the end of a site's row runs it back over the row.
          const tx = Math.max(L.view.x + 4, Math.min(L.view.x + L.view.w - tw - 4, target.kind === 'slot' ? r.x + r.w - tw : r.x));
          const below = r.y + r.h + 2, ty = below + TAG_H <= L.view.y + L.view.h - 4 ? below : r.y - TAG_H - 2;
          el.style.setProperty('--tag-x', `${Math.round(tx - x)}px`); el.style.setProperty('--tag-y', `${Math.round(ty - y)}px`);
        }
        // The gain line needs a third row and a readable width; smaller sites keep the name and price.
        el.dataset.roomy = String(mode === 'stack' && h >= 64 && r.w >= 112 && !foot);
        // A map pad keeps its mark in the upper part and leaves its foot (22 art px) for this text.
        el.style.setProperty('--foot', foot && mode === 'stack' && r.h >= 64 ? `${Math.round(Math.min(22 * L.N, r.h / 2))}px` : 'auto');
        el.dataset.foot = String(foot && mode === 'stack' && r.h >= 64);
      }
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    };
    position(); shell.surface.frameListeners.add(position);
    return () => { claim(false); shell.surface.frameListeners.delete(position); };
  }, [shell, target.id, model?.kind, compute, textKey, foot, board]);
  if (!model) return null;
  const q = model.quote, research = q.locked?.code === 'research' ? q.locked.node : null;
  // A closed region's cell prints nothing: its name and climate are the map's, and what opens it is on the group's head.
  if (foot && research && /^region\d+$/.test(target.id)) return null;
  // A choice never spends at the site, so it stays a live key whatever its cheapest build costs.
  const reason = purchaseReason(q), disabled = !model.choice && !research && !!reason;
  const researchName = (id: ResearchId) =>
    selectResearchTree(shell.store.getState()).nodes.find(n => n.id === id)?.name ?? String(id);
  const add = model.kind === 'add';
  const cold = q.cold && q.downtimeMs > 0 ? `${Math.ceil(q.downtimeMs / 1000)}s offline` : '';
  const gain = model.choice ? '' : [compute && !socket ? '' : add && /^\d/.test(model.gain) ? `+${model.gain}` : model.gain, cold].filter(Boolean).join(' · ');
  const needs = research ? researchName(research) : '';
  // "Power control · Research" rather than "Research Power control" under its own name.
  const detail = research ? needs.toLowerCase() === model.name.toLowerCase() ? 'Research' : `Research ${needs}` : disabled ? reason : gain;
  // A price not yet met is the price itself, dimmed: the part still says what the purchase gives.
  // Only a real lock (power, research, a ceiling) takes the gain's line.
  const short = !!reason && !q.locked && !q.overSupply;
  const shown = disabled && !short ? q.overSupply || q.locked?.code === 'power' ? 'No power' : detail : research ? detail : gain;
  return <div ref={ref} className={`source-control source-${model.kind}${compute ? ' source-compute' : ''}`} data-source-control={target.id}>
    <button type="button" className={`source-buy${model.choice && short ? ' short' : ''}`} disabled={disabled} data-source-action={target.id} data-qa-target
      data-purchase-action={!research && !model.choice ? JSON.stringify(q.action) : undefined}
      aria-label={[!group && model.name, short ? gain : '', detail, !research && `${model.choice ? 'from ' : ''}${q.cost} Credits`].filter(Boolean).join('. ')}
      title={detail || undefined} onClick={() => runSourceAction(shell, target)}>
      <span className="source-text">{!group && <span className="source-name" data-qa-label>{socket
        ? <><span className="source-full">Add CPU</span><span className="source-short">CPU {(target.slot ?? 0) + 1}</span></>
        : compute ? <><span className="source-full">{model.name}</span><span className="source-short">+1 core</span></> : model.name}</span>}
      {shown && !(add && research) && <span className={`source-gain${disabled && !short ? ' mute' : ''}`} data-qa-label>{shown}</span>}
      {/* A locked site says what unlocks it where its price would stand. */}
      {add && research && <span className="source-price source-lock" data-qa-label>{detail}</span>}
      {!research && q.cost !== '0' && <span className="source-price" data-qa-label>{model.choice ? <span className="source-from">from </span>
        : !disabled && !add && <span aria-hidden="true">↑ </span>}<Price cost={q.cost} currency={q.currency} /></span>}</span>
    </button>
  </div>;
}
