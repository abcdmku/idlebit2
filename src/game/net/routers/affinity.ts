import { canRunOn } from '../../market/fleet';
import { someAdmitting } from '../metrics';
import { canAdmit } from '../../exec/slots';
import { shapeOf } from '../../exec/shape';
import type { RouteStrategy } from './types';

/** compiled sys.board of the D7.6 accelerator system (2 sockets, 8 RAM, 8 GPU). */
export const ACCELERATOR_BOARD = 1;

/**
 * affinity (Workload affinity, lbAffinity, D7.7): a family whose `affinity` is 'accelerator'
 * (GPU, tensor, big-memory) goes to the lowest-slot candidate holding an accelerator system that
 * can admit and run it; a 'general' family to one holding such a general system. When the
 * preferred class has no room, firstFit. Capability-aware only removes misroutes; this prefers.
 */
export const affinity: RouteStrategy = {
  id: 'affinity',
  choose(w, kind, _id, r, cand, _slot, n) {
    const wantAccel = shapeOf(w.hot.rec.family[r]!).def.affinity === 'accelerator';
    for (let i = 0; i < n; i += 1) {
      const hit = someAdmitting(w, kind, cand[i]!, (s) =>
        (w.compiled.sys.board[s] === ACCELERATOR_BOARD) === wantAccel && canAdmit(w, s) && canRunOn(w, s, r) === 0);
      if (hit) return i;
    }
    return 0;
  },
};
