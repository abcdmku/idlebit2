import { FAMILIES } from '../market/families';
import { REGION_IDS, type FamilyDef } from '../types/catalog';

/** Resource clocks: cache loads/traffic use CPU; RAM and disk loads/traffic use RAM and IO. */
export const CPU = 0;
export const RAM = 1;
export const GPU = 2;
export const IO = 3;
export const NRES = 4;

/** Stage resources; memory.ts splits mem stages over the CPU, RAM and IO clocks. */
const RES_CODE = { compute: CPU, mem: RAM, gpu: GPU } as const;

/**
 * A family's stage table flattened for the hot loops: per stage the resource code and the work
 * terms, so stage work at per-member size `s` is `fixed + perSize × s` (docs/tasks.md §2).
 */
export interface Shape {
  readonly def: FamilyDef;
  readonly stages: number;
  readonly res: Uint8Array;
  readonly fixed: Float64Array;
  readonly perSize: Float64Array;
  /** D25.1 grain in size units, at least 1. */
  readonly grain: number;
  readonly members: number;
  readonly tensor: boolean;
  /** REGION_IDS index of a region-locked family, or -1. */
  readonly region: number;
}

const cache = new WeakMap<FamilyDef, Shape>();

export function shapeOf(family: number): Shape {
  const def = FAMILIES[family]!;
  const hit = cache.get(def);
  if (hit) return hit;
  const n = def.stages.length;
  const shape: Shape = {
    def, stages: n,
    res: Uint8Array.from(def.stages, (s) => RES_CODE[s.resource]),
    fixed: Float64Array.from(def.stages, (s) => s.work.fixed),
    perSize: Float64Array.from(def.stages, (s) => s.work.perSize),
    grain: Math.max(1, def.grain),
    members: Math.max(1, def.members),
    tensor: def.tensor,
    region: def.region.kind === 'in' ? REGION_IDS.indexOf(def.region.region) : -1,
  };
  cache.set(def, shape);
  return shape;
}

/** D25.3: threads a shard of `units` wants, max(1, floor(units / grain)). */
export const wantThreads = (shape: Shape, units: number): number => Math.max(1, Math.floor(units / shape.grain));

export const stageWorkAt = (shape: Shape, stage: number, scale: number): number => shape.fixed[stage]! + shape.perSize[stage]! * scale;

export const workingSetOf = (shape: Shape, scale: number): number => shape.def.workingSet.fixed + shape.def.workingSet.perSize * scale;
export const vramOf = (shape: Shape, scale: number): number => shape.def.vramBits.fixed + shape.def.vramBits.perSize * scale;

/** Bits one shard of `scale` units carries over every link: its Σ stage work (D10.4, spec §5.1). Derived, never authored. */
export function memberPayload(shape: Shape, scale: number): number {
  let bits = 0;
  for (let i = 0; i < shape.stages; i += 1) bits += shape.fixed[i]! + shape.perSize[i]! * scale;
  return bits;
}
