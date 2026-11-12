// Motherboard display. Hardware state and power rules come from the simulation.
import type { QuoteResult, SystemSnapshot, TaskView } from '../../../game';
import { BG, P, R, darkFx, drawGhost, drawSaveIcon, drawUnitLamp, lampState, pathAt, upArrow, upArrowFill } from '../../core';
import type { GhostState, LevelRegistry, Point, Rect, ViewPresentation, WorldFrame } from '../../core';
import { boardStatic } from './board';
import { drawChipMini } from '../chip/mini';
import { drawLeaders, firstRow } from './labels';
import { CONNECTOR, LAMP, packageRect, siteRect, worldRect } from './layout';
import type { SiteType } from './layout';
import { boardModel, openGroup, pickedType, slotOf } from './model';
import { drawReadLights } from './memory';
import { drawMemoryRows } from './memoryRows';
import type { BoardModel, Site } from './model';
import { drawGpuPiece, drawInbound, inboundOf } from './shards';
import { boardRoute } from './routes';
import { drawCpuSocket, drawDrivePart, drawEmptySite, drawGpuPart, drawPackageBody, drawPackageFront, drawConnector,
  drawRamPart, drawSiteLocked } from './sprites';

type G = CanvasRenderingContext2D;
/** The boot / cold-change drain the lamp shows, at base (Fast boot shortens the real timer). */
export const BOOT_MS = 10_000;

/** Modes in which the board is powered and can work. */
export function powered(s: SystemSnapshot): boolean {
  return s.online === 'onMarket' || s.online === 'draining' || s.online === 'goingOffline' || s.online === 'asleep';
}
const world: Rect = { x: 0, y: 0, w: 0, h: 0 }, pkg: Rect = { x: 0, y: 0, w: 0, h: 0 }, hit: Rect = { x: 0, y: 0, w: 0, h: 0 };
const at: Point = { x: 0, y: 0 };

function quoteState(quotes: QuoteResult | null, type: SiteType): GhostState {
  if (!quotes) return 'open';
  for (const q of quotes.quotes) {
    const a = q.action;
    if ((a.type === 'addPart' && a.kind === type) || (a.type === 'installGpu' && type === 'gpu' && a.index === null)) return q.locked ? 'locked' : q.affordable ? 'picked' : 'open';
  }
  return 'locked';
}
function upgradeFraction(quotes: QuoteResult | null, site: Site, credits: number): number {
  if (!quotes || site.type === 'cpu') return 0;
  for (const q of quotes.quotes) {
    const a = q.action;
    if (a.type !== 'upgradePart' || q.locked || !('index' in a.part.slot) || a.part.slot.kind !== site.type || a.part.slot.index !== site.index) continue;
    const cost = Number(q.cost);
    return q.affordable ? 1 : cost > 0 ? credits / cost : 0;
  }
  return 0;
}

export function drawBoard(g: G, s: SystemSnapshot, view: ViewPresentation, frame: WorldFrame, registry: LevelRegistry): void {
  const m = boardModel(s), b = m.b, live = !frame.paused && powered(s), pick = pickedType(view.picked);
  worldRect(b, frame.form, world);
  R(g, world.x, world.y, world.w, world.h, BG.system);
  g.drawImage(boardStatic(b), 0, 0);
  const transfer = live ? inboundOf(s) : null;
  const stageOn = activeStages(s, live);
  for (const site of m.sites) {
    if (site.state === 'locked') { drawSiteLocked(g, siteRect(b, site.type, site.index, hit)); continue; }
    if (site.state === 'open') { if (!plated(s, m, site)) drawEmptySite(g, b, site.type, site.f); continue; }
    const p = site.part!, on = live && (p.active || p.resourceBusy > 0 || stageOn.has(site.type));
    if (site.type === 'cpu') drawCpu(g, s, site, live, frame, registry);
    else if (site.type === 'ram') drawRamPart(g, b, site.f, p.level, live && p.active);
    else if (site.type === 'gpu') drawGpuPart(g, b, site.f, p.level, live && (p.active || p.resourceBusy > 0), p.kind === 'npu' ? P.rnd : P.gpu, live ? p.resourceBusy : 0);
    else drawDrivePart(g, b, site.f, p.level, on && p.active);
  }
  if (pick) {
    const state = quoteState(view.quotes, pick);
    for (const site of m.sites) if (site.type === pick && site.state === 'open') { siteRect(b, site.type, site.index, hit); drawGhost(g, hit.x, hit.y, hit.w, hit.h, state); }
  }
  drawConnector(g, CONNECTOR, !!transfer);
  // D25: the inbound shard rides in on the pipe at its real progress, in its task type's colour.
  if (transfer) drawInbound(g, transfer, b, frame);
  // D26: each tier fills its parts (spill hatched), and the tier a shard reads from now shows its light.
  drawReadLights(g, s, m, frame.timeMs, live);
  if (live) for (const t of s.running) { drawStageBit(g, m, t); drawGpuPiece(g, m, t); }
  if (live) {
    const credits = Number(frame.snapshot.hud?.credits ?? 0);
    for (const site of m.sites) {
      if (site.state !== 'part') continue;
      const f = upgradeFraction(view.quotes, site, credits);
      if (f <= 0) continue;
      siteRect(b, site.type, site.index, hit);
      if (f >= 1) upArrow(g, hit.x + hit.w - 4, hit.y + 1); else if (f >= 0.5) upArrowFill(g, hit.x + hit.w - 4, hit.y + 1, f);
    }
  }
  if (s.saveable) drawSaveIcon(g, b.save.x, b.save.y);
  drawUnitLamp(g, LAMP.x, LAMP.y, LAMP.w, lampState(s.online), (s.timerS ?? 0) * 1000, Math.max(BOOT_MS, (s.timerS ?? 0) * 1000), frame.paused);
  if (s.online === 'offline' || s.online === 'dark' || s.online === 'crashed') darkFx(g, b.powered.x, b.powered.y, b.powered.w, b.powered.h);
  drawTiles(g, s, m, view);
  drawMemoryRows(g, s, frame, b);
  // Leaders belong to the labels: desktop only, and like the labels never during a zoom.
  if (frame.form !== 'phone' && !frame.zoom) drawLeaders(g, s, firstRow(frame));
}

/** An open site drawn as an add plate (drawTiles) instead of its bare slot: a GPU slot, or a member of its type's shared add. */
function plated(s: SystemSnapshot, m: BoardModel, site: Site): boolean {
  if (site.type === 'cpu' || !slotOf(s, site)) return false;
  if (site.type === 'gpu') return true;
  const shared = openGroup(m, site.type);
  return !!shared && shared.members.has(site) && !!slotOf(s, shared.site);
}
/**
 * Every site the player can add to reads as one (user): a tile on exactly its hit rect (index.ts). An empty
 * CPU socket is its pad field in an outline. An open GPU slot, and the open RAM or drive slots as one shared
 * add, are a plain dark plate like that field, clear for the UI's name and price; where the UI prints
 * none on the tile (too small for it), the plate carries a "+". A locked slot keeps its silk corners.
 */
const TILE_EDGE = 'rgba(191, 178, 255, 0.55)', PLATE = '#1b1830', PLATE_RIM = '#2e2a45';
function drawTiles(g: G, s: SystemSnapshot, m: BoardModel, view: ViewPresentation): void {
  const b = m.b;
  for (const site of m.sites) {
    if (site.state !== 'open' || site.type === 'ram' || site.type === 'drive' || !slotOf(s, site)) continue;
    siteRect(b, site.type, site.index, hit);
    if (site.type === 'cpu') outline(g, hit, TILE_EDGE);
    else addPlate(g, hit, !!view.sourceActions?.includes(`add:${site.type}${site.index}`), quoteState(view.quotes, site.type) === 'picked');
  }
  for (const type of ['ram', 'drive'] as const) {
    const shared = openGroup(m, type);
    if (!shared || !slotOf(s, shared.site)) continue;
    addPlate(g, shared.rect, !!view.sourceActions?.includes(`add:${type}${shared.site.index}`), quoteState(view.quotes, type) === 'picked');
  }
}
function addPlate(g: G, r: Rect, labelled: boolean, bright: boolean): void {
  R(g, r.x, r.y, r.w, r.h, PLATE_RIM); R(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, PLATE);
  R(g, r.x + 2, r.y + 2, 3, 1, P.goldLo); R(g, r.x + 2, r.y + 2, 1, 3, P.goldLo);
  outline(g, r, TILE_EDGE);
  if (!labelled) plus(g, r, bright);
}
function outline(g: G, r: Rect, c: string): void {
  R(g, r.x, r.y, r.w, 1, c); R(g, r.x, r.y + r.h - 1, r.w, 1, c); R(g, r.x, r.y + 1, 1, r.h - 2, c); R(g, r.x + r.w - 1, r.y + 1, 1, r.h - 2, c);
}
function plus(g: G, r: Rect, bright: boolean): void {
  if (r.w < 7 || r.h < 7) return;
  const cx = r.x + (r.w >> 1), cy = r.y + (r.h >> 1), c = bright ? P.paper : P.silkLo;
  R(g, cx - 3, cy - 1, 7, 3, P.ink); R(g, cx - 1, cy - 3, 3, 7, P.ink); R(g, cx - 2, cy, 5, 1, c); R(g, cx, cy - 2, 1, 5, c);
}

const stages = new Set<SiteType>();
function activeStages(s: SystemSnapshot, live: boolean): Set<SiteType> {
  stages.clear();
  if (live) for (const t of s.running) { const k = stageKind(t); if (k) stages.add(k); }
  return stages;
}
function drawCpu(g: G, s: SystemSnapshot, site: Site, live: boolean, frame: WorldFrame, registry: LevelRegistry): void {
  const b = boardModel(s).b;
  drawCpuSocket(g, site.f);
  packageRect(b, site.index, pkg);
  drawPackageBody(g, pkg, live && (s.cpuBusy[site.index] ?? 0) > 0);
  // Draw the same CPU parts as the CPU level.
  if (registry.has('chip')) drawChipMini(g, s, pkg, frame, site.index);
  drawPackageFront(g, pkg);
}

/** The part a stage runs on: a D26 `mem` part on its tier (RAM sticks or drives; cache has none), or the GPU. */
function stageKind(t: TaskView): 'ram' | 'gpu' | 'drive' | undefined {
  if (t.resource === 'gpu') return 'gpu';
  if (t.resource !== 'mem') return undefined;
  return t.memTier === 'ram' ? 'ram' : t.memTier === 'disk' ? 'drive' : undefined;
}
const COLOUR: Readonly<Record<'ram' | 'drive', string>> = { ram: P.ram, drive: P.stor };
/**
 * A RAM or IO stage runs out from CPU 1 to the part serving it, at the stage's real progress. A GPU
 * stage is drawn as the shard's piece on its card instead (shards.ts `drawGpuPiece`).
 */
export function drawStageBit(g: G, m: BoardModel, t: TaskView): void {
  const type = stageKind(t);
  if (!type || type === 'gpu') return;
  const list = m.installed[type];
  let site: Site | null = null;
  for (const p of list) if (!site || p.part?.active) site = p;
  if (site) drawStagePath(g, m, site, t.progress, COLOUR[type], t.socket ?? 0);
}
function drawStagePath(g: G, m: BoardModel, site: Site, progress: number, colour: string, socket: number): void {
  const stage = boardRoute(m.b, site.type, site.index, socket);
  if (!stage.length) return;
  pathAt(stage, progress, at);
  // A one-pixel signal fits the narrow socket gutters without painting over the neighbouring CPU.
  R(g, Math.round(at.x), Math.round(at.y), 1, 1, colour);
}
