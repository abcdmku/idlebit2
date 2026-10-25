import { FAMILIES } from '../market/families';
import { REGION_IDS, type FamilyDef } from '../types/catalog';

/** Resource indices, RESOURCES order: the stride index of every per-resource hot column. */
export const CPU = 0;
export const RAM = 1;
export const GPU = 2;
export const IO = 3;
export const NRES = 4;

const RES_CODE = { cpu: CPU, ram: RAM, gpu: GPU, io: IO } as const;

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
  readonly threads: number;
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
    threads: Math.max(1, def.threads),
    members: Math.max(1, def.members),
    tensor: def.tensor,
    region: def.region.kind === 'in' ? REGION_IDS.indexOf(def.region.region) : -1,
  };
  cache.set(def, shape);
  return shape;
}

export const stageWorkAt = (shape: Shape, stage: number, scale: number): number => shape.fixed[stage]! + shape.perSize[stage]! * scale;

export const workingSetOf = (shape: Shape, scale: number): number => shape.def.workingSet.fixed + shape.def.workingSet.perSize * scale;
export const vramOf = (shape: Shape, scale: number): number => shape.def.vramBits.fixed + shape.def.vramBits.perSize * scale;

/** Bits one member carries over every link: its Σ stage work (D10.4, spec §5.1). Derived, never authored. */
export function memberPayload(shape: Shape, scale: number): number {
  let bits = 0;
  for (let i = 0; i < shape.stages; i += 1) bits += shape.fixed[i]! + shape.perSize[i]! * scale;
  return bits;
}
