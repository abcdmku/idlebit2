import type { AnswerCode, BandId } from '../types/catalog';
import type { TaskTypeId } from '../types/views';
import { FAMILIES } from './families';

/** D23 display grouping. IDs match render/core/familyIcons without importing the renderer. */
export const TASK_TYPE_IDS: readonly TaskTypeId[] = ['compute', 'parallel', 'memory', 'accel', 'storage', 'cluster', 'zones', 'region'];
const BAND_TYPE: Readonly<Record<BandId, TaskTypeId>> = {
  bits: 'compute', ints: 'compute', threads: 'parallel', ram: 'memory', gpu: 'accel', storage: 'storage',
  rackDist: 'cluster', roomDist: 'cluster', multiAz: 'zones', region: 'region',
};
export const familyType = (family: number): TaskTypeId => BAND_TYPE[FAMILIES[family]!.band];

/** Operational answers (heat, pickup, etc.) are not task types and do not invent a type chip. */
export function answerTypes(answers: readonly AnswerCode[]): readonly TaskTypeId[] {
  return [...new Set(answers.flatMap(a => Object.hasOwn(BAND_TYPE, a) ? [BAND_TYPE[a as BandId]] : []))];
}
