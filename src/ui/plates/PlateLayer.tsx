import { useCallback, useMemo, useState } from 'react';
import { researchId, selectResearchTree, selectSavedConfigs, type GameAction, type SupplyView, type LevelSnapshot, type QuoteRequest, type QuoteResult, type ResearchId, type ScopeRef, type UnitRef } from '../../game';
import type { HitTarget, Rect } from '../../render/core';
import { useGameSelector, useQuote, useShell, useViewState } from '../storeHooks';
import { ConfigPlate } from './ConfigPlate';
import type { ConfigKind } from './configArt';
import { CoolerPlate } from './CoolerPlate';
import { rackLetter, regionName, zoneLetter } from './copy';
import { fahrenheit, percent } from './format';
import { LbPlate } from './LbPlate';
import { SystemSummary } from './SystemSummary';
import { NetworkRackPlate } from './NetworkRackPlate';
import { PartPlate } from './PartPlate';
import { GpuPlate } from './GpuPlate';
import { partFacts } from './partFacts';
import { nextDefaultName, SavePrompt } from './SavePrompt';
import { SupplyPlate } from './SupplyPlate';
import { PowerCtlPlate } from './PowerCtlPlate';
import { PowerKeys } from './PowerKeys';
import { isPowerCtl } from './targets';
import { CoresPlate } from './CoresPlate';
import { blockedOn, firstBlockedFor, sameSupply } from './blocks';
import { useMeet } from '../queue/meet';
import { SitePlate } from './SitePlate';
import { StartRow } from './StartRow';
import { GenerationRow } from './GenerationRow';
import { SwitchPlate } from './SwitchPlate';
import type { PlateCommon } from './types';
import { ServerPlate, UnitPlate } from './UnitPlate';
import { marketOf, type MarketState } from './market';

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
    if (focus.level === 'chip' || focus.level === 'system') return t.part ? { kind: 'part', part: t.part } : { kind: 'tray', at: t.owner };
    return { kind: 'add', parent: t.unit ?? focusUnit(focus), slot: t.slot };
  }
  if (t.kind === 'port' && t.sw) return { kind: 'switch', sw: t.sw };
  if ((t.kind === 'part' || t.kind === 'link') && t.part) {
    const s = t.part.slot, u = t.part.unit;
    if (s.kind === 'switch' && u.kind === 'rack') return { kind: 'switch', sw: { kind: 'rack', id: u.id } };
    if (s.kind === 'roomSwitch' && u.kind === 'room') return { kind: 'switch', sw: { kind: 'room', id: u.id } };
    if (u.kind === 'rack' || u.kind === 'room') {
      const infra = s.kind === 'rackCooler' || s.kind === 'roomCooler' ? 'cooling' : s.kind === 'pdu' || s.kind === 'ups' ? 'power'
        : s.kind === 'lb' || s.kind === 'roomLb' ? 'lb' : null;
      if (infra) return { kind: 'infra', unit: u, slot: infra };
    }
    return { kind: 'part', part: t.part };
  }
  return null;
}


/** The part a quote buys, by slot kind. */
const partKindOf = (q: { action: { type: string } }): string | undefined => {
  const a = q.action as { part?: { slot: { kind: string } }; kind?: string };
  return a.part?.slot.kind ?? a.kind;
};

/** D31: the optional power part a plate also sells: the room start controller on the UPS, the global one on the scheduler, a site's generation. */
export function powerScope(t: HitTarget, focus: LevelSnapshot): ScopeRef | null {
  const s = t.part?.slot.kind;
  if (s === 'ups' && focus.level === 'room') return { kind: 'room', id: focus.roomId };
  if (s === 'globalScheduler' && focus.level === 'global') return { kind: 'global' };
  if (t.kind === 'unit' && t.unit?.kind === 'site' && focus.level === 'global') return t.unit;
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

/** The cores are one component (D34, user 26 Oct): the renderer's one `cores` block (its part is core 0's ref). */
export const isCores = (t: Pick<HitTarget, 'id' | 'part'>) => t.id === 'cores' || t.part?.slot.kind === 'core';

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

/** The full plate for the selected target: opened from its callout (More), or at once for a save icon. */
export function PlateLayer() {
  const view = useViewState();
  const t = view.selected;
  const focus = useGameSelector((s) => s.focus);
  if (!t || (!view.plate && t.kind !== 'save') || focus.level !== t.owner.level) return null;
  return <TargetPlate key={t.id} target={t} focus={focus} />;
}

function TargetPlate({ target: t, focus }: { target: HitTarget; focus: LevelSnapshot }) {
  const shell = useShell();
  const { surface, view } = shell;
  const [replaceNpu, setReplaceNpu] = useState(false);
  const bootMs = useGameSelector((s) => s.bootMs);
  const credits = useGameSelector((s) => s.hud.credits, Object.is, 500);
  const quotes = useQuote(plateRequest(t, focus));
  const scope = powerScope(t, focus), power = useQuote(scope ? { kind: 'power', unit: scope } : null);
  const unblocks = useGameSelector(s => blockedOn(s.feed.window, t.part?.slot.kind), Object.is, 500);
  // The minimal-level buy that lets the first waiting task run, when it is this part (user, 26 Oct).
  const waiting = useGameSelector(s => firstBlockedFor(s.feed.window, t.part?.slot.kind), (a, b) => a?.key === b?.key && a?.blockedBy === b?.blockedBy, 500);
  const unblock = useMeet(waiting).find(q => sameSupply(partKindOf(q), t.part?.slot.kind)) ?? null;
  const netRack = focus.level === 'room' && (t.part?.slot.kind === 'roomSwitch' || (t.kind === 'port' && t.sw?.kind === 'room'));
  const roomLb = useQuote(netRack && focus.level === 'room' ? { kind: 'infra', unit: { kind: 'room', id: focus.roomId }, slot: 'lb' } : null);
  // The router queue's next slot (D25.7) for whichever load balancer this plate shows.
  const lbUnit = routerOf(t, focus) ?? (netRack && focus.level === 'room' ? { kind: 'room', id: focus.roomId } as const : null);
  const queueQuote = useQuote(lbUnit ? { kind: 'routerQueue', unit: lbUnit } : null)?.quotes[0] ?? null;
  const readAnchor = useCallback((out: Rect) => surface.renderer?.anchor(t.id, out) ?? false, [surface, t.id]);
  const subscribeFrame = useCallback((update: () => void) => {
    const l = () => update(); surface.frameListeners.add(l); return () => { surface.frameListeners.delete(l); };
  }, [surface]);
  // Display names, never IDs (QA-07); the catalog doesn't change while a plate is open.
  const researchNames = useMemo(() => new Map<ResearchId, string>(selectResearchTree(shell.store.getState()).nodes.map(n => [n.id, n.name])), [shell.store]);
  const common: Omit<PlateCommon, 'quotes'> = {
    readAnchor, subscribeFrame, bounds: surface.plateBounds, bootS: bootMs / 1000, beside: surface.layout.kind === 'desktop',
    onAction: (a: GameAction) => { shell.dispatch(a); },
    // One level, as Back and Escape do: the plate closes to its callout.
    onClose: () => view.dispatch({ type: 'back' }),
    onResearch: (project) => view.dispatch({ type: 'openResearch', project }),
    researchName: (id) => researchNames.get(id) ?? String(id),
  };

  const powerKeys = (installed: boolean, level: number, noun: string, wake: boolean) => <PowerKeys quotes={power} installed={installed} level={level} noun={noun} wake={wake}
    onAction={common.onAction} onResearch={common.onResearch} researchName={common.researchName} />;

  const gpuSlot = gpuPlateSlot(t, focus);
  if (gpuSlot !== undefined && focus.level === 'system') {
    const installed = gpuSlot === null ? undefined : focus.gpu.find(p => p.slot === gpuSlot);
    if (installed?.kind !== 'npu' || replaceNpu) return <GpuPlate {...common} system={focus.systemId} index={gpuSlot}
      installed={installed} tasks={focus.running} />;
  }

  if (isPowerCtl(t) && focus.level === 'rack') {
    const researched = shell.store.getState().research.completed.includes(researchId('powerCtl'));
    return <PowerCtlPlate {...common} quotes={quotes} rack={focus.rackId} view={focus.powerCtl ?? null} research={researched ? null : researchId('powerCtl')} />;
  }
  if (isCores(t) && focus.level === 'chip') return <CoresPlate {...common} quotes={quotes} focus={focus} />;
  if (t.kind === 'slot' && !t.part && (focus.level === 'chip' || focus.level === 'system'))
    return <SitePlate {...common} target={t} focus={focus} quotes={quotes} />;
  if (t.kind === 'save' && t.unit) {
    const unit = t.unit, taken = selectSavedConfigs(shell.store.getState(), unit.kind).names;
    return <SavePrompt unit={unit} bounds={surface.plateBounds} defaultName={nextDefaultName(defaultBase(unit, focus), taken)} taken={taken}
      onAction={common.onAction} onClose={common.onClose} />;
  }
  if (t.kind === 'slot' && t.slot !== null && focus.level !== 'chip' && focus.level !== 'system') {
    const parent = t.unit ?? focusUnit(focus), kind = configKind(focus.level, parent);
    if (!kind) return null;
    const sub = focus.level === 'rack' ? `Rack ${rackLetter(focus.rackId)} · slot ${t.slot + 1}`
      : focus.level === 'room' ? `AZ ${zoneLetter(focus.zone)} · slot ${t.slot + 1}` : `Slot ${t.slot + 1}`;
    return <ConfigPlate {...common} quotes={quotes} kind={kind} sub={sub} credits={credits} landscape={surface.layout.kind === 'desktop'}
      drawCopy={(from, g, w, h) => drawCopyMini(shell, focus, from, g, w, h)} />;
  }
  if (t.kind === 'port' && t.sw) {
    if (focus.level === 'rack' && t.sw.kind === 'rack') return <SwitchPlate {...common} quotes={quotes} sw={t.sw} view={focus.switch}
      units={focus.servers.filter((s) => s.systemId !== null).length} initialPort={t.port} />;
    if (focus.level === 'room' && t.sw.kind === 'room') return <NetworkRackPlate {...common} quotes={quotes} lbQuotes={roomLb} queueQuote={queueQuote}
      room={focus.roomId} zone={focus.zone} network={focus.network} racks={focus.racks.filter((r) => r.rackId !== null).length} initialPort={t.port} />;
    return null;
  }
  const save = (unit: UnitRef) => view.dispatch({ type: 'select', target: { ...t, id: `${t.id}:save`, kind: 'save', unit, rect: { ...t.rect } } });
  if (t.kind === 'unit' && t.unit) return unitPlate(t.unit, focus, { ...common, onSave: save, market: marketOf(shell.store.getState(), t.unit), power, select: target => view.dispatch({ type: 'select', target, plate: true }) }, (slot) => {
    const next = { ...t, id: `${t.id.replace(/\d+$/, '')}${slot}`, slot, unit: focus.level === 'rack' && focus.servers[slot].systemId !== null
      ? { kind: 'system', id: focus.servers[slot].systemId! } as UnitRef : t.unit };
    view.dispatch({ type: 'select', target: next });
  }, () => { if (t.drill) view.dispatch({ type: 'drill', ref: t.drill }); });
  if ((t.kind === 'part' || t.kind === 'link') && t.part) {
    const s = t.part.slot;
    const psu: SupplyView | undefined = focus.level === 'system' || focus.level === 'chip' ? focus.psu : undefined;
    if (s.kind === 'psu' && psu) return <SupplyPlate {...common} quotes={quotes} supply={psu} />;
    if (s.kind === 'pdu' && focus.level === 'rack') return <SupplyPlate {...common} quotes={quotes} supply={focus.pdu} />;
    if (s.kind === 'ups' && focus.level === 'room' && focus.ups[s.index]) return <SupplyPlate {...common} quotes={quotes} supply={focus.ups[s.index]}>
      {/* D31.2: the room start controller lives on the UPS: which racks are powered at round start. */}
      {focus.power?.start && <StartRow unit={{ kind: 'room', id: focus.roomId }} scope="room" view={focus.power.start} onAction={common.onAction} />}
      {powerKeys(!!focus.power?.start, focus.power?.start?.level ?? 0, 'Start controller', true)}
    </SupplyPlate>;
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
      {focus.start && <StartRow unit={{ kind: 'global' }} scope="global" view={focus.start} onAction={common.onAction} />}
      {powerKeys(!!focus.start, focus.start?.level ?? 0, 'Start controller', true)}
    </LbPlate>;
    const facts = partFacts(focus, s);
    if (facts) return <PartPlate {...common} quotes={quotes} {...facts} unblocks={unblocks} unblock={unblock}>
      {s.kind === 'gpu' && focus.level === 'system' && focus.gpu.find(p => p.slot === s.index)?.kind === 'npu'
        && <button type="button" className="key ghost" onClick={() => setReplaceNpu(true)}>Replace with GPU model</button>}
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

function defaultBase(unit: UnitRef, focus: LevelSnapshot): string {
  if (unit.kind === 'rack') return `Rack ${rackLetter(unit.id)}`;
  if (unit.kind === 'room') return focus.level === 'room' ? `AZ ${zoneLetter(focus.zone)}` : 'Zone';
  if (unit.kind === 'site') return 'Site';
  return 'Server';
}

function unitPlate(unit: UnitRef, focus: LevelSnapshot, all: Omit<PlateCommon, 'quotes'> & { onSave: (u: UnitRef) => void; market: MarketState | null; power: QuoteResult | null; select: (t: HitTarget) => void },
  step: (slot: number) => void, goInside: () => void) {
  const { onSave, power, select: _select, ...common } = all;
  const saveKey = (saveable: boolean) => (saveable ? () => onSave(unit) : null);
  if (unit.kind === 'system' && focus.level === 'rack') {
    const slot = focus.servers.findIndex((s) => s.systemId === unit.id);
    return <ServerPlate {...common} slot={slot} servers={focus.servers} onStep={step} onGoInside={goInside} />;
  }
  if (unit.kind === 'system' && (focus.level === 'system' || focus.level === 'chip')) {
    const mode = focus.online, timerS = focus.level === 'system' ? focus.timerS : null;
    const total = focus.level === 'system' ? focus.timerTotalS : null;
    return <UnitPlate {...common} unit={unit} title={`System ${unit.id + 1}`} sub={focus.level === 'system' && focus.kind === 'storageNode' ? 'storage node' : 'one server'}
      status={focus.level === 'system' ? `${focus.running.length} running · ${focus.queue.count} queued` : 'Chip'} mode={mode} timerS={timerS} bootS={total ?? common.bootS}
      onSave={saveKey(focus.level === 'system' && focus.saveable)} saveLabel="Save this server">
      {/* Never an empty plate (user, 26 Oct): what is in the box, each row opening its part, and Open CPU. */}
      {focus.level === 'system' && <SystemSummary focus={focus}
        onOpenPart={(part, key) => all.select({ id: `sum-${key}`, kind: 'part', owner: { level: 'system', id: focus.systemId } as never, drill: null, part, unit: null, sw: null, port: null, slot: null, rect: { x: 0, y: 0, w: 0, h: 0 } })} />}
    </UnitPlate>;
  }
  if (unit.kind === 'rack' && focus.level === 'rack') {
    const n = focus.servers.filter((s) => s.systemId !== null).length;
    return <UnitPlate {...common} unit={unit} title={`Rack ${rackLetter(unit.id)}`} sub={`${n} servers`}
      status={`${fahrenheit(focus.tempF)} · PDU ${percent(focus.pdu.usage)}`} mode={focus.online} timerS={focus.timerS}
      onSave={saveKey(focus.saveable)} saveLabel="Save this rack" />;
  }
  if (unit.kind === 'room' && focus.level === 'room') {
    return <UnitPlate {...common} unit={unit} title={`Room · AZ ${zoneLetter(focus.zone)}`} sub={`${focus.rows} of ${focus.maxRows} rows`}
      status={`${fahrenheit(focus.tempF)} · outside ${fahrenheit(focus.outsideF)}`} statusTone={focus.tempF > 80 ? 'warn' : ''}
      mode={focus.online} timerS={focus.timerS} onSave={saveKey(focus.saveable)} saveLabel="Save this zone" />;
  }
  if (unit.kind === 'site' && focus.level === 'global') {
    const site = focus.sites.find((s) => s.siteId === unit.id);
    if (!site) return null;
    return <UnitPlate {...common} unit={unit} title={regionName(site.region)} sub={`${site.zones.length} ${site.zones.length === 1 ? 'zone' : 'zones'}`}
      status={`${fahrenheit(site.outsideF)} outside · hottest ${fahrenheit(site.hottestF)}`} mode={site.online} timerS={site.timerS} onSave={saveKey(site.open)} saveLabel="Save this site">
      <GenerationRow generation={site.generation ?? null} />
      <PowerKeys quotes={power} installed={!!site.generation} level={site.generation?.level ?? 0} noun="Generation" onAction={common.onAction} onResearch={common.onResearch} researchName={common.researchName} />
    </UnitPlate>;
  }
  return null;
}
