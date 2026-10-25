// D25 fixture pieces for the rack, room and world cases: shard transfers that advance with the
// harness time (bitsSent from `timeMs` at the link's speed), and router queues. Tests and the
// dev pages only; nothing here runs the sim.
import { familyId } from '../../../game';
import type { LbQueueEntryView, LbView, NodeRef, SystemId, TransferView } from '../../../game';

export interface FlowCase {
  task: number; family: number; shard: number; shards: number; link: TransferView['link']; to: NodeRef;
  /** Seconds the link takes for this shard (bits / speed). */ seconds?: number;
  /** 'travel' at a phase offset (0..1), 'waiting' unsent, 'landing' shorter than a frame. */ state?: 'travel' | 'waiting' | 'landing'; phase?: number;
  system?: number;
}
const SPEED = 1e5;
/** One shard transfer at `timeMs`. A travelling shard loops its link so the harness shows motion. */
export function flowAt(c: FlowCase, timeMs: number): TransferView {
  const state = c.state ?? 'travel', seconds = state === 'landing' ? 0.01 : c.seconds ?? 2, bits = SPEED * seconds;
  const sent = state === 'travel' ? Math.max(1, Math.floor((((timeMs / 1000) / seconds + (c.phase ?? 0)) % 1) * bits)) : 0;
  const system = (c.system ?? (c.to.level === 'system' ? c.to.id : 0)) as SystemId;
  return {
    taskId: c.task, family: familyId(c.family), systemId: system, link: c.link, bitsSent: sent, bits, speed: SPEED,
    shard: c.shard, shards: c.shards, units: 1000, from: null, to: c.to, key: c.task * 256 + c.shard,
  };
}
/** A router queue of `slots` wells holding `families.length` entries (oldest first). */
export function queueOf(slots: number, families: readonly number[]): LbView['queue'] {
  const entries: LbQueueEntryView[] = families.map((f, i) => ({ taskId: 900 + i, family: familyId(f), units: 4096, shard: null, sinceTick: i, windowEndTick: null }));
  return { slots, level: slots, entries };
}
/** Families by task type, for fixtures: compute, parallel, memory, accel, storage, cluster, zones, region. */
export const FAM = { compute: 5, parallel: 13, memory: 17, accel: 22, storage: 27, cluster: 36, zones: 42, region: 46 } as const;
