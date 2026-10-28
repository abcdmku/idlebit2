import { viewW } from '../core/constants';
import { capacity, ladderSpeed, partName, PARTS } from '../build/catalog';
import { ROUTE_NAMES } from './labels';
import { LEVEL_NAMES } from '../core/constants';
import { formatHertz, formatSize, formatWatts } from '../format';
import type { RouterBuild, SwitchBuild } from '../types/build';
import type { NodeRef } from '../types/ids';
import type { GameState } from '../types/state';
import type { ResearchPartId, ResearchPartView } from '../types/views';

/*
 * The current spec of each research root (ResearchTreeView.parts): a short line for the part the
 * player owns at the focused system, its rack, room and site, read from the build. "none" for a
 * part not owned yet (no such slot filled, or its level not opened).
 */

const NONE = '—';
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const routerSpec = (r: RouterBuild): string => `${ROUTE_NAMES[r.strategy].name} · queue ${r.queueLevel}`;
const switchSpec = (sw: SwitchBuild): string =>
  sw.ports.length ? `${formatHertz(ladderSpeed(Math.max(...sw.ports)))} · ${plural(sw.ports.length, 'port')}` : NONE;
const psuName = (gen: number): string => partName('psu', gen);

/** The system the specs are read at: the focused system, the first system of a focused rack or room, else the player's first. */
function systemAt(state: GameState, at: NodeRef | null): number {
  const b = state.build;
  const first = (list: readonly (number | null)[]): number => list.find((s) => s !== null && b.systems[s]) ?? -1;
  if (at && (at.level === 'chip' || at.level === 'system') && b.systems[at.id]) return at.id;
  if (at?.level === 'rack' && b.racks[at.id]) { const s = first(b.racks[at.id]!.servers); if (s >= 0) return s; }
  if (at?.level === 'room' && b.rooms[at.id]) {
    for (const r of b.rooms[at.id]!.racks) { const s = r === null ? -1 : first(b.racks[r]?.servers ?? []); if (s >= 0) return s; }
  }
  return b.systems.find((s) => s !== null)?.id ?? -1;
}

/** A spec line per research root, read at `at` (default: the player's first system). */
export function researchPartSpecs(state: GameState, at: NodeRef | null = null): Record<ResearchPartId, ResearchPartView> {
  const b = state.build, c = state.compiled;
  const s = systemAt(state, at);
  const sys = s >= 0 ? b.systems[s] ?? null : null, spec = sys?.spec ?? null, cpu = spec?.cpu ?? null;
  const rack = sys ? b.racks[sys.rack] ?? null : null, openRack = rack?.opened ? rack : null;
  const room = rack ? b.rooms[rack.room] ?? null : null, openRoom = room?.opened ? room : null;
  const site = room ? b.sites[room.site] ?? null : null, openSite = site?.opened ? site : null;

  const cacheBits = cpu ? capacity(PARTS.cache, cpu.cache.gen, cpu.cache.level) : 0;
  const gpus = spec?.accels.filter((a) => a.kind === 'gpu') ?? [], npus = spec?.accels.filter((a) => a.kind === 'npu') ?? [];
  const models = gpus.map(g => g.model);
  const gpuText = models.every(m => m === models[0]) ? `${models[0]}${models.length > 1 ? ` ×${models.length}` : ''}` : models.join(' + ');
  const backbones = b.sites.filter((x) => x?.opened && x.backbone);
  const top = (['global', 'room', 'rack', 'system', 'chip'] as const).find((l) => state.research.unlocks.levels[l]) ?? 'chip';
  const line = (spec: string): ResearchPartView => ({ spec });

  return {
    cores: line(cpu ? plural(cpu.cores.length, 'core') : NONE),
    clock: line(cpu ? formatHertz(capacity(PARTS.clock, cpu.clock.gen, cpu.clock.level)) : NONE),
    cache: line(cpu ? formatSize(cacheBits) : NONE),
    queue: line(spec?.scheduler && s >= 0 ? plural(c.sys.Q[s] ?? 0, 'slot') : NONE),
    fab: line(cpu ? partName('cpu', cpu.cpu.gen) : NONE),
    cpu: line(cpu ? `${partName('cpu', cpu.cpu.gen)} · ${plural(spec!.cpuCount, 'CPU')}` : NONE),
    ram: line(spec?.ram[0] ? `${partName('ram', spec.ram[0].gen)} · ${plural(spec.ram.length, 'stick')}` : NONE),
    drive: line(spec?.drives[0] && s >= 0 ? `${partName('storage', spec.drives[0].gen)} · ${formatSize(c.sys.storageCap[s] ?? 0)}` : NONE),
    gpu: line(models.length ? `GPU ${gpuText}`
      : npus[0]?.kind === 'npu' ? partName('npu', npus[0].gen) : NONE),
    psu: line(spec ? psuName(spec.psu.gen) : NONE),
    board: line(spec ? (spec.board === 'accelerator' ? 'Accelerator board' : 'General board') : NONE),
    switch: line(openRack ? switchSpec(openRack.switch) : NONE),
    lb: line(openRack ? routerSpec(openRack.lb) : NONE),
    rackCooling: line(openRack ? partName('rackCooler', openRack.cooler.gen) : NONE),
    rackPower: line(openRack ? `${partName('pdu', openRack.pdu.gen)} · ${formatWatts(viewW(c.rack.pduCapW[openRack.id] ?? 0))}` : NONE),
    netRack: line(openRoom ? `${switchSpec(openRoom.switch)} · ${routerSpec(openRoom.lb)}` : NONE),
    roomCooling: line(openRoom ? partName('roomCooler', openRoom.cooler.gen) : NONE),
    ups: line(openRoom?.ups[0] ? `${partName('ups', openRoom.ups[0].gen)}${openRoom.ups.length > 1 ? ` · ${openRoom.ups.length} units` : ''}` : NONE),
    dataPlane: line(openSite ? formatHertz(ladderSpeed(openSite.dataPlane.k)) : NONE),
    backbone: line(backbones.length ? plural(backbones.length, 'link') : NONE),
    site: line(openSite ? `${partName('grid', openSite.grid.gen)} · ${plural(b.sites.filter((x) => x?.opened).length, 'site')}` : NONE),
    globalScheduler: line(openSite && b.global.scheduler ? routerSpec(b.global.scheduler) : NONE),
    structure: line(LEVEL_NAMES[top]),
  };
}
