import { useEffect, useRef, useState } from 'react';
import { restPan, type HitTarget, type Rect } from '../../render/core';
import { rackRowScroll } from '../../render/levels/rack';
import { REGION_IDS } from '../../game';
import { regionName, SLOT_TITLE, UNIT_NOUN } from '../plates/copy';
import { useLayout } from '../shell/geometry';
import { useShell } from '../storeHooks';
import { LEVEL_NAMES } from '../viewState';
import { activateTarget } from './commands';
import { SourceControl } from './SourceControl';
import { sourceRequest } from './sourceAction';

/** Names the same targets used by pointer input, without exposing internal IDs. */
export function targetLabel(t: HitTarget): string {
  // Name each board CPU socket.
  if (t.part?.slot.kind === 'cpu') return `CPU ${t.part.slot.socket + 1}`;
  if (t.drill) return `Open ${LEVEL_NAMES[t.drill.level]} ${t.drill.id + 1}`;
  if (t.kind === 'save') return `Save ${t.unit ? UNIT_NOUN[t.unit.kind] : 'configuration'}`;
  if (t.kind === 'port') return t.port === -1 ? 'Uplink' : `Port ${(t.port ?? 0) + 1}`;
  if (t.part) return `${SLOT_TITLE[t.part.slot.kind]}${'index' in t.part.slot ? ` ${t.part.slot.index + 1}` : ''}`;
  if (t.id === 'queue') return 'Add scheduler';
  if (t.owner.level === 'global' && t.kind === 'slot' && t.unit?.kind !== 'site' && t.slot !== null)
    return `Add site in ${regionName(REGION_IDS[t.slot]!)}`;
  if (t.kind === 'unit' && t.unit) return `${UNIT_NOUN[t.unit.kind]} ${'id' in t.unit ? t.unit.id + 1 : ''}`.trim();
  const slot = /^(?:add:|slot-)(core|cpu|ram|gpu|drive|storage)/.exec(t.id)?.[1];
  if (slot) return `Add ${slot === 'drive' || slot === 'storage' ? 'storage' : slot === 'core' ? 'core' : slot.toUpperCase()}${t.slot === null ? '' : ` ${t.slot + 1}`}`;
  return `Add ${t.owner.level === 'rack' ? 'server' : t.owner.level === 'room' ? 'rack' : 'zone'}${t.slot === null ? '' : ` ${t.slot + 1}`}`;
}

/** Keyboard and screen reader controls for canvas hardware. Pointer gestures stay on the canvas. */
export function WorldControls() {
  const shell = useShell(), L = useLayout();
  const [targets, setTargets] = useState<readonly HitTarget[]>([]);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const current = useRef(new Map<string, HitTarget>());
  useEffect(() => {
    let key = '', nextRead = 0;
    const bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const read = (_simTime: number, nowS: number) => {
      if (nowS < nextRead) return;
      nextRead = nowS + 0.25;
      const renderer = shell.surface.renderer;
      if (!renderer) return;
      const list = renderer.getTargets();
      current.current = new Map(list.map(t => [t.id, t]));
      const next = list.map(t => `${t.owner.level}:${t.owner.id}:${t.id}:${targetLabel(t)}`).join('|');
      if (key !== next) { key = next; setTargets(list); }
      for (const t of list) {
        const button = buttons.current.get(t.id);
        if (!button || !renderer.anchor(t.id, bounds)) continue;
        button.tabIndex = shell.surface.sourceActions?.has(t.id) ? -1 : 0;
        button.setAttribute('aria-hidden', shell.surface.sourceActions?.has(t.id) ? 'true' : 'false');
        const w = Math.min(L.view.w, Math.max(44, bounds.w)), h = Math.min(L.view.h, Math.max(44, bounds.h));
        Object.assign(button.style, {
          left: `${Math.max(L.view.x, Math.min(L.view.x + L.view.w - w, bounds.x))}px`,
          top: `${Math.max(L.view.y, Math.min(L.view.y + L.view.h - h, bounds.y))}px`,
          width: `${w}px`, height: `${h}px`,
        });
      }
    };
    shell.surface.frameListeners.add(read);
    return () => { shell.surface.frameListeners.delete(read); };
  }, [shell, L]);
  const focus = (id: string) => {
    const renderer = shell.surface.renderer, t = current.current.get(id);
    if (!renderer || !t) return;
    renderer.press(t);
    const a = { x: 0, y: 0, w: 0, h: 0 };
    if (!renderer.anchor(id, a)) return;
    const dx = a.x < L.view.x || a.x + a.w > L.view.x + L.view.w ? a.x + a.w / 2 - L.view.x - L.view.w / 2 : 0;
    const dy = a.y < L.view.y || a.y + a.h > L.view.y + L.view.h ? a.y + a.h / 2 - L.view.y - L.view.h / 2 : 0;
    if (restPan.active) restPan.scrollBy(dx / restPan.scale, dy / restPan.scale);
    else if (t.owner.level === 'rack') rackRowScroll.scrollBy(dx / rackRowScroll.scale);
  };
  return <div className="world-controls" role="group" aria-label="Hardware parts" data-free="art">
    {targets.map(t => <button key={t.id} type="button" className="world-key" aria-label={targetLabel(t)}
      ref={el => { if (el) buttons.current.set(t.id, el); else buttons.current.delete(t.id); }}
      onFocus={() => focus(t.id)} onBlur={() => shell.surface.renderer?.press(null)}
      onClick={() => { const live = current.current.get(t.id); if (live) activateTarget(shell, live); }}>{targetLabel(t)}</button>)}
    {targets.filter(t => sourceRequest(t, shell.store.getSnapshot().focus)).map(t => <SourceControl key={`source-${t.id}`} target={t} />)}
  </div>;
}
