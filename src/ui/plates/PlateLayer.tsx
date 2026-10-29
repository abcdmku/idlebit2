import { useCallback, useMemo, useRef } from 'react';
import { REGION_IDS, researchId, selectResearchTree, selectUnitLabel, selectSavedConfigs, type GameAction, type LevelSnapshot, type PartRef, type Quote, type QuoteRequest, type ResearchId, type ScopeRef, type UnitRef } from '../../game';
import type { HitTarget, Rect } from '../../render/core';
import type { ShellLayout } from '../layout';
import { useGameSelector, useQuote, useShell, useViewState } from '../storeHooks';
import { ConfigPlate } from './ConfigPlate';
import type { ConfigKind } from './configArt';
import { CoolerPlate } from './CoolerPlate';
import { regionName, zoneLetter } from './copy';
import { fahrenheit, percent } from './format';
import { LbBody, LbPlate } from './LbPlate';
import { SiteSummary } from './SiteSummary';
import { SystemSummary } from './SystemSummary';
import { SystemPower } from './SystemPower';
import { NetworkRackPlate } from './NetworkRackPlate';
import { CoresPlate } from './CoresPlate';
import { PartPlate } from './PartPlate';
import { QueuePlate } from './QueuePlate';
import { LinkPlate } from './LinkPlate';
import { BoardPartPlate } from './BoardPartPlate';
import { GpuPlate } from './GpuPlate';
import { partFacts } from './partFacts';
import { nextDefaultName, SavePrompt } from './SavePrompt';
import { SupplyPlate } from './SupplyPlate';
import { PowerCtlPlate } from './PowerCtlPlate';
import { isPowerCtl } from './targets';
import { blockedOn, firstBlockedFor, sameSupply } from './blocks';
import { useMeet } from '../queue/meet';
import { SitePlate } from './SitePlate';
import { AuxPartPlate } from './AuxPartPlate';
import { SwitchPlate } from './SwitchPlate';
import type { PlateCommon } from './types';
import { ServerPlate, UnitPlate } from './UnitPlate';
import { marketOf, type MarketState } from './market';
import { QuoteKey } from './widgets';

/** The unit a level snapshot shows, for configuration-plate parents and online rows. */
function focusUnit(f: LevelSnapshot): ScopeRef {
  switch (f.level) {
    case 'chip': case 'system': return { kind: 'system', id: f.systemId };
    case 'rack': return { kind: 'rack', id: f.rackId };
    case 'room': return { kind: 'room', id: f.roomId };
    case 'global': return { kind: 'global' };
  }
}

/** What an empty slot adds, by the level it sits in. */
export function configKind(owner: LevelSnapshot['level'], parent: ScopeRef): ConfigKind | null {
  if (owner === 'rack') return 'system';
  if (owner === 'room') return 'rack';
  if (owner === 'global') return parent.kind === 'site' ? 'room' : 'site';
  return null;
}

/** The quote request a selected target's plate needs. Pure, so tests can check the routing. */
export function plateRequest(t: HitTarget, focus: LevelSnapshot): QuoteRequest | null {
  // D31.3: the rack's fifth infrastructure slot, under the cooler.
  if (isPowerCtl(t) && focus.level === 'rack') return { kind: 'power', unit: { kind: 'rack', id: focus.rackId } };
  if (isCores(t)) return null;
  if (t.kind === 'slot' && t.slot !== null) {
    // A board site quotes its own add: each RAM or drive generation, or a copy of CPU 1 into an empty socket.
    const board = /^(?:slot-|add:)(ram|drive|cpu)[0-9]*$/.exec(t.id);
    // An empty RAM or drive site quotes the next module (the sim adds after the last), whichever "+" was tapped; a
    // filled one (its Add bought) quotes its own module.
    if (focus.level === 'system' && board) {
      const n = board[1] === 'ram' ? focus.ram.length : board[1] === 'drive' ? focus.storage.length : focus.cpuCount;
      const i = board[1] === 'cpu' || t.slot < n ? t.slot : n;
      return { kind: 'part', part: { unit: { kind: 'system', id: focus.systemId },
        slot: board[1] === 'cpu' ? { kind: 'cpu', socket: i } : { kind: board[1] as 'ram' | 'drive', index: i } } };
    }
    if (focus.level === 'chip' || focus.level === 'system') return t.part ? { kind: 'part', part: t.part } : { kind: 'tray', at: t.owner };
    return { kind: 'add', parent: t.unit ?? focusUnit(focus), slot: t.slot };
  }
  if (t.kind === 'port' && t.sw) return { kind: 'switch', sw: t.sw };
  // A zone's inbound link step.
  if (isInbound(t)) return { kind: 'inbound', at: t.owner };
  if ((t.kind === 'part' || t.kind === 'link') && t.part) {
    const s = t.part.slot, u = t.part.unit;
    if (s.kind === 'roomStart' || s.kind === 'globalStart' || s.kind === 'generation') return { kind: 'power', unit: u };
    if (s.kind === 'switch' && u.kind === 'rack') return { kind: 'switch', sw: { kind: 'rack', id: u.id } };
    if (s.kind === 'roomSwitch' && u.kind === 'room') return { kind: 'switch', sw: { kind: 'room', id: u.id } };
    if (u.kind === 'rack' || u.kind === 'room') {
      if (s.kind === 'pdu' || s.kind === 'ups' || s.kind === 'rackCooler' || s.kind === 'roomCooler') return { kind: 'part', part: t.part };
      const infra = s.kind === 'lb' || s.kind === 'roomLb' ? 'lb' : null;
      if (infra) return { kind: 'infra', unit: u, slot: infra };
    }
    return { kind: 'part', part: t.part };
  }
  return null;
}


/** The part a quote buys, by slot kind. */
const partKindOf = (q: { action: { type: string } }): string | undefined => {
  if (q.action.type === 'convertRamToEcc') return 'ram';
  const a = q.action as { part?: { slot: { kind: string } }; kind?: string };
  return a.part?.slot.kind ?? a.kind;
};

/** D31: the optional power part a plate also sells: the room start controller on the UPS, the global one on the scheduler, a site's generation. */
export function powerScope(t: HitTarget, focus: LevelSnapshot): ScopeRef | null {
  const s = t.part?.slot.kind;
  if (s === 'roomStart' && focus.level === 'room') return { kind: 'room', id: focus.roomId };
  if (s === 'globalStart' && focus.level === 'global') return { kind: 'global' };
  if (s === 'generation' && t.part?.unit.kind === 'site') return t.part.unit;
  return null;
}

/**
 * The target opens a plate on its first tap (user, 26 Oct). Not: the global scheduler before it exists
 * (A23), an empty CPU or board site (bought from its callout, QA-10; a GPU bay opens the picker), and units
 * seen from above with nothing more to show than their callout (a rack in a room, a room on the map).
 */
export function hasPlate(t: HitTarget, focus: LevelSnapshot): boolean {
  if (t.part?.slot.kind === 'globalScheduler') return focus.level === 'global' && !!focus.scheduler;
  if (isCores(t)) return focus.level === 'chip';
  // An empty CPU or board site opens a compact plate (SitePlate), placed so it never covers the site.
  if (t.kind === 'slot' && !t.part && (focus.level === 'chip' || focus.level === 'system')) return true;
  return !!plateRequest(t, focus) || t.kind === 'unit';
}

/** A zone's entry has no part of its own. Server links start at Rack. */
export const isInbound = (t: Pick<HitTarget, 'kind' | 'id' | 'part'>) => t.kind === 'link' && !t.part && (t.id === 'entry' || t.id === 'pipe');

export const isCores = (t: Pick<HitTarget,'id'|'part'>) => t.id==='cores'||t.part?.slot.kind==='core';

/** The router a target is (D25.7): the rack LB, the room LB in the network rack, or the global scheduler. */
export function routerOf(t: HitTarget, focus: LevelSnapshot): ScopeRef | null {
  const s = t.part?.slot.kind;
  if (s === 'lb' && focus.level === 'rack') return { kind: 'rack', id: focus.rackId };
  if ((s === 'roomLb' || s === 'roomSwitch') && focus.level === 'room') return { kind: 'room', id: focus.roomId };
  if (s === 'globalScheduler' && focus.level === 'global' && focus.scheduler) return { kind: 'global' };
  return null;
}

/** Empty targets carry their slot kind in the renderer's stable target ID. */
export function gpuPlateSlot(t: HitTarget, focus: LevelSnapshot): number | null | undefined {
  if (focus.level !== 'system') return undefined;
  if (t.part?.unit.kind === 'system' && t.part.slot.kind === 'gpu') {
    const index = t.part.slot.index;
    return focus.gpu.some(p => p.slot === index) ? index : null;
  }
  if (t.kind === 'slot' && t.slot !== null && (t.id === `slot-gpu${t.slot}` || t.id === `add:gpu${t.slot}`)) return null;
  return undefined;
}

/**
 * Where a plate may sit. A short portrait phone has too little world for a choice plate beside its part, so
 * there it may also cover the task strip and the deck while it is open; the HUD with the wallet stays clear.
 */
export function plateArea(layout: ShellLayout, bounds: Rect | null): Rect | null {
  if (!bounds || layout.kind !== 'phone') return bounds;
  // A short landscape (R16): the world is a narrow band right of the strip and deck, so a plate may also cover that
  // column while open, which leaves room beside its part for the main option; the HUD with the wallet stays clear.
  if (layout.w >= 640 && layout.h < 480) {
    const top = layout.band.y + layout.band.h + 8;
    return { x: 8, y: top, w: layout.w - 16, h: layout.h - 8 - top };
  }
  if (layout.h >= 640 || layout.w >= 640) return bounds;
  const top = layout.band.y + layout.band.h + 8, bottom = layout.h - 8;
  return { x: bounds.x, y: top, w: bounds.w, h: bottom - top };
}

/**
 * Where a plate may spill to fit its contents: first over the strip and the deck, then over the HUD too.
 * A plate that fits keeps `plateArea`.
 */
export function plateSpill(layout: ShellLayout, area: Rect | null): Rect[] | null {
  if (!area) return null;
  const wide = layout.kind === 'desktop' || (layout.w >= 640 && layout.h < 480);
  const x = wide ? 8 : area.x, w = wide ? layout.w - 16 : area.w;
  const all = { x, y: 8, w, h: layout.h - 16 };
  const top = layout.band.y + layout.band.h + 8;
  return area.y > top ? [{ x, y: top, w, h: layout.h - 8 - top }, all] : [all];
}

/** The full plate for the selected target: opened from its callout (More), or at once for a save icon. */
export function PlateLayer() {
  const view = useViewState();
  const t = view.selected;
  const focus = useGameSelector((s) => s.focus);
  if (view.sheet || !t || (!view.plate && t.kind !== 'save') || focus.level !== t.owner.level) return null;
  return <TargetPlate key={t.id} target={t} focus={focus} />;
}

function samePart(a: PartRef, b: PartRef): boolean {
  return a.unit.kind === b.unit.kind && (a.unit.kind === 'global' || b.unit.kind !== 'global' && a.unit.id === b.unit.id)
    && a.slot.kind === b.slot.kind
    && (!('index' in a.slot) || 'index' in b.slot && a.slot.index === b.slot.index)
    && (!('socket' in a.slot) || 'socket' in b.slot && a.slot.socket === b.slot.socket);
}

function TargetPlate({ target: t, focus }: { target: HitTarget; focus: LevelSnapshot }) {
  const shell = useShell();
  const { surface, view } = shell;
  const bootMs = useGameSelector((s) => s.bootMs);
  const credits = useGameSelector((s) => s.hud.credits, Object.is, 500);
  const requested = useQuote(plateRequest(t, focus));
  const quotes = requested && t.part ? { ...requested, quotes: requested.quotes.filter(q => !('part' in q.action) || samePart(q.action.part, t.part!)) } : requested;
  const unblocks = useGameSelector(s => blockedOn(s.feed.window, t.part?.slot.kind), Object.is, 500);
  // The minimal-level buy that lets the first waiting task run, when it is this part (user, 26 Oct).
  const waiting = useGameSelector(s => firstBlockedFor(s.feed.window, t.part?.slot.kind), (a, b) => a?.key === b?.key && a?.blockedBy === b?.blockedBy, 500);
  const unblock = useMeet(waiting).find(q => sameSupply(partKindOf(q), t.part?.slot.kind)) ?? null;
  const netRack = focus.level === 'room' && (t.part?.slot.kind === 'roomSwitch' || (t.kind === 'port' && t.sw?.kind === 'room'));
  const roomLb = useQuote(netRack && focus.level === 'room' ? { kind: 'infra', unit: { kind: 'room', id: focus.roomId }, slot: 'lb' } : null);
  // The router queue's next slot (D25.7) for whichever load balancer this plate shows.
  const lbUnit = routerOf(t, focus) ?? (netRack && focus.level === 'room' ? { kind: 'room', id: focus.roomId } as const : null)
    ?? (t.part?.slot.kind === 'dataPlane' && t.part.unit.kind === 'site' ? t.part.unit : null);
  const queueQuote = useQuote(lbUnit ? { kind: 'routerQueue', unit: lbUnit } : null)?.quotes[0] ?? null;
  const selectedSiteId = t.part?.unit.kind === 'site' ? t.part.unit.id : null;
  const siteRouter = focus.level === 'global' ? focus.sites.find(site => site.siteId === selectedSiteId)?.dataPlane?.router : undefined;
  const rowQuote = useQuote(t.kind === 'unit' && focus.level === 'room' ? { kind: 'tray', at: t.owner } : null)?.quotes.find(q => q.action.type === 'addRow') ?? null;
  // A cell tap moves the ghost inside this plate, without moving its frame.
  const anchorId = useRef(t.id).current;
  const readAnchor = useCallback((out: Rect) => surface.renderer?.anchor(anchorId, out) ?? false, [surface, anchorId]);
  const subscribeFrame = useCallback((update: () => void) => {
    const l = () => update(); surface.frameListeners.add(l); return () => { surface.frameListeners.delete(l); };
  }, [surface]);
  // Display names, never IDs (QA-07); the catalog doesn't change while a plate is open.
  const b = surface.plateBounds;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- plateBounds is updated in place; its values are the inputs
  const area = useMemo(() => plateArea(surface.layout, b), [surface.layout, b.x, b.y, b.w, b.h]);
  const spill = useMemo(() => plateSpill(surface.layout, area), [surface.layout, area]);
  const researchNames = useMemo(() => new Map<ResearchId, string>(selectResearchTree(shell.store.getState()).nodes.map(n => [n.id, n.name])), [shell.store]);
  const common: Omit<PlateCommon, 'quotes'> = {
    readAnchor, subscribeFrame, bounds: area, spill, bootS: bootMs / 1000, beside: surface.layout.kind === 'desktop',
    onAction: (a: GameAction) => { shell.dispatch(a); },
    // One level, as Back and Escape do: the plate closes to its callout.
    onClose: () => view.dispatch({ type: 'back' }),
    onResearch: (project) => view.dispatch({ type: 'openResearch', project }),
    researchName: (id) => researchNames.get(id) ?? String(id),
  };


  const gpuSlot = gpuPlateSlot(t, focus);
  if (gpuSlot !== undefined && focus.level === 'system') {
    const installed = gpuSlot === null ? undefined : focus.gpu.find(p => p.slot === gpuSlot);
    // An NPU's plate is the bay's: its own keys and every GPU model that can take its place, each one tap away.
    return <GpuPlate {...common} system={focus.systemId} index={gpuSlot}
      installed={installed} tasks={focus.running} />;
  }

  if (isPowerCtl(t) && focus.level === 'rack') {
    const researched = shell.store.getState().research.completed.includes(researchId('powerCtl'));
    return <PowerCtlPlate {...common} quotes={quotes} rack={focus.rackId} view={focus.powerCtl ?? null} research={researched ? null : researchId('powerCtl')} />;
  }
  if (isCores(t) && focus.level==='chip') return <CoresPlate {...common} quotes={quotes} focus={focus} />;
  if (isInbound(t)) {
    // A zone's entry also reaches its network rack, the existing ports, uplinks and routing controls.
    const net = focus.level === 'room' ? surface.renderer?.getTargets().find(x => x.part?.slot.kind === 'roomSwitch') ?? null : null;
    const speedHz = focus.level === 'room' ? Math.min(...focus.network.switch.uplinks.map(u => u.speedHz)) : null;
    return <LinkPlate {...common} quotes={quotes} speedHz={Number.isFinite(speedHz) ? speedHz : null} title={focus.level === 'room' ? 'Zone link' : focus.level === 'rack' ? 'Uplink' : focus.level === 'global' ? 'Backbone' : 'Pipe'}
      onOpenNetwork={net ? () => view.dispatch({ type: 'select', target: { ...net, rect: { ...net.rect } }, plate: true }) : undefined} />;
  }
  if (t.kind === 'slot' && !t.part && (focus.level === 'chip' || focus.level === 'system'))
    return <SitePlate {...common} target={t} focus={focus} quotes={quotes}
      onOpenCpu={focus.level === 'system' ? () => view.dispatch({ type: 'drill', ref: { level: 'chip', id: focus.systemId, socket: t.slot ?? 0 } }) : undefined} />;
  if (t.kind === 'save' && t.unit) {
    const unit = t.unit, taken = selectSavedConfigs(shell.store.getState(), unit.kind).names;
    return <SavePrompt unit={unit} bounds={area} defaultName={nextDefaultName(selectUnitLabel(shell.store.getState(), unit), taken)} taken={taken}
      onAction={common.onAction} onClose={common.onClose} />;
  }
  if (t.kind === 'slot' && t.slot !== null && focus.level !== 'chip' && focus.level !== 'system') {
    const parent = t.unit ?? focusUnit(focus), kind = configKind(focus.level, parent);
    if (!kind) return null;
    const sub = focus.level === 'rack' ? `${selectUnitLabel(shell.store.getState(), { kind: 'rack', id: focus.rackId })} · slot ${t.slot + 1}`
      : focus.level === 'room' ? `Zone ${zoneLetter(focus.zone)} · slot ${t.slot + 1}`
      // On the map a new site is its region, a new zone its site's region and letter (never a bare slot number).
      : parent.kind === 'site' ? `${selectUnitLabel(shell.store.getState(), parent)} · Zone ${zoneLetter(t.slot)}` : regionName(REGION_IDS[t.slot] ?? '');
    // Short screens may cover the task strip while choosing a build (plateArea), as research does.
    return <ConfigPlate {...common} quotes={quotes} kind={kind} sub={sub} credits={credits} landscape={surface.layout.kind === 'desktop'}
      nameOf={from => selectUnitLabel(shell.store.getState(), from)} drawCopy={(from, g, w, h) => drawCopyMini(shell, focus, from, g, w, h)} />;
  }
  if (t.kind === 'port' && t.sw) {
    if (focus.level === 'rack' && t.sw.kind === 'rack') return <SwitchPlate {...common} quotes={quotes} sw={t.sw} view={focus.switch}
      units={focus.servers.filter((s) => s.systemId !== null).length} initialPort={t.port} />;
    if (focus.level === 'room' && t.sw.kind === 'room') return <NetworkRackPlate {...common} quotes={quotes} lbQuotes={roomLb} queueQuote={queueQuote}
      room={focus.roomId} zone={focus.zone} network={focus.network} racks={focus.racks.filter((r) => r.rackId !== null).length} initialPort={t.port} />;
    return null;
  }
  const save = (unit: UnitRef) => view.dispatch({ type: 'select', target: { ...t, id: `${t.id}:save`, kind: 'save', unit, rect: { ...t.rect } } });
  if (t.kind === 'unit' && t.unit) return unitPlate(t.unit, focus, { ...common, onSave: save, market: marketOf(shell.store.getState(), t.unit), rowQuote, select: target => view.dispatch({ type: 'select', target, plate: true }) }, (slot) => {
    const next = { ...t, id: `${t.id.replace(/\d+$/, '')}${slot}`, slot, unit: focus.level === 'rack' && focus.servers[slot].systemId !== null
      ? { kind: 'system', id: focus.servers[slot].systemId! } as UnitRef : t.unit };
    view.dispatch({ type: 'select', target: next });
  }, () => { if (t.drill) view.dispatch({ type: 'drill', ref: t.drill }); }, selectUnitLabel(shell.store.getState(), t.unit));
  if ((t.kind === 'part' || t.kind === 'link') && t.part) {
    const s = t.part.slot;
    if (s.kind === 'pdu' && focus.level === 'rack') return <SupplyPlate {...common} quotes={quotes} supply={focus.pdu}></SupplyPlate>;
    if (s.kind === 'ups' && focus.level === 'room' && focus.ups[s.index]) return <SupplyPlate {...common} quotes={quotes} supply={focus.ups[s.index]} />;
    if (s.kind === 'roomStart' && focus.level === 'room') return <AuxPartPlate {...common} quotes={quotes} unit={t.part.unit} kind="start" start={focus.power?.start} />;
    if (s.kind === 'globalStart' && focus.level === 'global') return <AuxPartPlate {...common} quotes={quotes} unit={t.part.unit} kind="start" start={focus.start} />;
    if (s.kind === 'generation' && focus.level === 'global' && t.part.unit.kind === 'site') {
      const siteId = t.part.unit.id;
      return <AuxPartPlate {...common} quotes={quotes} unit={t.part.unit} kind="generation" generation={focus.sites.find(site => site.siteId === siteId)?.generation} />;
    }
    if (s.kind === 'grid' && focus.level === 'global' && t.part.unit.kind === 'site') {
      const id = t.part.unit.id, site = focus.sites.find((x) => x.siteId === id);
      if (site?.grid) return <SupplyPlate {...common} quotes={quotes} supply={site.grid} />;
    }
    if (s.kind === 'rackCooler' && focus.level === 'rack') return <CoolerPlate {...common} quotes={quotes} unit={{ kind: 'rack', id: focus.rackId }}
      cooler={focus.cooler} lump={{ tempF: focus.tempF, crashS: focus.crashS, crashed: focus.crashed, eff: focus.eff }} />;
    if (s.kind === 'roomCooler' && focus.level === 'room') return <CoolerPlate {...common} quotes={quotes} unit={{ kind: 'room', id: focus.roomId }}
      cooler={focus.cooler} lump={{ tempF: focus.tempF, crashS: focus.crashS, crashed: focus.crashed, outsideF: focus.outsideF }} />;
    if (s.kind === 'lb' && focus.level === 'rack') return <LbPlate {...common} quotes={quotes} queueQuote={queueQuote} unit={{ kind: 'rack', id: focus.rackId }} view={focus.lb} />;
    if (s.kind === 'switch' && focus.level === 'rack') return <SwitchPlate {...common} quotes={quotes} sw={{ kind: 'rack', id: focus.rackId }}
      view={focus.switch} units={focus.servers.filter((x) => x.systemId !== null).length} />;
    if ((s.kind === 'roomSwitch' || s.kind === 'roomLb') && focus.level === 'room') return <NetworkRackPlate {...common}
      quotes={s.kind === 'roomSwitch' ? quotes : null} lbQuotes={s.kind === 'roomLb' ? quotes : roomLb} queueQuote={queueQuote} initialView={s.kind === 'roomLb' ? 'lb' : 'ports'}
      room={focus.roomId} zone={focus.zone} network={focus.network} racks={focus.racks.filter((r) => r.rackId !== null).length} />;
    if (s.kind === 'globalScheduler' && focus.level === 'global' && focus.scheduler) return <LbPlate {...common} quotes={quotes} queueQuote={queueQuote}
      unit={{ kind: 'global' }} view={focus.scheduler} child="site" title="Global scheduler">
      <button type="button" className="component-link" onClick={() => view.dispatch({ type: 'select', plate: true,
        target: { ...t, id: 'global-start', part: { unit: { kind: 'global' }, slot: { kind: 'globalStart' } } } })}>Start controller ›</button>
    </LbPlate>;
    const facts = partFacts(focus, s, t.part.unit.kind === 'site' ? t.part.unit.id : undefined);
    // CPU, RAM and storage choose between Upgrade, Add and Replace; the CPU's own view opens only from its key.
    if (facts && focus.level === 'system' && (s.kind === 'cpu' || s.kind === 'ram' || s.kind === 'drive')) {
      const chip = { level: 'chip', id: focus.systemId, socket: s.kind === 'cpu' ? s.socket : 0 } as const;
      return <BoardPartPlate {...common} quotes={quotes} slot={s.kind} part={t.part} focus={focus} facts={facts} unblocks={unblocks} unblock={unblock}
        onOpenCpu={s.kind === 'cpu' ? () => view.dispatch({ type: 'drill', ref: chip }) : undefined} />;
    }
    if (s.kind === 'scheduler' && (focus.level === 'chip' || focus.level === 'system')) {
      const scheduler = focus.level === 'chip' ? focus.scheduler : focus.chip.scheduler;
      if (scheduler) return <QueuePlate {...common} quotes={quotes} system={focus.systemId} view={scheduler} />;
    }
    if (facts) return <PartPlate {...common} quotes={quotes} {...facts} compactStatus={s.kind === 'cpu'} unblocks={unblocks} unblock={unblock}>
      {s.kind === 'dataPlane' && siteRouter && lbUnit && <details className="component-options site-routing"><summary>Routing</summary><LbBody unit={lbUnit} view={siteRouter} child="zone"
        quotes={quotes ? { ...quotes, quotes: quotes.quotes.filter(q => q.action.type === 'setStrategy' || q.action.type === 'setFilter') } : null}
        queueQuote={queueQuote} onAction={common.onAction} onResearch={common.onResearch} researchName={common.researchName} /></details>}
    </PartPlate>;
  }
  return null;
}

/** A copy option's live mini, drawn by the level renderer from the parent's slot view. */
function drawCopyMini(shell: ReturnType<typeof useShell>, focus: LevelSnapshot, from: UnitRef, g: CanvasRenderingContext2D, w: number, h: number) {
  const snapshot = shell.store.getSnapshot();
  const frame = { snapshot, timeMs: snapshot.simTimeMs, paused: true, reducedMotion: true, zoom: null };
  const rect = { x: 0, y: 0, w, h };
  try {
    if (from.kind === 'system' && focus.level === 'rack' && shell.registry.has('system')) {
      const slot = focus.servers.find((s) => s.systemId === from.id);
      if (slot) shell.registry.level('system').drawMini(g, slot, rect, frame);
    } else if (from.kind === 'rack' && focus.level === 'room' && shell.registry.has('rack')) {
      const slot = focus.racks.find((r) => r.rackId === from.id);
      if (slot) shell.registry.level('rack').drawMini(g, slot, rect, frame);
    }
  } catch { /* A level mid-port: the well stays plain. */ }
}

function unitPlate(unit: UnitRef, focus: LevelSnapshot, all: Omit<PlateCommon, 'quotes'> & { onSave: (u: UnitRef) => void; market: MarketState | null; rowQuote: Quote | null; select: (t: HitTarget) => void },
  step: (slot: number) => void, goInside: () => void, name: string) {
  const { onSave, rowQuote, select: _select, ...common } = all;
  const saveKey = (saveable: boolean) => (saveable ? () => onSave(unit) : null);
  const chooseBuild = (slot: number) => all.select({ id: `build-${unit.kind}-${slot}`, kind: 'slot', owner: { level: focus.level, id: 'id' in unit ? unit.id : 0 } as HitTarget['owner'],
    drill: null, part: null, unit, sw: null, port: null, slot, rect: { x: 0, y: 0, w: 0, h: 0 } });
  if (unit.kind === 'system' && focus.level === 'rack') {
    const slot = focus.servers.findIndex((s) => s.systemId === unit.id);
    return <ServerPlate {...common} slot={slot} servers={focus.servers} onStep={step} onGoInside={goInside} />;
  }
  if (unit.kind === 'system' && (focus.level === 'system' || focus.level === 'chip')) {
    const mode = focus.online, timerS = focus.level === 'system' ? focus.timerS : null;
    const total = focus.level === 'system' ? focus.timerTotalS : null;
    return <UnitPlate {...common} unit={unit} title={name} sub={focus.level === 'system' && focus.kind === 'storageNode' ? 'Storage node' : undefined}
      status={focus.level === 'system' ? `${focus.running.length} running · ${focus.queue.count} queued` : 'Chip'} mode={mode} timerS={timerS} bootS={total ?? common.bootS}
      onSave={saveKey(focus.level === 'system' && focus.saveable)} saveLabel="Save this server">
      {/* Never an empty plate (user, 26 Oct): what is in the box, each row opening its part, and Open CPU. */}
      {focus.level === 'system' && <SystemPower system={focus.systemId} />}
      {focus.level === 'system' && <details className="component-options"><summary>Components</summary><SystemSummary focus={focus}
        onOpenPart={(part, key) => all.select({ id: `sum-${key}`, kind: 'part', owner: { level: 'system', id: focus.systemId } as never, drill: null, part, unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 0, h: 0 } })} /></details>}
    </UnitPlate>;
  }
  if (unit.kind === 'rack' && focus.level === 'rack') {
    const n = focus.servers.filter((s) => s.systemId !== null).length;
    const free = focus.servers.findIndex(s => s.systemId === null);
    return <UnitPlate {...common} unit={unit} title={name} sub={`${n} servers`}
      status={`${fahrenheit(focus.tempF)} · PDU ${percent(focus.pdu.usage)}`} mode={focus.online} timerS={focus.timerS}
      onSave={saveKey(focus.saveable)} saveLabel="Save this rack">
      <button type="button" className="key ghost" disabled={free < 0} onClick={() => chooseBuild(free)}>Choose server build</button>
    </UnitPlate>;
  }
  if (unit.kind === 'room' && focus.level === 'room') {
    const free = focus.racks.findIndex(r => r.rackId === null);
    return <UnitPlate {...common} unit={unit} title={`Zone ${zoneLetter(focus.zone)}`} sub={`${focus.rows} of ${focus.maxRows} rows`}
      status={`${fahrenheit(focus.tempF)} · outside ${fahrenheit(focus.outsideF)}`} statusTone={focus.tempF > 80 ? 'warn' : ''}
      mode={focus.online} timerS={focus.timerS} onSave={saveKey(focus.saveable)} saveLabel="Save this zone">
      <button type="button" className="key ghost" disabled={free < 0} onClick={() => chooseBuild(free)}>Choose rack build</button>
      <details className="component-options"><summary>Room settings</summary><button type="button" className="component-link" onClick={() => all.select({ id: 'room-start', kind: 'part', owner: { level: 'room', id: focus.roomId },
        part: { unit, slot: { kind: 'roomStart' } }, drill: null, unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 0, h: 0 } })}>Start controller ›</button>
      {rowQuote && <QuoteKey quote={rowQuote} label="Add rack row" onAction={q => common.onAction(q.action)}
        detail={focus.rows + ' \u2192 ' + Math.min(focus.maxRows, focus.rows + 1) + ' rows'} onResearch={common.onResearch} researchName={common.researchName} />}</details>
    </UnitPlate>;
  }
  if (unit.kind === 'site' && focus.level === 'global') {
    const site = focus.sites.find((s) => s.siteId === unit.id);
    if (!site) return null;
    const zones = site.zones.filter(z => z.roomId !== null).length;
    return <UnitPlate {...common} unit={unit} title={regionName(site.region)} sub={`${zones} ${zones === 1 ? 'zone' : 'zones'}`}
      status={`${fahrenheit(site.outsideF)} outside · hottest ${fahrenheit(site.hottestF)}`} mode={site.online} timerS={site.timerS} onSave={saveKey(site.open)} saveLabel="Save this site">
      <details className="component-options"><summary>Components</summary><SiteSummary site={site} onOpen={part => all.select({ id: `site-${unit.id}-${part.slot.kind}`, kind: 'part', owner: { level: 'global', id: 0 },
        drill: null, part, unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 0, h: 0 } })} /></details>
    </UnitPlate>;
  }
  return null;
}
