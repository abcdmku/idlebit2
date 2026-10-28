import { capacity, levelMax } from './catalog/curves';
import { GPU_MODEL_IDS, evaluateGpu, gpuModel } from './catalog/gpuModels';
import { PARTS, type LeveledPartId } from './catalog';
import type { GameAction } from '../types/actions';
import type { PartRef, SystemId } from '../types/ids';
import type { MeetNeed } from '../types/quotes';
import type { GameState } from '../types/state';
import { readPart } from './partAccess';
import { planAdd, planReplace, planUpgradeTo } from './partPlans';
import { planInstallGpu } from './gpuPlans';
import { fail, type Plan } from './plan';
import { newestGen } from './research/unlocks';
import { planRamEcc } from './eccPlans';

/**
 * The "meet" quote (a blocked task's "Buy X" key): for each component the task gates on and the system
 * lacks, the cheapest single action that meets it. quotes.ts turns each line into a Quote; a line the
 * research doesn't allow yet comes back locked with that research.
 */
export interface MeetLine { readonly action: GameAction; readonly plan: Plan }

const at = (system: SystemId, slot: PartRef['slot']): PartRef => ({ unit: { kind: 'system', id: system }, slot });

/**
 * The minimal level of `ref` that makes the system's total reach `need`, given the others hold `rest`.
 * An upgradePartTo line, or a replace with the next generation when this one tops out first.
 */
function levelLine(state: GameState, ref: PartRef, rest: number, need: number): MeetLine | null {
  const part = readPart(state.build, ref);
  if (!part) return null;
  const id = part.id as LeveledPartId, row = PARTS[id];
  const top = levelMax(row, part.gen, id === 'ram' ? state.research.unlocks.ceilings.ramLevelBonus : 0);
  for (let level = part.level + 1; level <= top; level += 1) {
    if (rest + capacity(row, part.gen, level) >= need) {
      return { action: { type: 'upgradePartTo', part: ref, level }, plan: planUpgradeTo(state, ref, level) };
    }
  }
  const g = part.gen + 1;
  if (g >= row.base.length) return null;
  return { action: { type: 'replacePart', part: ref, generation: g, preserveCapacity: true }, plan: planReplace(state, ref, g, true) };
}

export function meetLines(state: GameState, system: SystemId, need: MeetNeed): MeetLine[] {
  const spec = state.build.systems[system]?.spec;
  if (!spec) return [];
  const c = state.compiled.sys, u = state.research.unlocks;
  const out: MeetLine[] = [];
  const add = (kind: 'ram' | 'drive' | 'core', ecc = false): MeetLine => {
    const part = kind === 'drive' ? 'storage' : kind;
    const g = Math.max(0, newestGen(u, part, PARTS[part].base.length));
    return { action: { type: 'addPart', system, kind, generation: g, ...(ecc ? { ecc } : {}) }, plan: planAdd(state, system, kind, g, ecc) };
  };
  // One cache per CPU. The system's capacity is shared across identical sockets.
  if (need.cacheBits !== undefined && c.cacheBits[system]! < need.cacheBits && spec.cpu) {
    const ref = at(system, { kind: 'cache', socket: 0 });
    const perCpu = Math.ceil(need.cacheBits / Math.max(1, spec.cpuCount));
    const line = levelLine(state, ref, 0, perCpu);
    if (line) out.push(line);
  }
  // RAM: the first module up to the need, or a first module.
  if (need.ramBits !== undefined && c.ramCap[system]! < need.ramBits) {
    if (spec.ram.length > 0) {
      const ref = at(system, { kind: 'ram', index: 0 });
      const part = readPart(state.build, ref)!;
      const line = levelLine(state, ref, c.ramCap[system]! - capacity(PARTS.ram, part.gen, part.level), need.ramBits);
      if (line) out.push(line);
    }
    out.push(add('ram'));
  }
  if (need.diskBits !== undefined && c.storageCap[system]! < need.diskBits) {
    if (spec.drives.length > 0) {
      const ref = at(system, { kind: 'drive', index: 0 });
      const part = readPart(state.build, ref)!;
      const line = levelLine(state, ref, c.storageCap[system]! - capacity(PARTS.storage, part.gen, part.level), need.diskBits);
      if (line) out.push(line);
    }
    out.push(add('drive'));
  }
  if (need.ecc && c.ecc[system] !== 1) out.push(spec.ram.length
    ? { action: { type: 'convertRamToEcc', system }, plan: planRamEcc(state, system) }
    : add('ram', true));
  if (need.cores !== undefined && c.cores[system]! < need.cores) out.push(add('core'));
  // GPU: the cheapest model with the VRAM and cores, among researched generations (else the first one that has them, locked).
  if ((need.vramBits !== undefined && c.vram[system]! < need.vramBits) || (need.gpuCores !== undefined && need.gpuCores > 0 && !spec.accels.some((a) => a.kind === 'gpu' && evaluateGpu(a.model).cores >= need.gpuCores!))) {
    const fits = GPU_MODEL_IDS.filter((m) => {
      const st = evaluateGpu(m);
      return st.vramBits >= (need.vramBits ?? 0) && st.cores >= (need.gpuCores ?? 0);
    });
    const slots = [null, ...spec.accels.map((_, index) => index)];
    const plans = fits.flatMap(model => slots.map(index => ({ model, index, plan: planInstallGpu(state, system, model, index) })));
    const open = plans.filter((p) => p.plan.ok).sort((a, b) => Number(a.plan.ok && b.plan.ok ? a.plan.change.price - b.plan.change.price : 0n));
    const pick = open[0] ?? plans.sort((a, b) => (gpuModel(a.model)!.generation - gpuModel(b.model)!.generation))[0];
    out.push(pick ? { action: { type: 'installGpu', system, model: pick.model, index: pick.index }, plan: pick.plan }
      : { action: { type: 'installGpu', system, model: GPU_MODEL_IDS[0]!, index: null }, plan: fail('cap', 'No GPU is big enough') });
  }
  return out;
}
