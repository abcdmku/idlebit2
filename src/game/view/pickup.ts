import { G } from '../core/buffers';
import { rqLen, rqRow } from '../core/routerQueue';
import { MODE } from '../core/timers';
import type { World } from '../core/world';
import { hwThreads } from '../exec/est';
import { admittedOf, canAdmit, hasLink, queueCapped, slotsOf, takesLeft } from '../exec/slots';
import { gateOn } from '../market/fleet';
import { firstLinkRoom, queueFree } from '../net/split';
import { topRouter } from '../net/scope';
import type { FamilyDef } from '../types/catalog';
import type { GameState } from '../types/state';
import type { TaskWaitReason } from '../types/views';

/** Read the same live room, mode and link checks used by pickup. Never probes or reserves work. */
export function pickupWait(state: GameState, family: FamilyDef, size: number): TaskWaitReason {
  if (state.round.phase !== 'running') return 'round';
  const w = state as unknown as World, c = state.compiled, h = state.hot;
  if (state.research.active !== null && !state.research.stoppedInsolvent && h.g[G.researchHolders] === 0) return 'research';
  const top = { kind: 0, id: 0 }, routed = topRouter(w, top);
  if (routed) {
    if (queueFree(w, top.kind, top.id) > 0) return 'pickup';
    const row = rqRow(h, top.kind, top.id);
    if (row < h.rq.len && rqLen(h, row) > 0) return 'routerQueue';
  }
  let reason: TaskWaitReason = 'routing', rank = -1;
  const prefer = (next: TaskWaitReason, priority: number) => {
    if (priority > rank) { reason = next; rank = priority; }
  };
  for (let s = 0; s < c.sys.len; s += 1) {
    if (c.sys.alive[s] !== 1 || c.sys.kind[s] !== 0 || gateOn(c, s, family, routed ? 0 : size) !== 0) continue;
    const mode = h.sys.mode[s];
    if (mode === MODE.boot || mode === MODE.cold) { prefer('restart', 1); continue; }
    if (mode === MODE.asleep || mode === MODE.standby) { prefer('wake', 1); continue; }
    if (mode !== MODE.onMarket) continue;
    if (!hasLink(w, s) || !routed && !(c.sys.pipeSpeed[s]! > 0)) { prefer('link', 2); continue; }
    if (!routed && h.sys.pipeRec[s]! >= 0) { prefer('transfer', 5); continue; }
    if (queueCapped(w, s) || admittedOf(w, s) >= slotsOf(w, s)) {
      const noQueue = c.sys.Q[s] === 0;
      prefer(noQueue && h.sys.busyThreads[s]! >= hwThreads(w, s)
        ? h.sys.researchThreads[s]! > 0 ? 'research' : 'cores' : 'queue', 3);
      continue;
    }
    if (takesLeft(w, s) <= 0) { prefer('pickup', 6); continue; }
    if (routed && !firstLinkRoom(w, s)) { prefer('transfer', 5); continue; }
    if (!routed || canAdmit(w, s)) return routed ? 'routing' : 'pickup';
  }
  return reason;
}
