import { canRunOn } from '../../market/fleet';
import { someAdmitting } from '../metrics';
import { canAdmit } from '../../exec/slots';
import { shapeOf } from '../../exec/shape';
import { equal, keepIf, type RouteStrategy } from './types';

/** compiled sys.board of the D7.6 accelerator system (2 sockets, 8 RAM, 8 GPU). */
export const ACCELERATOR_BOARD = 1;

/**
 * affinity (Workload affinity, lbAffinity, D7.7): a family whose `affinity` is 'accelerator' (GPU,
 * tensor, big-memory) splits only over candidates holding an accelerator system that can admit and
 * run its share; a 'general' family over candidates holding such a general system. When the
 * preferred class has no room, firstFit. Equal shares. Capability-aware only removes misroutes; this prefers.
 */
export const affinity: RouteStrategy = {
  id: 'affinity',
  weighted: false,
  plan(w, kind, _id, r, cand, slot, weight, n) {
    const wantAccel = shapeOf(w.hot.rec.family[r]!).def.affinity === 'accelerator';
    const kept = keepIf(cand, slot, n, (i) => someAdmitting(w, kind, cand[i]!, (s) =>
      (w.compiled.sys.board[s] === ACCELERATOR_BOARD) === wantAccel && canAdmit(w, s) && canRunOn(w, s, r) === 0));
    return equal(weight, kept);
  },
};
