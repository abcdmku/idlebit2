import { RESEARCH, researchDef } from '../build/research/tree';
import type { PartId, ResearchDef } from '../types/catalog';
import type { LevelId, NodeRef, ResearchId } from '../types/ids';
import type { GameState } from '../types/state';
import type { ResearchTreeView } from '../types/views';
import { researchTree } from './research';

const LEVELS: readonly LevelId[] = ['chip', 'system', 'rack', 'room', 'global'];
// Tensor capabilities also grant legacy NPU rows. They are GPU capabilities,
// rather than generation upgrades of whichever NPU happens to be installed.
const generationUpgrade = (def: ResearchDef) => def.effects.find(e => e.kind === 'gen' && (e.part !== 'npu' || def.id === 'npu'));

/** Hidden bench containers are not installed rack, room or site infrastructure. */
function inventory(state: GameState) {
  const generations = new Map<PartId, number>();
  const add = (part: PartId, gen: number) => generations.set(part, Math.max(generations.get(part) ?? -1, gen));
  let horizon = 0, cores = 0, sockets = 0;
  for (const [i, level] of LEVELS.entries()) if (state.research.unlocks.levels[level]) horizon = i;
  for (const system of state.build.systems) {
    if (!system) continue;
    const s = system.spec;
    if (s.cpu) {
      add('cpu', s.cpu.cpu.gen); add('clock', s.cpu.clock.gen); add('l1', s.cpu.l1.gen);
      for (const core of s.cpu.cores) add('core', core.gen);
      if (s.cpu.l2) add('l2', s.cpu.l2.gen);
      if (s.cpu.l3) add('l3', s.cpu.l3.gen);
      cores = Math.max(cores, s.cpu.cores.length * s.cpuCount);
      sockets = Math.max(sockets, s.cpuCount);
    }
    if (s.scheduler) add('scheduler', s.scheduler.gen);
    for (const ram of s.ram) add('ram', ram.gen);
    for (const accel of s.accels) add(accel.kind, accel.kind === 'gpu' ? Number(accel.model[0]) - 1 : accel.gen);
    for (const drive of s.drives) add('storage', drive.gen);
    if (s.ram.length || s.accels.length || s.drives.length) horizon = Math.max(horizon, 1);
    // The PSU exists at boot, but its research belongs to the System view.
    add('psu', s.psu.gen);
  }
  for (const rack of state.build.racks) if (rack?.opened) {
    horizon = Math.max(horizon, 2);
    add('rackCooler', rack.cooler.gen); add('pdu', rack.pdu.gen); add('lb', rack.lb.gen); add('switch', rack.switch.gen);
  }
  for (const room of state.build.rooms) if (room?.opened) {
    horizon = Math.max(horizon, 3);
    add('roomCooler', room.cooler.gen); add('roomSwitch', room.switch.gen); add('roomLb', room.lb.gen);
    for (const ups of room.ups) add('ups', ups.gen);
  }
  for (const site of state.build.sites) if (site?.opened) {
    horizon = Math.max(horizon, 4);
    add('dataPlane', site.dataPlane.gen); add('grid', site.grid.gen);
    if (site.backbone) add('backbone', site.backbone.gen);
  }
  return { generations, horizon, cores, sockets };
}

/** Extra hardware dependencies that category and view alone cannot express. */
function relevant(def: ResearchDef, hardware: ReturnType<typeof inventory>): boolean {
  const { generations: gens, horizon, cores, sockets } = hardware;
  const has = (part: PartId) => gens.has(part);
  if (LEVELS.indexOf(def.level) > horizon) return false;
  // Only the first hardware unlock is discoverable before that hardware is installed.
  if (def.category === 'memory' && !has('ram') && def.id !== 'memController') return false;
  if (def.category === 'accel' && !has('gpu') && !has('npu') && def.id !== 'gpuGen1') return false;
  if (def.category === 'storage' && !has('storage') && def.id !== 'storageCtl') return false;
  if (['dma', 'prefetch'].includes(def.id) && !has('ram')) return false;
  if (def.id === 'virtualMem' && !has('storage')) return false;
  if (def.id === 'hotPlug' && !has('storage')) return false;
  if (def.id === 'octaChannel' && !has('gpu') && !has('npu')) return false;
  if (def.id === 'workStealing' && cores < 2) return false;
  if (def.id === 'numaAware' && sockets < 2) return false;
  if (def.effects.some(e => e.kind === 'strategy' && e.scope === 'system') && def.id !== 'fifoSched' && !has('scheduler')) return false;

  // A GPU generation can also grant a legacy NPU generation. Its first effect is
  // the hardware being advanced; the secondary effect must not hide GPU research.
  const generation = generationUpgrade(def);
  if (generation?.kind === 'gen' && generation.gen > (gens.get(generation.part) ?? -1) + 1) return false;
  // Capabilities apply to installed generations, even if a later unlock was researched.
  const domain = def.category === 'memory' ? 'ram' : def.category === 'accel' ? 'gpu' : def.category === 'storage' ? 'storage' : null;
  if (domain && !generation) {
    for (const id of def.requires) {
      const required = researchDef(id)?.effects.find(e => e.kind === 'gen' && e.part === domain);
      if (required?.kind === 'gen' && required.gen > (gens.get(domain) ?? -1)) return false;
    }
  }
  return true;
}

/**
 * Dialog discovery only. Keep researchTree's full catalog for model pickers and
 * unlock lookup. Prerequisite closure keeps real names and explicit focus reachable.
 */
export function contextualResearchTree(state: GameState, focus: ResearchId | null = null, at: NodeRef | null = null): ResearchTreeView {
  const tree = researchTree(state, at), hardware = inventory(state);
  const done = new Set(state.research.completed), visible = new Set<ResearchId>();
  const include = (id: ResearchId) => {
    if (visible.has(id)) return;
    const def = researchDef(id);
    if (!def?.implemented) return;
    visible.add(id);
    for (const prerequisite of def.requires) include(prerequisite);
  };
  for (const def of RESEARCH) {
    if (!def.implemented) continue;
    if (done.has(def.id)) { visible.add(def.id); continue; }
    if (!relevant(def, hardware)) continue;
    const ready = def.requires.every(id => done.has(id));
    const nextGeneration = generationUpgrade(def) !== undefined;
    if (ready || nextGeneration) include(def.id);
  }
  // The next view is useful before its prerequisites are done. Do not reveal the
  // descendants belonging to that view until it actually opens.
  const nextLevel = LEVELS[hardware.horizon + 1];
  const nextView = RESEARCH.find(def => def.effects.some(e => e.kind === 'view' && e.level === nextLevel));
  if (nextView) include(nextView.id);
  if (state.research.active) include(state.research.active);
  for (const id of state.research.queue) include(id);
  for (const id of Object.keys(state.research.parked)) {
    const def = researchDef(id);
    if (def) include(def.id);
  }
  if (focus) include(focus);
  return { ...tree, horizon: LEVELS[hardware.horizon]!, nodes: tree.nodes.filter(node => visible.has(node.id)) };
}
